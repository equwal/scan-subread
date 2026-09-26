// The boxes that mark a cue on the page. Pure: no DOM.

import type { OcrToken, TokenSpan } from './align';
import { isCjk } from './book-text';

export type Box = OcrToken['bbox'];

/** A token of punctuation or symbols only. */
const PUNCTUATION = /^[\p{P}\p{S}]+$/u;

/** A token of opening punctuation only: a bracket or a quote that opens. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;

/**
 * True when the box of a line can grow from the edge token of the span
 * over `next`, the token before it (`back`) or after it. Both must have the
 * same page, line and word id.
 *
 * In a word that is not CJK, all its tokens join: the spaces show where
 * the word ends. Japanese OCR can give one word for a whole line, so in a
 * CJK word only punctuation joins: an opening mark before the span, and
 * another mark after it. A 。 before the span ends the cue before.
 */
function joins(edge: OcrToken, next: OcrToken | undefined, back: boolean): next is OcrToken {
  if (
    next === undefined ||
    edge.word === undefined ||
    next.page !== edge.page ||
    next.line !== edge.line ||
    next.word !== edge.word
  ) {
    return false;
  }
  if (!isCjk(edge.text)) return !isCjk(next.text) || PUNCTUATION.test(next.text);
  if (back) return OPENING.test(next.text);
  return PUNCTUATION.test(next.text) && !OPENING.test(next.text);
}

/** Grows `box` so that it holds `bbox`. */
function grow(box: Box, bbox: Box): void {
  box.x0 = Math.min(box.x0, bbox.x0);
  box.y0 = Math.min(box.y0, bbox.y0);
  box.x1 = Math.max(box.x1, bbox.x1);
  box.y1 = Math.max(box.y1, bbox.y1);
}

/**
 * One box for each text line of `span` on `page`: the union of the boxes
 * of its tokens on that line, plus `pad` pixels on each side. Tokens on
 * other pages do not count. A span of an older alignment can go past the
 * end of `tokens`: those indices do not count either.
 *
 * The alignment drops punctuation, and it can drop a noisy letter at the
 * edge of a cue. So the box of a line grows to the edges of its first and
 * its last word (see `joins`).
 */
export function lineBoxes(
  tokens: readonly OcrToken[],
  span: TokenSpan,
  page: number,
  pad = 0,
): Box[] {
  /** For each line: its box, and the first and the last token of the span on it. */
  const lines = new Map<number, { box: Box; first: number; last: number }>();
  for (let t = span.start; t < span.end; t++) {
    const token = tokens[t];
    if (!token || token.page !== page) continue;
    const line = lines.get(token.line);
    if (!line) lines.set(token.line, { box: { ...token.bbox }, first: t, last: t });
    else {
      grow(line.box, token.bbox);
      line.last = t;
    }
  }
  return [...lines.values()].map(({ box, first, last }) => {
    for (let t = first - 1; joins(tokens[first]!, tokens[t], true); t--) grow(box, tokens[t]!.bbox);
    for (let t = last + 1; joins(tokens[last]!, tokens[t], false); t++) grow(box, tokens[t]!.bbox);
    return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
  });
}
