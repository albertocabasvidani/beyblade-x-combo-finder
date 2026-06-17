import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { prefilter } from './lib/youtube-relevance';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const API_BASE = 'https://www.googleapis.com/youtube/v3';

interface VideoEntry {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channel: string;
  channelId: string;
  sourceId: string;
  sourceLang: string;
  // popolati da enrichVideos (videos?part=snippet)
  tags: string[];
  defaultAudioLanguage: string | null;
  defaultLanguage: string | null;
  // popolato dal pre-filtro deterministico (lib/youtube-relevance)
  prefilter?: 'pass' | 'drop';
  prefilterReason?: string;
  // popolati dal giudizio IA (/judge-youtube → youtube-judge-batch.ts done)
  relevant?: boolean;
  relevanceReason?: string;
  lang?: string;
}

interface YouTubeCache {
  lastFetched: string;
  videos: VideoEntry[];
}

interface ScanHistory {
  lastFullScan: string | null;
  scannedVideos: Record<string, { title: string; channel: string; scannedDate: string; combosFound: number }>;
  scannedSheets: Record<string, any>;
  scannedPages: Record<string, any>;
}

function getApiKey(): string {
  const envPath = join(import.meta.dirname, '..', '.env');
  if (!existsSync(envPath)) {
    throw new Error('.env file not found. Create it with YOUTUBE_API_KEY=...');
  }
  const envContent = readFileSync(envPath, 'utf-8');
  const match = envContent.match(/YOUTUBE_API_KEY=(.+)/);
  if (!match) {
    throw new Error('YOUTUBE_API_KEY not found in .env');
  }
  return match[1].trim();
}

function loadSources(): any[] {
  const sourcesPath = join(DATA_DIR, 'sources.json');
  const data = JSON.parse(readFileSync(sourcesPath, 'utf-8'));
  return data.sources.filter((s: any) => s.type === 'youtube');
}

function loadScanHistory(): ScanHistory {
  const path = join(DATA_DIR, 'scan-history.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveScanHistory(history: ScanHistory) {
  const path = join(DATA_DIR, 'scan-history.json');
  writeFileSync(path, JSON.stringify(history, null, 2));
}

async function resolveChannelId(apiKey: string, handle: string): Promise<{ channelId: string; uploadsPlaylistId: string }> {
  const cleanHandle = handle.replace('https://www.youtube.com/', '').replace('@', '');
  const url = `${API_BASE}/channels?part=contentDetails&forHandle=${cleanHandle}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.items?.length) {
    const searchUrl = `${API_BASE}/search?part=snippet&q=${cleanHandle}&type=channel&maxResults=1&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchData.items?.length) {
      throw new Error(`Channel not found for handle: ${cleanHandle}`);
    }
    const channelId = searchData.items[0].id.channelId;
    const chUrl = `${API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
    const chRes = await fetch(chUrl);
    const chData = await chRes.json();
    return {
      channelId,
      uploadsPlaylistId: chData.items[0].contentDetails.relatedPlaylists.uploads,
    };
  }

  return {
    channelId: data.items[0].id ?? '',
    uploadsPlaylistId: data.items[0].contentDetails.relatedPlaylists.uploads,
  };
}

async function fetchUploadedVideos(
  apiKey: string,
  playlistId: string,
  source: { id: string; lang: string; channelId: string },
  maxResults: number = 50,
): Promise<VideoEntry[]> {
  const videos: VideoEntry[] = [];
  let pageToken: string | undefined;
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: '50',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${API_BASE}/playlistItems?${params}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error(`  API error: ${data.error.message}`);
      break;
    }

    for (const item of data.items ?? []) {
      const snippet = item.snippet;
      const publishedAt = snippet.publishedAt ?? '';
      const pubDate = new Date(publishedAt);

      if (pubDate < cutoffDate) {
        return videos;
      }

      videos.push({
        videoId: snippet.resourceId?.videoId ?? '',
        title: snippet.title ?? '',
        description: snippet.description ?? '',
        publishedAt: publishedAt.slice(0, 10),
        channel: snippet.channelTitle ?? '',
        channelId: source.channelId,
        sourceId: source.id,
        sourceLang: source.lang,
        tags: [],
        defaultAudioLanguage: null,
        defaultLanguage: null,
      });

      if (videos.length >= maxResults) {
        return videos;
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return videos;
}

/**
 * Arricchisce i video con `videos?part=snippet` (batch da 50): tags, descrizione completa
 * (playlistItems la tronca), defaultAudioLanguage/defaultLanguage. Mutazione in-place.
 * Costo quota: 1 unità per batch di 50 id.
 */
async function enrichVideos(apiKey: string, videos: VideoEntry[]): Promise<void> {
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const ids = videos.map((v) => v.videoId).filter(Boolean);

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `${API_BASE}/videos?part=snippet&id=${chunk.join(',')}&key=${apiKey}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        console.error(`  Enrich API error: ${data.error.message}`);
        continue;
      }
      for (const item of data.items ?? []) {
        const v = byId.get(item.id);
        if (!v) continue;
        const s = item.snippet ?? {};
        v.tags = s.tags ?? [];
        if (s.description) v.description = s.description; // completa, sovrascrive la troncata
        v.defaultAudioLanguage = s.defaultAudioLanguage ?? null;
        v.defaultLanguage = s.defaultLanguage ?? null;
      }
    } catch (e) {
      console.error(`  Enrich fetch failed: ${(e as Error).message}`);
    }
  }
}

async function main() {
  console.log('YouTube API fetcher for Beyblade X channels');
  console.log('============================================\n');

  const apiKey = getApiKey();
  const ytSources = loadSources();
  const scanHistory = loadScanHistory();
  const isInitialScan = !scanHistory.lastFullScan;

  console.log(`Mode: ${isInitialScan ? 'INITIAL SCAN (last 12 months)' : 'INCREMENTAL'}\n`);

  const allNewVideos: VideoEntry[] = [];
  const sourcesData = JSON.parse(readFileSync(join(DATA_DIR, 'sources.json'), 'utf-8'));

  for (const source of ytSources) {
    console.log(`Channel: ${source.name}`);

    try {
      let channelId = source.channelId;
      let uploadsPlaylistId: string;

      if (!channelId) {
        const handle = source.urls?.[0] ?? source.name;
        console.log('  Resolving channel ID...');
        const resolved = await resolveChannelId(apiKey, handle);
        channelId = resolved.channelId;
        uploadsPlaylistId = resolved.uploadsPlaylistId;

        const idx = sourcesData.sources.findIndex((s: any) => s.id === source.id);
        if (idx !== -1) {
          sourcesData.sources[idx].channelId = channelId;
        }
        console.log(`  Channel ID: ${channelId}`);
      } else {
        const url = `${API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();
        uploadsPlaylistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) {
          console.error(`  Could not get uploads playlist for ${channelId}`);
          continue;
        }
      }

      console.log('  Fetching videos...');
      const videos = await fetchUploadedVideos(
        apiKey,
        uploadsPlaylistId,
        { id: source.id, lang: source.lang ?? '', channelId },
        isInitialScan ? 100 : 50,
      );

      const newVideos = videos.filter((v) => !scanHistory.scannedVideos[v.videoId]);
      console.log(`  Found ${videos.length} videos, ${newVideos.length} new\n`);

      for (const video of newVideos) {
        allNewVideos.push(video);
        scanHistory.scannedVideos[video.videoId] = {
          title: video.title,
          channel: video.channel,
          scannedDate: new Date().toISOString().slice(0, 10),
          combosFound: 0,
        };
      }
    } catch (err) {
      console.error(`  Error: ${(err as Error).message}\n`);
    }
  }

  writeFileSync(join(DATA_DIR, 'sources.json'), JSON.stringify(sourcesData, null, 2));
  saveScanHistory(scanHistory);

  // Arricchimento (tags/desc completa/lingua) + pre-filtro deterministico sui nuovi video.
  console.log('\nEnriching new videos (tags + language)...');
  await enrichVideos(apiKey, allNewVideos);
  const dropCounts: Record<string, number> = {};
  for (const v of allNewVideos) {
    const r = prefilter(v);
    v.prefilter = r.verdict;
    v.prefilterReason = r.reason;
    if (r.verdict === 'drop') {
      const key = r.reason.split(':')[0];
      dropCounts[key] = (dropCounts[key] ?? 0) + 1;
    }
  }

  const outPath = join(DATA_DIR, 'youtube-cache.json');

  // Merge CUMULATIVO: la cache è la worklist di /judge-youtube e fetch-transcripts. I nuovi si
  // aggiungono ai pendenti, preservando i flag relevant/lang già decisi per i video esistenti, così
  // un backfill (745 video) non viene perso da un fetch successivo che troverebbe pochi nuovi.
  const prevCache: YouTubeCache = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, 'utf-8'))
    : { lastFetched: '', videos: [] };
  const newIds = new Set(allNewVideos.map((v) => v.videoId));
  const mergedVideos = [
    ...allNewVideos,
    ...(prevCache.videos ?? []).filter((v) => !newIds.has(v.videoId)),
  ];

  const cache: YouTubeCache = {
    lastFetched: new Date().toISOString().slice(0, 10),
    videos: mergedVideos,
  };
  writeFileSync(outPath, JSON.stringify(cache, null, 2));

  const passCount = allNewVideos.filter((v) => v.prefilter === 'pass').length;
  console.log(
    `Saved ${allNewVideos.length} new videos (${passCount} pass, ${allNewVideos.length - passCount} drop: ${JSON.stringify(dropCounts)}). Cache total: ${mergedVideos.length}.`,
  );
}

main().catch(console.error);
