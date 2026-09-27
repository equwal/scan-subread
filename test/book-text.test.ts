import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { bookText, joinWords } from '../src/book-text';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** The non-blank lines of a book text, trimmed. */
function paragraphs(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Tokens for one page: `lines` is a list of lines, each a list of words. */
function pageTokens(page: number, lines: readonly (readonly string[])[]): OcrToken[] {
  const out: OcrToken[] = [];
  lines.forEach((words, li) => {
    words.forEach((word, wi) => {
      for (const ch of word) {
        out.push({
          text: ch,
          page,
          line: page * 1000 + li,
          word: page * 1000 + li * 100 + wi,
          bbox: box,
        });
      }
    });
  });
  return out;
}

describe('bookText', () => {
  it('joins symbols into words, words into lines, and separates pages with a blank line', () => {
    const tokens = [
      ...pageTokens(0, [
        ['The', 'sun'],
        ['rose', 'up'],
      ]),
      ...pageTokens(1, [['朝の', '光']]),
    ];
    expect(bookText(tokens)).toBe('The sun\nrose up\n\n朝の光\n');
  });

  it('puts a space between words unless both sides are CJK', () => {
    expect(joinWords(['吾輩', 'は', '猫'])).toBe('吾輩は猫');
    expect(joinWords(['The', 'sun'])).toBe('The sun');
    expect(joinWords(['東京', 'Tokyo', '駅'])).toBe('東京 Tokyo 駅');
    expect(joinWords(['名前', '。', 'まだ'])).toBe('名前。まだ');
  });

  it('puts no space around the prolonged sound mark and the other kana marks', () => {
    // OCR put ー in a word of its own. Its Script is Common, not Katakana.
    const words = ['ニャ', 'ー', '泣いていた事だけは記憶している。'];
    expect(joinWords(words)).toBe('ニャー泣いていた事だけは記憶している。');
    expect(bookText(pageTokens(0, [words]))).toBe('ニャー泣いていた事だけは記憶している。\n');
    for (const mark of ['ー', '・', '゛', '゜', '々', '〆']) {
      expect(joinWords(['ア', mark, 'イ'])).toBe(`ア${mark}イ`);
    }
  });

  it('puts no space between words of Han, kana, ー and ・, outside the BMP too', () => {
    // Each list of words is one split of the string that the words make.
    const word = fc.stringMatching(
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・]{1,6}$/u,
    );
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 8 }), (words) => {
        expect(joinWords(words)).toBe(words.join(''));
      }),
    );
  });

  it('returns an empty string for no tokens', () => {
    expect(bookText([])).toBe('');
  });

  it('treats tokens without a word id as one word per line', () => {
    const tokens: OcrToken[] = [
      { text: 'a', page: 0, line: 0, bbox: box },
      { text: 'b', page: 0, line: 0, bbox: box },
      { text: 'c', page: 0, line: 1, bbox: box },
    ];
    expect(bookText(tokens)).toBe('ab\nc\n');
  });

  it('drops lines that hold only whitespace', () => {
    const tokens: OcrToken[] = [
      { text: ' ', page: 0, line: 0, bbox: box },
      { text: 'x', page: 0, line: 1, bbox: box },
    ];
    expect(bookText(tokens)).toBe('x\n');
  });

  it('round trips through paragraphs: every OCR line once, in order', () => {
    // A word: letters only, so a word never holds a space or a line break.
    const word = fc.stringMatching(/^[\p{L}\p{N}]{1,6}$/u);
    const line = fc.array(word, { minLength: 1, maxLength: 5 });
    const page = fc.array(line, { minLength: 1, maxLength: 6 });
    const book = fc.array(page, { maxLength: 4 });
    fc.assert(
      fc.property(book, (pages) => {
        const tokens = pages.flatMap((lines, p) => pageTokens(p, lines));
        const expected = pages.flatMap((lines) => lines.map(joinWords));
        expect(paragraphs(bookText(tokens))).toEqual(expected);
      }),
    );
  });
});
