import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { isCjk } from '../src/book-text';
import {
  LOOKUP_LENGTH,
  lookupText,
  scanText,
  TAP_CSS,
  tapTolerance,
  tokenAt,
} from '../src/hit-test';

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

describe('tapTolerance', () => {
  it('converts the CSS pixels of a finger to page pixels', () => {
    expect(tapTolerance(1600, 400)).toBe(TAP_CSS * 4);
    expect(tapTolerance(1600, 800)).toBe(TAP_CSS * 2);
  });

  it('gets smaller when the page is zoomed in', () => {
    expect(tapTolerance(1600, 400, 2)).toBe(TAP_CSS * 2);
    expect(tapTolerance(1600, 400, 0.5)).toBe(TAP_CSS * 4);
  });

  it('finds a character 20 CSS pixels from a tap on a phone', () => {
    // A 1600-pixel page on a phone, 344 CSS pixels wide. The old tolerance,
    // 1.5% of the page width, was 24 page pixels: about 5 CSS pixels.
    const page = tokensOf(['abc']);
    const scale = 1600 / 344;
    const x = page[2]!.bbox.x1 + 20 * scale;
    expect(tokenAt(page, 0, x, 10, 0.015 * 1600)).toBe(-1);
    expect(tokenAt(page, 0, x, 10, tapTolerance(1600, 344))).toBe(2);
  });
});

/** Tokens of one line of words, with a word id per word. Spaces are not tokens. */
function wordTokens(words: string[], page = 0, line = 0): OcrToken[] {
  const tokens: OcrToken[] = [];
  let col = 0;
  words.forEach((w, wi) => {
    for (const ch of w) {
      tokens.push({
        text: ch,
        page,
        line,
        word: wi,
        bbox: { x0: col * 10, y0: 0, x1: col * 10 + 10, y1: 20 },
      });
      col++;
    }
    col++;
  });
  return tokens;
}

/** Tokens of a page of text lines, a word id per word. A space separates two words. */
function pageTokens(lines: string[], page = 0): OcrToken[] {
  return lines.flatMap((line, row) => wordTokens(line.split(' '), page, page * 100 + row));
}

/** Index of the token of the `n`-th `ch` (from 0) on line `line`. */
function tapOn(tokens: readonly OcrToken[], line: number, ch: string, n = 0): number {
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.line === line && t.text === ch && seen++ === n) return i;
  }
  throw new Error(`No ${ch} number ${n} on line ${line}`);
}

describe('scanText', () => {
  it('reads to the end of the line, up to the limit', () => {
    const tokens = tokensOf(['吾輩は猫である', '名前はまだ無い']);
    expect(scanText(tokens, 3)).toBe('猫である');
    expect(scanText(tokens, 0, 3)).toBe('吾輩は');
    expect(scanText(tokens, 99)).toBe('');
  });

  it('puts a space between words, and the spaces do not count', () => {
    const tokens = wordTokens(['who', 'answered', 'with']);
    expect(scanText(tokens, 0)).toBe('who answered with');
    expect(scanText(tokens, 1)).toBe('ho answered with');
    expect(scanText(tokens, 0, 10)).toBe('who answere');
    expect(scanText(wordTokens(['吾輩', 'は', 'cat']), 0)).toBe('吾輩は cat');
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

  it('puts no space around ー when OCR gives it a word of its own', () => {
    const tokens = wordTokens(['ニャ', 'ー', '泣いていた事だけは記憶している。']);
    expect(lookupText(tokens, 0)).toBe('ニャー泣いていた事だけは記憶している。');
  });

  it('joins a short line and the next line with a space', () => {
    const tokens = [...wordTokens(['the', 'end'], 0, 0), ...wordTokens(['of', 'it'], 0, 1)];
    expect(lookupText(tokens, 3)).toBe('end of it');
  });

  it('does not cross to the next page', () => {
    const tokens = [...wordTokens(['abc', 'def'], 0, 0), ...wordTokens(['ghi', 'jkl'], 1, 100)];
    expect(lookupText(tokens, 4)).toBe('def');
    expect(lookupText(tokens, 10)).toBe('jkl');
  });

  it('stops at the lookup length', () => {
    const tokens = tokensOf(['a'.repeat(60), 'b'.repeat(60)]);
    expect(lookupText(tokens, 0)).toBe('a'.repeat(LOOKUP_LENGTH));
    // A line break is a word break: a space goes between the two lines.
    const wrapped = [
      ...wordTokens(['a'.repeat(58), 'aa'], 0, 0),
      ...wordTokens(['b'.repeat(60)], 0, 1),
    ];
    expect(lookupText(wrapped, 58)).toBe('aa ' + 'b'.repeat(LOOKUP_LENGTH - 2));
  });

  it('starts at the first letter of a word that is not CJK', () => {
    const tokens = [
      ...pageTokens([
        'The morning sun rose over the quiet hills,',
        'and the village below began to stir.',
        'Far away, a bell rang nine slow times.',
        'with nothing more than light and sound.',
      ]),
      ...pageTokens(['It rolled across the fields and woke the geese,'], 1),
    ];
    expect(lookupText(tokens, tapOn(tokens, 0, 'r'))).toBe(
      'morning sun rose over the quiet hills,',
    );
    expect(lookupText(tokens, tapOn(tokens, 2, 'e'))).toBe('bell rang nine slow times.');
    expect(lookupText(tokens, tapOn(tokens, 100, 't'))).toBe(
      'It rolled across the fields and woke the geese,',
    );
    // A punctuation mark in a word also gives the word.
    expect(lookupText(tokens, tapOn(tokens, 0, ','))).toBe('hills,');
    expect(lookupText(tokens, tapOn(tokens, 3, '.'))).toBe('sound.');
  });

  it('stops at a CJK character when it looks for the start of a word', () => {
    // Japanese OCR can give one word for a whole line.
    const tokens = wordTokens(['今日は2026年9月26日です。']);
    expect(lookupText(tokens, tapOn(tokens, 0, '6'))).toBe('2026年9月26日です。');
    expect(lookupText(tokens, tapOn(tokens, 0, '9'))).toBe('9月26日です。');
  });

  it('skips punctuation at the start, and gives nothing when only punctuation is left', () => {
    const tokens = tokensOf([
      '吾輩は猫である。名前はまだ無い。',
      'どこで生れたかとんと見当がつかぬ。',
      '人間中で一番獰悪な種族であったそうだ。',
    ]);
    expect(lookupText(tokens, tapOn(tokens, 0, '。'))).toBe('名前はまだ無い。');
    expect(lookupText(tokens, tapOn(tokens, 0, '。', 1))).toBe('');
    expect(lookupText(tokens, tapOn(tokens, 2, '。'))).toBe('');
    const quoted = wordTokens(['"Hello,"', 'she', 'said.']);
    expect(lookupText(quoted, 0)).toBe('Hello," she said.');
  });

  it('adds no next line after the end of a sentence', () => {
    const tokens = tokensOf([
      '吾輩は猫である。名前はまだ無い。',
      'どこで生れたかとんと見当がつかぬ。',
    ]);
    expect(lookupText(tokens, tapOn(tokens, 0, '無'))).toBe('無い。');
    const quote = tokensOf(['彼は言った「猫だ」', '次の行']);
    expect(lookupText(quote, tapOn(quote, 0, '猫'))).toBe('猫だ」');
    const english = [...wordTokens(['the', 'end.'], 0, 0), ...wordTokens(['Then', 'more.'], 0, 1)];
    expect(lookupText(english, 3)).toBe('end.');
  });

  it('never returns more than the lookup length, and starts at the tapped CJK character', () => {
    const line = fc.stringMatching(/^[\p{L}]{1,50}$/u);
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 4 }), fc.nat(), (lines, pick) => {
        const tokens = tokensOf(lines);
        const start = pick % tokens.length;
        const text = lookupText(tokens, start);
        expect([...text.replace(/ /g, '')].length).toBeLessThanOrEqual(LOOKUP_LENGTH);
        if (isCjk(tokens[start]!.text)) expect(text.startsWith(tokens[start]!.text)).toBe(true);
      }),
    );
  });

  it('starts at the first letter of the tapped Latin word', () => {
    const word = fc.stringMatching(/^[A-Za-z]{1,10}$/);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.nat(),
        (words, pickWord, pickLetter) => {
          const k = pickWord % words.length;
          const tap = words.slice(0, k).join('').length + (pickLetter % words[k]!.length);
          const text = lookupText(wordTokens(words), tap);
          expect(text.split(' ')[0]).toBe(words[k]);
        },
      ),
    );
  });
});
