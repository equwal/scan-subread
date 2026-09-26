import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { lineBoxes } from '../src/line-boxes';

function token(page: number, line: number, x0: number, y0: number): OcrToken {
  return { text: 'a', page, line, bbox: { x0, y0, x1: x0 + 10, y1: y0 + 20 } };
}

const tokens = [
  token(0, 0, 0, 0),
  token(0, 0, 10, 2),
  token(0, 1, 0, 30),
  token(1, 100000, 0, 0),
  token(1, 100000, 10, 0),
];

describe('lineBoxes', () => {
  it('gives one box for each line, the union of its token boxes', () => {
    expect(lineBoxes(tokens, { start: 0, end: 3, matched: true }, 0)).toEqual([
      { x0: 0, y0: 0, x1: 20, y1: 22 },
      { x0: 0, y0: 30, x1: 10, y1: 50 },
    ]);
  });

  it('leaves out the tokens on other pages', () => {
    expect(lineBoxes(tokens, { start: 2, end: 5, matched: true }, 1)).toEqual([
      { x0: 0, y0: 0, x1: 20, y1: 20 },
    ]);
  });

  it('skips token indices past the end of the tokens', () => {
    // A span from the alignment before the pages were read again: the
    // token list is now shorter than the span.
    expect(lineBoxes(tokens.slice(0, 2), { start: 0, end: 5, matched: true }, 0)).toEqual([
      { x0: 0, y0: 0, x1: 20, y1: 22 },
    ]);
  });
});
