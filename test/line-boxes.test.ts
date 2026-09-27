import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken, TokenSpan } from '../src/align';
import { lineBoxes, type Box } from '../src/line-boxes';

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

/**
 * Tokens of text lines, one token per character, 10 px per character and
 * 20 px per line. A space separates two words and gets no token.
 */
function textTokens(lines: string[], page = 0): OcrToken[] {
  const out: OcrToken[] = [];
  let word = 0;
  lines.forEach((text, row) => {
    [...text].forEach((ch, col) => {
      if (ch === ' ') {
        word++;
        return;
      }
      const x0 = col * 10;
      const y0 = row * 20;
      out.push({ text: ch, page, line: row, word, bbox: { x0, y0, x1: x0 + 10, y1: y0 + 20 } });
    });
    word++;
  });
  return out;
}

/** A matched span of the tokens `from` to `to`, `to` not included. */
function spanOf(from: number, to: number): TokenSpan {
  return { start: from, end: to, matched: true };
}

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

  it('grows to the comma and the last letter that the alignment dropped', () => {
    // "quiet hills," with the span to "hill": the alignment dropped "s,".
    const line = textTokens(['quiet hills,']);
    expect(line.map((t) => t.text).join('')).toBe('quiethills,');
    const box = lineBoxes(line, spanOf(0, 9), 0);
    expect(box).toEqual([{ x0: 0, y0: 0, x1: 120, y1: 20 }]);
  });

  it('grows to the start of the first word', () => {
    // The span starts at "ills", in the middle of "hills".
    const line = textTokens(['the hills rose']);
    expect(lineBoxes(line, spanOf(4, 8), 0)).toEqual([{ x0: 40, y0: 0, x1: 90, y1: 20 }]);
  });

  it('does not grow over the next word or the next line', () => {
    const page = textTokens(['one two', 'three']);
    // The span is "two": the box stays on "two".
    expect(lineBoxes(page, spanOf(3, 6), 0)).toEqual([{ x0: 40, y0: 0, x1: 70, y1: 20 }]);
  });

  it('grows over CJK punctuation, but not over a CJK letter of the same OCR word', () => {
    // Japanese OCR gave one word for the whole line.
    const line = textTokens(['吾輩は猫である。名前は']);
    // The span is 猫である: 。 joins the box, 名前は does not.
    expect(lineBoxes(line, spanOf(3, 7), 0)).toEqual([{ x0: 30, y0: 0, x1: 80, y1: 20 }]);
    // The span is 名前: the 。 before it ends the cue before, and は is a letter.
    expect(lineBoxes(line, spanOf(8, 10), 0)).toEqual([{ x0: 80, y0: 0, x1: 100, y1: 20 }]);
    // The span is 猫だ: the brackets around it join.
    const quote = textTokens(['彼は「猫だ」と言った']);
    expect(lineBoxes(quote, spanOf(3, 5), 0)).toEqual([{ x0: 20, y0: 0, x1: 60, y1: 20 }]);
  });

  it('grows over CJK punctuation that OCR gave a word of its own', () => {
    // Tesseract jpn on sample-jpn: the 。 at the end of the line is a word.
    const words = ['吾輩は', '猫である', '。', '名前はまだ無い', '。'];
    const line: OcrToken[] = [];
    words.forEach((w, word) => {
      for (const ch of w) {
        const x0 = line.length * 10;
        line.push({ text: ch, page: 0, line: 0, word, bbox: { x0, y0: 0, x1: x0 + 10, y1: 20 } });
      }
    });
    // The span is 名前はまだ無い: the last 。 joins.
    expect(lineBoxes(line, spanOf(8, 15), 0)).toEqual([{ x0: 80, y0: 0, x1: 160, y1: 20 }]);
    // The span is 猫である: the 。 after it joins, は before it does not.
    expect(lineBoxes(line, spanOf(3, 7), 0)).toEqual([{ x0: 30, y0: 0, x1: 80, y1: 20 }]);
  });

  it('pads each box on each side', () => {
    const line = textTokens(['quiet hills,']);
    expect(lineBoxes(line, spanOf(0, 9), 0, 3)).toEqual([{ x0: -3, y0: -3, x1: 123, y1: 23 }]);
  });

  it('gives the box of the whole words of the span on each line', () => {
    // Latin words and punctuation: a whole word of each span token is in the
    // box. A slow reference: the union of the tokens of the span and of the
    // tokens that share a line and a word id with a span token.
    const word = fc.stringMatching(/^[a-z,.;!?"]{1,6}$/);
    const text = fc.array(fc.array(word, { minLength: 1, maxLength: 5 }), {
      minLength: 1,
      maxLength: 4,
    });
    const input = text.chain((lines) => {
      const page = textTokens(lines.map((words) => words.join(' ')));
      return fc.tuple(
        fc.constant(page),
        fc.nat({ max: page.length - 1 }),
        fc.nat({ max: page.length - 1 }),
        fc.nat({ max: 5 }),
      );
    });
    fc.assert(
      fc.property(input, ([page, a, b, pad]) => {
        const span = spanOf(Math.min(a, b), Math.max(a, b) + 1);
        const inSpan = page.slice(span.start, span.end);
        const expected = new Map<number, Box>();
        for (const t of page) {
          const keep = inSpan.some((s) => s === t || (s.line === t.line && s.word === t.word));
          if (!keep) continue;
          const box = expected.get(t.line);
          if (!box) expected.set(t.line, { ...t.bbox });
          else {
            box.x0 = Math.min(box.x0, t.bbox.x0);
            box.y0 = Math.min(box.y0, t.bbox.y0);
            box.x1 = Math.max(box.x1, t.bbox.x1);
            box.y1 = Math.max(box.y1, t.bbox.y1);
          }
        }
        const padded = [...expected.values()].map((b) => ({
          x0: b.x0 - pad,
          y0: b.y0 - pad,
          x1: b.x1 + pad,
          y1: b.y1 + pad,
        }));
        expect(lineBoxes(page, span, 0, pad)).toEqual(padded);
      }),
    );
  });
});
