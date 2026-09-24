// Pure SRT and WebVTT parser. No DOM.
//
// Why not a library: the `subtitle` package imports Node `stream` at
// module load, so it does not run in a browser bundle. The subset we need
// (timed cues, plain text) fits in a few lines.

export interface Cue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const ARROW = '-->';

function parseTime(s: string): number | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number(m[4]!.padEnd(3, '0'));
  return h * 3600 + min * 60 + sec + ms / 1000;
}

/** Parse SRT or WebVTT text. Blocks without a time line are skipped. */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timeLine = lines.findIndex((l) => l.includes(ARROW));
    if (timeLine < 0) continue;
    const [left, right] = lines[timeLine]!.split(ARROW);
    const start = parseTime(left ?? '');
    const end = parseTime(right ?? '');
    if (start === null || end === null) continue;
    const body = lines
      .slice(timeLine + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (body.length === 0) continue;
    cues.push({ start, end, text: body });
  }
  cues.sort((x, y) => x.start - y.start);
  return cues;
}

/** Index of the cue active at time t, or -1. Cues must be sorted by start. */
export function cueIndexAt(cues: readonly Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0 && t < cues[found]!.end) return found;
  return -1;
}
