// Pure SRT and WebVTT parser, and the decoder of subtitle files. No DOM.
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

/**
 * Decodes the bytes of a subtitle file to text, and removes the BOM.
 *
 * - A UTF-8 BOM, or bytes that are valid UTF-8: UTF-8.
 * - A UTF-16 BOM: UTF-16, little endian or big endian as the BOM tells.
 * - Other bytes: Shift_JIS, the usual encoding of old Japanese files.
 *   Japanese text in Shift_JIS is almost never valid UTF-8.
 */
export function decodeSubtitles(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  // TextDecoder removes the BOM of its own encoding.
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('shift_jis').decode(b);
  }
}

/**
 * Index of the last cue that starts at or before time t, or -1. In the
 * silence after a cue, this is still that cue. Cues must be sorted by start.
 */
export function lastCueAt(cues: readonly Pick<Cue, 'start'>[], t: number): number {
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
  return found;
}
