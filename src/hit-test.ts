// Tap on the page. Pure: no DOM.
//
// 1. `tokenAt` finds the token under a tap.
// 2. `scanText` reads that token and the ones after it on the same line.
// 3. `lookupText` is the text that goes to the dictionary app.

import type { OcrToken } from './align';

/** Longest scan string, in characters. */
export const SCAN_LENGTH = 16;

/** Longest lookup text, in characters. */
export const LOOKUP_LENGTH = 40;

/** When the line ends within this many characters, the next line is added. */
export const LOOKUP_SHORT_LINE = 4;

/** Distance from a point to a box. Zero inside the box. */
function boxDistance(box: OcrToken['bbox'], x: number, y: number): number {
  const dx = Math.max(box.x0 - x, 0, x - box.x1);
  const dy = Math.max(box.y0 - y, 0, y - box.y1);
  return Math.hypot(dx, dy);
}

/** Distance from a point to the center of a box. */
function centerDistance(box: OcrToken['bbox'], x: number, y: number): number {
  return Math.hypot((box.x0 + box.x1) / 2 - x, (box.y0 + box.y1) / 2 - y);
}

/**
 * Index of the token on `page` nearest to (x, y), or -1 when none is
 * within `tolerance` pixels. Coordinates are in page pixels. OCR boxes
 * overlap, so among boxes at the same distance the one with the nearest
 * center wins.
 */
export function tokenAt(
  tokens: readonly OcrToken[],
  page: number,
  x: number,
  y: number,
  tolerance: number,
): number {
  let best = -1;
  let bestDist = tolerance;
  let bestCenter = Infinity;
  tokens.forEach((t, i) => {
    if (t.page !== page) return;
    const d = boxDistance(t.bbox, x, y);
    if (d > bestDist) return;
    const c = centerDistance(t.bbox, x, y);
    if (d < bestDist || c < bestCenter) {
      best = i;
      bestDist = d;
      bestCenter = c;
    }
  });
  return best;
}

/** Text of token `start` and the following tokens on its line, up to `max` characters. */
export function scanText(tokens: readonly OcrToken[], start: number, max = SCAN_LENGTH): string {
  const first = tokens[start];
  if (!first) return '';
  let text = '';
  for (let i = start; i < tokens.length && tokens[i]!.line === first.line; i++) {
    if (text.length + tokens[i]!.text.length > max) break;
    text += tokens[i]!.text;
  }
  return text;
}

/** Index of the first token after the line of token `start`, or -1 at the end. */
function nextLine(tokens: readonly OcrToken[], start: number): number {
  const line = tokens[start]!.line;
  let i = start;
  while (i < tokens.length && tokens[i]!.line === line) i++;
  return i < tokens.length ? i : -1;
}

/**
 * The text for a dictionary lookup: from the tapped character to the end
 * of its line. When the line ends within `LOOKUP_SHORT_LINE` characters,
 * the next line of the same page follows, so a word that wraps is whole.
 */
export function lookupText(tokens: readonly OcrToken[], start: number): string {
  const first = tokens[start];
  if (!first) return '';
  let text = scanText(tokens, start, LOOKUP_LENGTH);
  if (text.length > LOOKUP_SHORT_LINE) return text;
  const next = nextLine(tokens, start);
  if (next < 0 || tokens[next]!.page !== first.page) return text;
  text += scanText(tokens, next, LOOKUP_LENGTH - text.length);
  return text;
}
