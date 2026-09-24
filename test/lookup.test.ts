import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { lookup, memoryFinder, scanText, tokenAt } from '../src/lookup';
import { openDictionaryZip, type DictTerm } from '../src/yomitan';
import { buildTestDictionaryZip } from '../fixtures/test-dict';

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

describe('lookup', () => {
  const dict = openDictionaryZip(buildTestDictionaryZip());
  const terms: DictTerm[] = dict.termBanks.flatMap((n) => dict.readTermBank(n));
  const find = memoryFinder(terms);

  it('returns the longest match first', async () => {
    const results = await lookup('吾輩は猫である', find);
    expect(results[0]).toMatchObject({ surface: '吾輩', rules: [] });
    expect(results[0]!.term.glossary).toEqual(['I, me (archaic, pompous)']);
  });

  it('matches a deinflected verb', async () => {
    const results = await lookup('泣いていた事', find);
    expect(results[0]).toMatchObject({
      surface: '泣いていた',
      rules: ['past', 'progressive', 'te'],
    });
    expect(results[0]!.term.expression).toBe('泣く');
  });

  it('matches a reading', async () => {
    const results = await lookup('ねこ', find);
    expect(results.map((r) => r.term.expression)).toEqual(['猫']);
  });

  it('checks the part of speech of a deinflected match', async () => {
    // 猫 has no verb rules, so 猫る is not accepted through the "negative" rule.
    const catVerb: DictTerm = {
      expression: '猫る',
      reading: '',
      rules: 'v5',
      score: 0,
      glossary: [],
    };
    const results = await lookup('猫ない', memoryFinder([...terms, catVerb]));
    expect(results.map((r) => r.term.expression)).toEqual(['猫']);
  });

  it('returns nothing when no prefix matches', async () => {
    expect(await lookup('xyz', find)).toEqual([]);
    expect(await lookup('', find)).toEqual([]);
  });
});
