import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const USER_AGENT = 'BeybladeCombos/1.0 (combo research bot)';
const DELAY_MS = 3000;

interface RedditPost {
  id: string;
  title: string;
  body: string;
  url: string;
  score: number;
  date: string;
  comments: string[];
}

interface RedditCache {
  lastScraped: string;
  posts: RedditPost[];
}

const QUERIES = [
  'best combos',
  'meta combos',
  'competitive deck',
  'tournament winning',
  'top tier combo',
];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function searchPosts(query: string): Promise<RedditPost[]> {
  const params = new URLSearchParams({
    q: query,
    restrict_sr: 'on',
    sort: 'top',
    t: 'year',
    limit: '10',
  });

  const url = `https://old.reddit.com/r/Beyblade/search/.json?${params}`;
  console.log(`  Searching: "${query}"`);

  const data = await fetchJson(url);
  const posts: RedditPost[] = [];

  for (const child of data?.data?.children ?? []) {
    const post = child.data;
    if (!post.selftext && !post.title) continue;

    posts.push({
      id: post.id,
      title: post.title ?? '',
      body: post.selftext ?? '',
      url: `https://reddit.com${post.permalink}`,
      score: post.score ?? 0,
      date: new Date((post.created_utc ?? 0) * 1000).toISOString().slice(0, 10),
      comments: [],
    });
  }

  return posts;
}

async function fetchTopComments(postId: string): Promise<string[]> {
  const url = `https://old.reddit.com/r/Beyblade/comments/${postId}/.json?sort=top&limit=5`;
  const data = await fetchJson(url);

  const comments: string[] = [];
  const listing = data?.[1]?.data?.children ?? [];

  for (const child of listing) {
    if (child.kind !== 't1') continue;
    const body = child.data?.body ?? '';
    if (body.length > 20) {
      comments.push(body.slice(0, 500));
    }
  }

  return comments;
}

async function main() {
  console.log('Reddit scraper for r/Beyblade');
  console.log('===========================\n');

  const allPosts = new Map<string, RedditPost>();

  for (const query of QUERIES) {
    try {
      const posts = await searchPosts(query);
      for (const post of posts) {
        if (!allPosts.has(post.id)) {
          allPosts.set(post.id, post);
        }
      }
    } catch (err) {
      console.error(`  Error searching "${query}":`, (err as Error).message);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nFound ${allPosts.size} unique posts. Fetching top comments...\n`);

  const topPosts = [...allPosts.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  for (const post of topPosts) {
    try {
      console.log(`  Comments for: ${post.title.slice(0, 60)}...`);
      post.comments = await fetchTopComments(post.id);
    } catch (err) {
      console.error(`  Error fetching comments for ${post.id}:`, (err as Error).message);
    }
    await sleep(DELAY_MS);
  }

  const cache: RedditCache = {
    lastScraped: new Date().toISOString().slice(0, 10),
    posts: topPosts,
  };

  const outPath = join(DATA_DIR, 'reddit-cache.json');
  writeFileSync(outPath, JSON.stringify(cache, null, 2));
  console.log(`\nSaved ${topPosts.length} posts to ${outPath}`);
}

main().catch(console.error);
