import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { LOOKUP_LENGTH, lookupText, scanText, tokenAt } from '../src/hit-test';

/** Tokens for one page: `lines` laid out left to right, 10 px per character. */
function tokensOf(lines: string[], page = 0): OcrToken[] {
  const tokens: OcrToken[] = [];
  lines.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      tokens.push({
        text: ch,
        page,
        line: page * 100 + row,
        bbox: { x0: col * 10, y0: row * 20, x1: col * 10 + 10, y1: row * 20 + 20 },
      });
    });
  });
  return tokens;
}

describe('tokenAt', () => {
  const tokens = [...tokensOf(['abc', 'de'], 0), ...tokensOf(['xyz'], 1)];

  it('finds the token under the point', () => {
    expect(tokenAt(tokens, 0, 15, 5, 5)).toBe(1);
    expect(tokenAt(tokens, 0, 5, 25, 5)).toBe(3);
  });

  it('finds the nearest token within the tolerance', () => {
    expect(tokenAt(tokens, 0, 33, 10, 5)).toBe(2);
    expect(tokenAt(tokens, 0, 40, 10, 5)).toBe(-1);
  });

  it('prefers the box with the nearest center when boxes overlap', () => {
    // OCR gave 輩 a box that covers は and 猫 too.
    const wide: OcrToken[] = [
      { text: '輩', page: 0, line: 0, bbox: { x0: 212, y0: 228, x1: 418, y1: 265 } },
      { text: 'は', page: 0, line: 0, bbox: { x0: 235, y0: 222, x1: 282, y1: 279 } },
      { text: '猫', page: 0, line: 0, bbox: { x0: 281, y0: 222, x1: 336, y1: 279 } },
    ];
    expect(tokenAt(wide, 0, 310, 250, 5)).toBe(2);
    expect(tokenAt(wide, 0, 250, 250, 5)).toBe(1);
    expect(tokenAt(wide, 0, 400, 250, 5)).toBe(0);
  });

  it('looks only at the given page', () => {
    expect(tokenAt(tokens, 1, 5, 5, 5)).toBe(5);
    expect(tokenAt(tokens, 2, 5, 5, 5)).toBe(-1);
  });
});

describe('scanText', () => {
  it('reads to the end of the line, up to the limit', () => {
    const tokens = tokensOf(['吾輩は猫である', '名前はまだ無い']);
    expect(scanText(tokens, 3)).toBe('猫である');
    expect(scanText(tokens, 0, 3)).toBe('吾輩は');
    expect(scanText(tokens, 99)).toBe('');
  });
});

describe('lookupText', () => {
  it('reads to the end of the line', () => {
    const tokens = tokensOf(['吾輩は猫である', '名前はまだ無い']);
    expect(lookupText(tokens, 2)).toBe('は猫である');
  });

  it('adds the next line when the line ends within four characters', () => {
    const tokens = tokensOf(['吾輩は猫である', '名前はまだ無い']);
    expect(lookupText(tokens, 4)).toBe('である名前はまだ無い');
    expect(lookupText(tokens, 3)).toBe('猫である名前はまだ無い');
  });

  it('does not cross to the next page', () => {
    const tokens = [...tokensOf(['abcdef'], 0), ...tokensOf(['ghijkl'], 1)];
    expect(lookupText(tokens, 4)).toBe('ef');
    expect(lookupText(tokens, 10)).toBe('kl');
  });

  it('stops at the lookup length', () => {
    const tokens = tokensOf(['a'.repeat(60), 'b'.repeat(60)]);
    expect(lookupText(tokens, 0)).toBe('a'.repeat(LOOKUP_LENGTH));
    expect(lookupText(tokens, 58)).toBe('aa' + 'b'.repeat(LOOKUP_LENGTH - 2));
  });

  it('never returns more than the lookup length, and always starts with the tapped character', () => {
    const line = fc.stringMatching(/^[\p{L}]{1,50}$/u);
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 4 }), fc.nat(), (lines, pick) => {
        const tokens = tokensOf(lines);
        const start = pick % tokens.length;
        const text = lookupText(tokens, start);
        expect([...text].length).toBeLessThanOrEqual(LOOKUP_LENGTH);
        expect(text.startsWith(tokens[start]!.text)).toBe(true);
      }),
    );
  });
});
