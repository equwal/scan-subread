// The boxes that mark a cue on the page. Pure: no DOM.

import type { OcrToken, TokenSpan } from './align';

export type Box = OcrToken['bbox'];

/**
 * One box for each text line of `span` on `page`: the union of the boxes
 * of its tokens on that line. Tokens on other pages do not count. A span
 * of an older alignment can go past the end of `tokens`: those indices
 * do not count either.
 */
export function lineBoxes(tokens: readonly OcrToken[], span: TokenSpan, page: number): Box[] {
  const lines = new Map<number, Box>();
  for (let t = span.start; t < span.end; t++) {
    const token = tokens[t];
    if (!token || token.page !== page) continue;
    const box = lines.get(token.line);
    if (!box) lines.set(token.line, { ...token.bbox });
    else {
      box.x0 = Math.min(box.x0, token.bbox.x0);
      box.y0 = Math.min(box.y0, token.bbox.y0);
      box.x1 = Math.max(box.x1, token.bbox.x1);
      box.y1 = Math.max(box.y1, token.bbox.y1);
    }
  }
  return [...lines.values()];
}
