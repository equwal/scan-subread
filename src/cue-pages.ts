// Where each cue is on the pages, and the page of the audio at a time. Pure.
//
// Most cues are on one page. A cue at a page break has text on two pages.
// The narrator reads the text in order, so the page follows the time: the
// first page for the share of the text of the cue on it, then the next page.

import { normalizeText, type OcrToken, type TokenSpan } from './align';

/** The part of a cue on one page. */
export interface PagePart {
  page: number;
  /** The share of the text of the cue on this page: more than 0, at most 1. The shares of a cue add up to 1. */
  share: number;
}

/** The parts of a cue in page order. Empty for an unmatched cue. */
export type CueParts = readonly PagePart[];

/** A cue in time, in seconds. */
export interface CueTime {
  start: number;
  end: number;
}

/** How many cues back an unmatched cue borrows the page of a matched one. */
export const LOOKBACK = 5;

/**
 * A seek to the start of a page lands this many seconds into its text, at
 * most. A clock that rounds the time then does not show the page before.
 */
export const SEEK_INTO = 0.05;

/** The count of normalized characters of each token text that was seen. */
const weights = new Map<string, number>();

/** The count of normalized characters of a token: 0 for punctuation, as in the alignment. */
function weight(text: string): number {
  let n = weights.get(text);
  if (n === undefined) {
    n = normalizeText(text).length;
    weights.set(text, n);
  }
  return n;
}

/**
 * The parts of each cue on the pages, from the spans of the alignment.
 * The share of a page is the share of the normalized characters of the
 * span on that page. The tokens must be in page order.
 */
export function cueParts(tokens: readonly OcrToken[], spans: readonly TokenSpan[]): CueParts[] {
  return spans.map((span) => {
    if (!span.matched) return [];
    const counts: { page: number; chars: number }[] = [];
    let total = 0;
    for (let t = span.start; t < span.end; t++) {
      const token = tokens[t];
      if (!token) continue;
      const n = weight(token.text);
      if (n === 0) continue;
      const last = counts[counts.length - 1];
      if (last && last.page === token.page) last.chars += n;
      else counts.push({ page: token.page, chars: n });
      total += n;
    }
    return counts.map((c) => ({ page: c.page, share: c.chars / total }));
  });
}

/** How far time `t` is into `cue`: 0 at its start, 1 at its end and after it. */
export function cueProgress(cue: CueTime, t: number): number {
  const length = cue.end - cue.start;
  if (length <= 0) return 1;
  return Math.min(1, Math.max(0, (t - cue.start) / length));
}

/**
 * The page of the audio at `progress` into cue `cue`. For a matched cue it
 * is the page of the part that holds the progress: the first page until
 * the share of the text on it is read, then the next page. An unmatched
 * cue borrows the last page of the nearest matched cue before it, within
 * LOOKBACK cues. Null when there is none.
 */
export function audioPage(
  parts: readonly CueParts[],
  cue: number,
  progress: number,
): number | null {
  const own = parts[cue];
  if (own && own.length > 0) {
    let end = 0;
    for (const part of own) {
      end += part.share;
      if (progress < end) return part.page;
    }
    return own[own.length - 1]!.page;
  }
  for (let i = cue - 1; i >= 0 && i >= cue - LOOKBACK; i--) {
    const before = parts[i];
    if (before && before.length > 0) return before[before.length - 1]!.page;
  }
  return null;
}

/**
 * The time where the text of `page` starts, in seconds: in the first cue
 * with text on the page. When that cue starts on a page before, the time
 * is inside the cue, after the share of its text on the pages before. The
 * time is up to SEEK_INTO later, but inside the part of the page. Null
 * when no cue has text on the page.
 */
export function pageStartTime(
  parts: readonly CueParts[],
  cues: readonly CueTime[],
  page: number,
): number | null {
  for (let i = 0; i < parts.length; i++) {
    const cue = cues[i];
    if (!cue) continue;
    let before = 0;
    for (const part of parts[i]!) {
      if (part.page === page) {
        const length = Math.max(0, cue.end - cue.start);
        return cue.start + length * before + Math.min(SEEK_INTO, (length * part.share) / 2);
      }
      before += part.share;
    }
  }
  return null;
}
