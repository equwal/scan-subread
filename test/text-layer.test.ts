import { describe, expect, it } from 'vitest';
import { bookText } from '../src/book-text';
import { textChars, textItemsToTokens, type TextItemLike } from '../src/text-layer';

/** A page 200 pt wide and 300 pt high, rendered 2 px per pt, y flipped. */
const toPixel = (x: number, y: number): [number, number] => [2 * x, 2 * (300 - y)];

function item(over: Partial<TextItemLike> & Pick<TextItemLike, 'str'>): TextItemLike {
  return {
    dir: 'ltr',
    transform: [12, 0, 0, 12, 10, 100],
    width: 60,
    height: 12,
    hasEOL: false,
    ...over,
  };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function expectBox(box: Box, expected: Box): void {
  for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(box[k], k).toBeCloseTo(expected[k], 6);
}

describe('textItemsToTokens', () => {
  it('splits a horizontal run into one box per character, left to right', () => {
    const tokens = textItemsToTokens([item({ str: 'abc', width: 30 })], 0, toPixel);
    expect(tokens.map((t) => t.text)).toEqual(['a', 'b', 'c']);
    expect(tokens.map((t) => t.line)).toEqual([0, 0, 0]);
    // 10 pt each, from x = 10; the box spans 0.25 below to 0.8 above the baseline y = 100.
    expectBox(tokens[0]!.bbox, { x0: 20, y0: 2 * (300 - 109.6), x1: 40, y1: 2 * (300 - 97) });
    expect(tokens[1]!.bbox.x0).toBeCloseTo(40, 6);
    expect(tokens[2]!.bbox.x1).toBeCloseTo(80, 6);
  });

  it('stacks the characters of a vertical font down the page', () => {
    // A vertical run at x = 150 from y = 250 down, 14 pt per glyph.
    const tokens = textItemsToTokens(
      [
        item({
          str: '吾輩は',
          dir: 'ttb',
          transform: [14, 0, 0, 14, 150, 250],
          width: 14,
          height: 42,
        }),
      ],
      0,
      toPixel,
    );
    expect(tokens.map((t) => t.text)).toEqual(['吾', '輩', 'は']);
    expectBox(tokens[0]!.bbox, {
      x0: 2 * 143,
      y0: 2 * (300 - 250),
      x1: 2 * 157,
      y1: 2 * (300 - 236),
    });
    expect(tokens[1]!.bbox.y0).toBeCloseTo(2 * (300 - 236), 6);
    expect(tokens[2]!.bbox.y1).toBeCloseTo(2 * (300 - 208), 6);
    expect(new Set(tokens.map((t) => t.line)).size).toBe(1);
  });

  it('lays a run rotated by 90 degrees along y', () => {
    // Text that reads upward: the x axis of the font points up the page.
    const tokens = textItemsToTokens(
      [item({ str: 'ab', transform: [0, 12, -12, 0, 50, 100], width: 24, height: 12 })],
      0,
      toPixel,
    );
    expect(tokens[0]!.bbox.y0).toBeGreaterThan(tokens[1]!.bbox.y0);
    expect(tokens[0]!.bbox.x0).toBeCloseTo(tokens[1]!.bbox.x0, 6);
  });

  it('gives two baselines two lines, and one baseline one line', () => {
    const tokens = textItemsToTokens(
      [
        item({ str: 'The ', width: 40 }),
        item({ str: 'sun', width: 30, transform: [12, 0, 0, 12, 50, 101] }),
        item({ str: 'rose', width: 40, transform: [12, 0, 0, 12, 10, 80] }),
      ],
      1,
      toPixel,
    );
    expect(tokens.map((t) => t.text).join('')).toBe('Thesunrose');
    const lines = tokens.map((t) => t.line);
    expect(lines.slice(0, 6).every((l) => l === lines[0])).toBe(true);
    expect(lines[6]).not.toBe(lines[0]);
    expect(lines[0]).toBe(100000);
    expect(bookText(tokens)).toBe('The sun\nrose\n');
  });

  it('starts a new line after hasEOL, even on the same baseline', () => {
    const tokens = textItemsToTokens(
      [item({ str: 'ab', hasEOL: true }), item({ str: 'cd' })],
      0,
      toPixel,
    );
    expect(tokens[0]!.line).not.toBe(tokens[2]!.line);
  });

  it('drops spaces and bumps the word id at each', () => {
    const tokens = textItemsToTokens([item({ str: 'a b' })], 0, toPixel);
    expect(tokens.map((t) => t.text)).toEqual(['a', 'b']);
    expect(tokens[0]!.word).not.toBe(tokens[1]!.word);
  });
});

describe('textChars', () => {
  it('counts the non-space characters', () => {
    expect(textChars([item({ str: 'a b ' }), item({ str: ' ' }), item({ str: 'cd' })])).toBe(4);
  });
});
