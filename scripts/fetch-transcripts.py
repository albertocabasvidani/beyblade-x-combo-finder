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
    # Legacy: il filtro di rilevanza ora è il flag `relevant` deciso dall'IA in /judge-youtube
    # (multilingua, su titolo+descrizione+tag). Mantenuta solo come fallback storico, non più nel
    # percorso principale.
    lower = title.lower()
    return any(kw in lower for kw in COMBO_KEYWORDS)


def fetch_transcript_text(ytt, video_id, preferred_lang):
    """Scarica il transcript nella lingua reale del video e lo uniforma in inglese se traducibile.

    Ritorna (text, final_lang, source_lang). Solleva eccezione se nessun transcript è disponibile.
    `preferred_lang` = lingua reale del parlato (da relevant/lang IA, defaultAudioLanguage o sourceLang).
    """
    tlist = ytt.list(video_id)

    candidates = []
    if preferred_lang:
        candidates.append(preferred_lang)
        # normalizza 'pt-BR' → 'pt' come ulteriore candidato
        base = preferred_lang.split('-')[0]
        if base != preferred_lang:
            candidates.append(base)
    candidates.append('en')

    transcript = None
    try:
        transcript = tlist.find_transcript(candidates)
    except Exception:
        transcript = next(iter(tlist), None)  # primo disponibile, qualunque lingua
    if transcript is None:
        raise Exception('No transcript available')

    source_lang = transcript.language_code
    if not source_lang.startswith('en') and getattr(transcript, 'is_translatable', False):
        try:
            transcript = transcript.translate('en')
        except Exception:
            pass  # non traducibile: si tiene l'originale (l'IA gestisce il multilingua a valle)

    fetched = transcript.fetch()
    text = ' '.join(s.text for s in fetched)
    final_lang = getattr(fetched, 'language_code', None) or getattr(transcript, 'language_code', source_lang)
    return text, final_lang, source_lang


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

    # Filtra i video GIUDICATI RILEVANTI dall'IA (/judge-youtube) e ancora senza transcript.
    target_videos = [
        v for v in yt_cache['videos']
        if v['videoId'] not in existing_ids
        and v['videoId'] not in failed_ids
        and v.get('relevant') is True
    ]

    print(f'Total videos in cache: {len(yt_cache["videos"])}')
    print(f'Already have transcripts: {len(existing_ids)}')
    print(f'Permanently failed: {len(failed_ids)}')
    print(f'Relevant to fetch: {len(target_videos)}')
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
            preferred_lang = video.get('lang') or video.get('defaultAudioLanguage') or video.get('sourceLang')
            text, final_lang, source_lang = fetch_transcript_text(ytt, video['videoId'], preferred_lang)

            all_transcripts.append({
                'videoId': video['videoId'],
                'title': video['title'],
                'channel': video['channel'],
                'transcript': text,
                'language': final_lang,
                'sourceLanguage': source_lang,
                'fetchedDate': today,
            })
            new_count += 1
            consecutive_failures = 0
            translated = '' if final_lang == source_lang else f', {source_lang}->{final_lang}'
            print(f'OK ({len(text)} chars{translated})')

            # Save after every success in batch mode, every SAVE_INTERVAL otherwise
            if batch_mode or new_count % SAVE_INTERVAL == 0:
                save_transcripts(all_transcripts, all_failed)
                if not batch_mode:
                    print(f'  [Saved {len(all_transcripts)} transcripts to disk]')

        except Exception as e:
            failures += 1
            consecutive_failures += 1
            etype = type(e).__name__
            err_msg = (str(e).strip().split('\n')[0] or etype)[:80]
            print(f'SKIP [{etype}] ({err_msg})')

            # IP block / rate-limit = TEMPORANEO: NON marcare permanent (verrebbe perso un video
            # valido), ferma e riprova al prossimo run. Il messaggio di IpBlocked contiene anch'esso
            # "Could not retrieve", quindi distinguere per TIPO dell'eccezione, non per testo.
            is_rate_limited = etype in ('IpBlocked', 'RequestBlocked', 'TooManyRequests') \
                or 'blocking requests from your ip' in str(e).lower()

            # Captions assenti/disabilitati/video non disponibile = PERMANENTE (non riprovare).
            if not is_rate_limited and etype in (
                'TranscriptsDisabled', 'NoTranscriptFound', 'VideoUnavailable', 'VideoUnplayable',
            ):
                all_failed.append({
                    'videoId': video['videoId'],
                    'title': video['title'],
                    'reason': err_msg,
                    'date': today,
                })

            if is_rate_limited:
                print('\n*** YouTube ha bloccato l\'IP (rate-limit): stop. Riprovare tra 30-60 min. ***')
                break

            # If 10+ consecutive failures, likely rate-limited. Stop early.
            if consecutive_failures >= 10:
                print(f'\n*** {consecutive_failures} fallimenti consecutivi. Stopping. ***')
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
