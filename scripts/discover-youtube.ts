// Scoperta deterministica di NUOVI canali YouTube Beyblade X via YouTube Data API v3.
// Parte "codice" del confine IA/codice: fa solo il fetch grezzo (search + statistiche) e il dedup
// contro le fonti già note. Il giudizio di rilevanza/competitività (è davvero Beyblade X? pubblica
// risultati di tornei?) lo fa l'IA in /discover-sources leggendo l'output tmp/discover-youtube.json.
//
// Riusa i pattern di fetch-youtube.ts (getApiKey, chiamate youtube/v3).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const TMP_DIR = join(ROOT, 'tmp');
const API_BASE = 'https://www.googleapis.com/youtube/v3';

// Query localizzate: una "tecnica" per-lingua. Termini che puntano a RISULTATI di torneo,
// non a unboxing/teoria. MAI includere l'anno (regola di progetto).
interface Query {
  q: string;
  lang: string;
  region: string;
}
const QUERIES: Query[] = [
  { q: 'beyblade x tournament results', lang: 'en', region: 'US' },
  { q: 'beyblade x winning combo tournament', lang: 'en', region: 'US' },
  { q: 'beyblade x ranking meta combos', lang: 'en', region: 'GB' },
  { q: 'beyblade x tournament', lang: 'en', region: 'AU' },
  { q: 'ベイブレードX 大会 結果', lang: 'ja', region: 'JP' },
  { q: 'ベイブレードX 公式大会 優勝', lang: 'ja', region: 'JP' },
  { q: '베이블레이드X 대회 우승 조합', lang: 'ko', region: 'KR' },
  { q: 'beyblade x torneo resultados combos', lang: 'es', region: 'ES' },
  { q: 'beyblade x torneo liga ganador', lang: 'es', region: 'MX' },
  { q: 'beyblade x torneio resultados combos', lang: 'pt', region: 'BR' },
  { q: 'beyblade x turnier ergebnisse', lang: 'de', region: 'DE' },
  { q: 'beyblade x turniej wyniki', lang: 'pl', region: 'PL' },
  { q: 'beyblade x 比賽 結果 配置', lang: 'zh', region: 'TW' },
  { q: 'beyblade x turnamen hasil kombinasi', lang: 'id', region: 'ID' },
];

function getApiKey(): string {
  const envPath = join(ROOT, '.env');
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

// channelId già noti: fonti attive + candidati già visti (qualsiasi status).
function loadKnownChannelIds(): Set<string> {
  const known = new Set<string>();
  const sources = JSON.parse(readFileSync(join(DATA_DIR, 'sources.json'), 'utf-8'));
  for (const s of sources.sources ?? []) {
    if (s.channelId) known.add(s.channelId);
  }
  const candPath = join(DATA_DIR, 'source-candidates.json');
  if (existsSync(candPath)) {
    const cand = JSON.parse(readFileSync(candPath, 'utf-8'));
    for (const c of cand.candidates ?? []) {
      if (c.channelId) known.add(c.channelId);
    }
  }
  return known;
}

interface ChannelCandidate {
  channelId: string;
  title: string;
  description: string;
  customUrl: string;
  country: string;
  subscribers: number | null;
  videoCount: number | null;
  lastUpload: string | null;
  foundVia: { q: string; lang: string; region: string }[];
}

async function searchChannels(apiKey: string, query: Query): Promise<string[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query.q,
    type: 'channel',
    maxResults: '15',
    relevanceLanguage: query.lang,
    regionCode: query.region,
    key: apiKey,
  });
  const res = await fetch(`${API_BASE}/search?${params}`);
  const data = await res.json();
  if (data.error) {
    console.error(`  API error (${query.q}): ${data.error.message}`);
    return [];
  }
  return (data.items ?? [])
    .map((it: any) => it.id?.channelId ?? it.snippet?.channelId)
    .filter(Boolean);
}

// Statistiche + uploads playlist per un batch di channelId (channels.list accetta fino a 50 id).
async function fetchChannelDetails(
  apiKey: string,
  ids: string[],
): Promise<Map<string, { detail: any; uploads: string }>> {
  const out = new Map<string, { detail: any; uploads: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
      key: apiKey,
    });
    const res = await fetch(`${API_BASE}/channels?${params}`);
    const data = await res.json();
    if (data.error) {
      console.error(`  channels.list error: ${data.error.message}`);
      continue;
    }
    for (const item of data.items ?? []) {
      out.set(item.id, {
        detail: item,
        uploads: item.contentDetails?.relatedPlaylists?.uploads ?? '',
      });
    }
  }
  return out;
}

async function fetchLastUpload(apiKey: string, uploadsPlaylistId: string): Promise<string | null> {
  if (!uploadsPlaylistId) return null;
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: '1',
    key: apiKey,
  });
  const res = await fetch(`${API_BASE}/playlistItems?${params}`);
  const data = await res.json();
  if (data.error || !data.items?.length) return null;
  const publishedAt = data.items[0].snippet?.publishedAt ?? '';
  return publishedAt ? publishedAt.slice(0, 10) : null;
}

async function main() {
  console.log('YouTube discovery — nuovi canali Beyblade X');
  console.log('============================================\n');

  const apiKey = getApiKey();
  const known = loadKnownChannelIds();
  console.log(`Canali già noti (esclusi dal dedup): ${known.size}\n`);

  // 1) Raccogli channelId candidati da tutte le query, tracciando da quale query arrivano.
  const foundVia = new Map<string, Query[]>();
  for (const query of QUERIES) {
    console.log(`Query [${query.lang}/${query.region}]: ${query.q}`);
    const ids = await searchChannels(apiKey, query);
    let novel = 0;
    for (const id of ids) {
      if (known.has(id)) continue;
      novel++;
      const arr = foundVia.get(id) ?? [];
      arr.push(query);
      foundVia.set(id, arr);
    }
    console.log(`  ${ids.length} risultati, ${novel} non già noti\n`);
  }

  const candidateIds = [...foundVia.keys()];
  console.log(`Candidati unici nuovi: ${candidateIds.length}\n`);

  // 2) Statistiche + ultimo upload per ogni candidato.
  const details = await fetchChannelDetails(apiKey, candidateIds);
  const candidates: ChannelCandidate[] = [];
  for (const id of candidateIds) {
    const entry = details.get(id);
    if (!entry) continue;
    const sn = entry.detail.snippet ?? {};
    const st = entry.detail.statistics ?? {};
    const lastUpload = await fetchLastUpload(apiKey, entry.uploads);
    const queries = foundVia.get(id) ?? [];
    candidates.push({
      channelId: id,
      title: sn.title ?? '',
      description: sn.description ?? '',
      customUrl: sn.customUrl ?? '',
      country: sn.country ?? '',
      subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0),
      videoCount: st.videoCount != null ? Number(st.videoCount) : null,
      lastUpload,
      foundVia: queries.map((q) => ({ q: q.q, lang: q.lang, region: q.region })),
    });
  }

  // 3) Scrivi l'elenco grezzo: il giudizio lo fa l'IA in /discover-sources.
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  const outPath = join(TMP_DIR, 'discover-youtube.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString().slice(0, 10), queries: QUERIES, candidates },
      null,
      2,
    ),
  );
  console.log(`Salvati ${candidates.length} canali candidati in ${outPath}`);
}

main().catch(console.error);
