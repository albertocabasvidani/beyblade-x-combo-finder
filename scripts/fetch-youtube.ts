import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const API_BASE = 'https://www.googleapis.com/youtube/v3';

interface VideoEntry {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channel: string;
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
      });

      if (videos.length >= maxResults) {
        return videos;
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return videos;
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
      const handle = source.urls[0];
      let channelId = source.channelId;
      let uploadsPlaylistId: string;

      if (!channelId) {
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
      const videos = await fetchUploadedVideos(apiKey, uploadsPlaylistId, isInitialScan ? 100 : 50);

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

  const cache: YouTubeCache = {
    lastFetched: new Date().toISOString().slice(0, 10),
    videos: allNewVideos,
  };

  const outPath = join(DATA_DIR, 'youtube-cache.json');
  writeFileSync(outPath, JSON.stringify(cache, null, 2));
  console.log(`Saved ${allNewVideos.length} new videos to ${outPath}`);
}

main().catch(console.error);
