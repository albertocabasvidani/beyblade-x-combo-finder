"""
Fetch YouTube video transcripts for combo-related videos.
Uses youtube_transcript_api (Python) since Node.js packages are broken by YouTube bot detection.

Usage:
  python scripts/fetch-transcripts.py              # fetch all pending (manual)
  python scripts/fetch-transcripts.py --batch 5    # fetch max 5, then exit
  python scripts/fetch-transcripts.py --batch 1    # fetch 1 transcript (Task Scheduler)

Requires: pip install youtube-transcript-api

Note: YouTube rate-limits transcript requests (~20 before block).
      For automated daily use, run with --batch 1 every 5 minutes via Task Scheduler.
      The script saves after every successful fetch, so progress is never lost.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Fix Windows console encoding for emoji/unicode
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from youtube_transcript_api import YouTubeTranscriptApi

DATA_DIR = Path(__file__).parent.parent / 'data'
CACHE_PATH = DATA_DIR / 'youtube-cache.json'
TRANSCRIPT_PATH = DATA_DIR / 'youtube-transcripts.json'

# Delay between requests (seconds). YouTube rate-limits aggressively.
BASE_DELAY = 3.0
# Save to disk every N successful fetches
SAVE_INTERVAL = 10

COMBO_KEYWORDS = [
    'top 3 combo', 'top combo', 'best combo', 'tier list',
    'favorite', 'favourite', 'theory crafting', 'meta',
    'competitive', 'ranking', 'stamina', 'attack type',
    'defense type', 'should be using', 'shatters', 'dominant',
    'cook', 'beginners', 'perfect', 'hardest hitting',
    'mobile defense', 'landmine', 'explosive', 'optimized',
    'scientifically', 'buff', 'roundup', 'datapoints',
    'launch guide', 'launch tech', 'anti meta', 'off meta',
    'combo review', 'combo rating', 'full attack',
    'rating', 'potential', 'review',
]


def is_combo_related(title: str) -> bool:
    lower = title.lower()
    return any(kw in lower for kw in COMBO_KEYWORDS)


def load_existing():
    if TRANSCRIPT_PATH.exists():
        with open(TRANSCRIPT_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'lastFetched': '', 'transcripts': []}


def save_transcripts(all_transcripts, all_failed=None):
    output = {
        'lastFetched': time.strftime('%Y-%m-%d'),
        'transcripts': all_transcripts,
    }
    if all_failed:
        output['failed'] = all_failed
    with open(TRANSCRIPT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description='Fetch YouTube transcripts')
    parser.add_argument('--batch', type=int, default=0,
                        help='Max transcripts to fetch (0 = all pending)')
    args = parser.parse_args()

    batch_mode = args.batch > 0
    batch_limit = args.batch if batch_mode else float('inf')

    if batch_mode:
        print(f'YouTube Transcript Fetcher (batch={args.batch})')
    else:
        print('YouTube Transcript Fetcher (Python)')
    print('=' * 40)

    if not CACHE_PATH.exists():
        print('ERROR: youtube-cache.json not found. Run npm run fetch:youtube first.')
        sys.exit(1)

    with open(CACHE_PATH, 'r', encoding='utf-8') as f:
        yt_cache = json.load(f)

    existing = load_existing()
    existing_ids = {t['videoId'] for t in existing['transcripts']}

    # Also track permanently failed videos (no captions available)
    failed_ids = {t['videoId'] for t in existing.get('failed', [])}

    # Filter combo-related videos without transcripts yet
    target_videos = [
        v for v in yt_cache['videos']
        if v['videoId'] not in existing_ids
        and v['videoId'] not in failed_ids
        and is_combo_related(v['title'])
    ]

    print(f'Total videos in cache: {len(yt_cache["videos"])}')
    print(f'Already have transcripts: {len(existing_ids)}')
    print(f'Permanently failed: {len(failed_ids)}')
    print(f'Combo-related to fetch: {len(target_videos)}')
    print()

    if not target_videos:
        print('No new transcripts to fetch.')
        return

    ytt = YouTubeTranscriptApi()
    all_transcripts = list(existing['transcripts'])
    all_failed = list(existing.get('failed', []))
    new_count = 0
    failures = 0
    consecutive_failures = 0
    today = time.strftime('%Y-%m-%d')

    for i, video in enumerate(target_videos):
        # Stop if batch limit reached
        if new_count >= batch_limit:
            print(f'\nBatch limit ({args.batch}) reached. Exiting.')
            break

        progress = f'[{i + 1}/{len(target_videos)}]'
        title_short = video['title'][:55]
        sys.stdout.write(f'{progress} {title_short}... ')
        sys.stdout.flush()

        try:
            transcript = ytt.fetch(video['videoId'], languages=['en'])
            text = ' '.join(s.text for s in transcript.snippets)

            all_transcripts.append({
                'videoId': video['videoId'],
                'title': video['title'],
                'channel': video['channel'],
                'transcript': text,
                'language': transcript.language,
                'fetchedDate': today,
            })
            new_count += 1
            consecutive_failures = 0
            print(f'OK ({len(text)} chars)')

            # Save after every success in batch mode, every SAVE_INTERVAL otherwise
            if batch_mode or new_count % SAVE_INTERVAL == 0:
                save_transcripts(all_transcripts, all_failed)
                if not batch_mode:
                    print(f'  [Saved {len(all_transcripts)} transcripts to disk]')

        except Exception as e:
            failures += 1
            consecutive_failures += 1
            err_msg = str(e).split('\n')[0]
            if len(err_msg) > 60:
                err_msg = err_msg[:60] + '...'
            print(f'SKIP ({err_msg})')

            # Track "no transcript" as permanent failure (won't retry)
            if 'Could not retrieve' in str(e) or 'disabled' in str(e).lower():
                all_failed.append({
                    'videoId': video['videoId'],
                    'title': video['title'],
                    'reason': err_msg,
                    'date': today,
                })

            # If 10+ consecutive failures, likely rate-limited. Stop early.
            if consecutive_failures >= 10:
                print(f'\n*** Rate limited: {consecutive_failures} consecutive failures. Stopping. ***')
                print('*** Wait 30-60 minutes and run again to continue. ***')
                break

            # In batch mode, stop on first rate-limit failure
            if batch_mode and consecutive_failures >= 3:
                print(f'\nRate limited in batch mode. Will retry next run.')
                break

        # Delay between requests
        delay = BASE_DELAY
        if consecutive_failures > 3:
            delay = BASE_DELAY * 2
        time.sleep(delay)

    # Final save
    save_transcripts(all_transcripts, all_failed)

    print()
    print('--- Summary ---')
    print(f'New transcripts: {new_count}')
    print(f'Failed/skipped: {failures}')
    print(f'Total transcripts: {len(all_transcripts)}')
    print(f'Total permanently failed: {len(all_failed)}')
    print(f'Saved to: {TRANSCRIPT_PATH}')


if __name__ == '__main__':
    main()
