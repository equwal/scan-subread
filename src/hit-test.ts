// Tap on the page. Pure: no DOM.
//
// 1. `tokenAt` finds the token under a tap.
// 2. `scanText` reads that token and the ones after it on the same line.
// 3. `lookupText` is the text that goes to the dictionary app.

import type { OcrToken } from './align';
import { isCjk, joinWords } from './book-text';

/** Longest scan string, in characters. */
export const SCAN_LENGTH = 16;

/** Longest lookup text, in characters. */
export const LOOKUP_LENGTH = 40;

/**
 * When the line ends within this many characters, the next line is added,
 * unless the line ends a sentence.
 */
export const LOOKUP_SHORT_LINE = 4;

/** A token of punctuation or symbols only. A lookup does not start with one. */
const PUNCTUATION = /^[\p{P}\p{S}]+$/u;

/** Text that ends a sentence. No next line follows it in a lookup. */
const SENTENCE_END = /[。．！？.!?」』]$/u;

/** How far from a character a tap may land, in CSS pixels: about the size of a finger. */
export const TAP_CSS = 24;

/**
 * The tap tolerance in page pixels. The page is `pageWidth` pixels wide
 * and shows `shownWidth` CSS pixels wide. A pinch zoom of `zoom` makes a
 * CSS pixel bigger on the screen, so the finger covers fewer of them.
 */
export function tapTolerance(pageWidth: number, shownWidth: number, zoom = 1): number {
  return (TAP_CSS * pageWidth) / (shownWidth * Math.max(1, zoom));
}

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

/**
 * Text of token `start` and the following tokens on its line, up to `max`
 * characters. Spaces are not tokens: a space goes between two words,
 * except between two CJK words, and does not count toward `max`.
 */
export function scanText(tokens: readonly OcrToken[], start: number, max = SCAN_LENGTH): string {
  const first = tokens[start];
  if (!first) return '';
  const words: string[] = [];
  let word = '';
  let wordId = first.word;
  let length = 0;
  for (let i = start; i < tokens.length && tokens[i]!.line === first.line; i++) {
    const t = tokens[i]!;
    if (length + t.text.length > max) break;
    if (t.word !== wordId) {
      words.push(word);
      word = '';
      wordId = t.word;
    }
    word += t.text;
    length += t.text.length;
  }
  words.push(word);
  return joinWords(words);
}

/** Index of the first token after the line of token `start`, or -1 at the end. */
function nextLine(tokens: readonly OcrToken[], start: number): number {
  const line = tokens[start]!.line;
  let i = start;
  while (i < tokens.length && tokens[i]!.line === line) i++;
  return i < tokens.length ? i : -1;
}

/**
 * Index of the first token of the word of token `i`: the same word id on
 * the same line. The search stops at a CJK token, because Japanese OCR can
 * give one word for a whole line.
 */
function wordStart(tokens: readonly OcrToken[], i: number): number {
  const { line, word } = tokens[i]!;
  while (i > 0) {
    const prev = tokens[i - 1]!;
    if (prev.line !== line || prev.word !== word || isCjk(prev.text)) break;
    i--;
  }
  return i;
}

/**
 * The text for a dictionary lookup, to the end of the line. A CJK
 * character starts it where the tap lands, because a dictionary app scans
 * from there. Another character starts it at the first letter of its
 * word. Punctuation and symbols at the start are skipped. When only they
 * are left on the line, the text is empty. When the line ends within
 * `LOOKUP_SHORT_LINE` characters and does not end a sentence, the next
 * line of the same page follows, so a word that wraps is whole.
 */
export function lookupText(tokens: readonly OcrToken[], tapped: number): string {
  const first = tokens[tapped];
  if (!first) return '';
  let start = isCjk(first.text) ? tapped : wordStart(tokens, tapped);
  while (tokens[start]?.line === first.line && PUNCTUATION.test(tokens[start]!.text)) start++;
  if (tokens[start]?.line !== first.line) return '';
  const text = scanText(tokens, start, LOOKUP_LENGTH);
  const length = [...text.replace(/ /g, '')].length;
  if (length > LOOKUP_SHORT_LINE || SENTENCE_END.test(text)) return text;
  const next = nextLine(tokens, start);
  if (next < 0 || tokens[next]!.page !== first.page) return text;
  return joinWords([text, scanText(tokens, next, LOOKUP_LENGTH - length)]);
}
