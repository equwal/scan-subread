import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../src/align';
import { SENTENCE_LENGTH, sentenceAround } from '../src/sentence';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** Tokens for one page, one per character: `lines` is a list of lines, each a list of words. */
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

/** The index of token number `n` (from 0) with the text `ch`. */
function find(tokens: readonly OcrToken[], ch: string, n = 0): number {
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.text !== ch) continue;
    if (seen === n) return i;
    seen++;
  }
  throw new Error(`No token ${ch} number ${n}.`);
}

describe('sentenceAround', () => {
  // 吾輩は猫である。名前は / まだ無い。どこで生れたか
  const jpn = pageTokens(0, [['吾輩は猫である。名前は'], ['まだ無い。どこで生れたか']]);

  // It was a dark / night. The rain fell.
  const eng = pageTokens(0, [
    ['It', 'was', 'a', 'dark'],
    ['night.', 'The', 'rain', 'fell.'],
  ]);

  it('reads a Japanese sentence over two lines, with no space at the line break', () => {
    expect(sentenceAround(jpn, find(jpn, '前'))).toBe('名前はまだ無い。');
  });

  it('reads an English sentence over two lines, with a space at the line break', () => {
    expect(sentenceAround(eng, find(eng, 'k'))).toBe('It was a dark night.');
    expect(sentenceAround(eng, find(eng, 'f'))).toBe('The rain fell.');
  });

  it('gives the same sentence for a tap on its first and on its last character', () => {
    expect(sentenceAround(jpn, find(jpn, '名'))).toBe('名前はまだ無い。');
    expect(sentenceAround(jpn, find(jpn, '。', 1))).toBe('名前はまだ無い。');
    expect(sentenceAround(jpn, find(jpn, '吾'))).toBe('吾輩は猫である。');
    expect(sentenceAround(jpn, find(jpn, '。', 0))).toBe('吾輩は猫である。');
    expect(sentenceAround(eng, find(eng, 'I'))).toBe('It was a dark night.');
    expect(sentenceAround(eng, find(eng, '.', 0))).toBe('It was a dark night.');
    expect(sentenceAround(eng, find(eng, 'T'))).toBe('The rain fell.');
    expect(sentenceAround(eng, find(eng, '.', 1))).toBe('The rain fell.');
  });

  it('runs to the edge of the page when no sentence end follows', () => {
    expect(sentenceAround(jpn, find(jpn, 'ど'))).toBe('どこで生れたか');
    const open = pageTokens(0, [['吾輩は猫で'], ['ある']]);
    expect(sentenceAround(open, find(open, '猫'))).toBe('吾輩は猫である');
    const words = pageTokens(0, [
      ['no', 'end', 'on'],
      ['this', 'page'],
    ]);
    expect(sentenceAround(words, find(words, 'h'))).toBe('no end on this page');
  });

  it('stays on the page of the tapped token', () => {
    const tokens = [...pageTokens(0, [['前の頁の文']]), ...pageTokens(1, [['次の頁の文。']])];
    expect(sentenceAround(tokens, find(tokens, '前'))).toBe('前の頁の文');
    expect(sentenceAround(tokens, find(tokens, '次'))).toBe('次の頁の文。');
  });

  it('keeps a closing bracket with the sentence that it ends', () => {
    const quotes = pageTokens(0, [['「おはよう。」「はい。」']]);
    expect(sentenceAround(quotes, find(quotes, 'よ'))).toBe('「おはよう。」');
    expect(sentenceAround(quotes, find(quotes, 'い'))).toBe('「はい。」');
    const english = pageTokens(0, [['"Go', 'away."', 'He', 'left.']]);
    expect(sentenceAround(english, find(english, 'G'))).toBe('"Go away."');
    expect(sentenceAround(english, find(english, 'H'))).toBe('He left.');
  });

  it('does not end a sentence at a closing bracket with no end mark before it', () => {
    const said = pageTokens(0, [['「はい」と言った。次']]);
    expect(sentenceAround(said, find(said, 'と'))).toBe('「はい」と言った。');
  });

  it('does not end a sentence at a decimal point', () => {
    const price = pageTokens(0, [['It', 'costs', '3.14', 'now.', 'Then', 'more.']]);
    expect(sentenceAround(price, find(price, 'c'))).toBe('It costs 3.14 now.');
  });

  it('cuts a long sentence around the tapped token', () => {
    const long = pageTokens(0, [['あ'.repeat(150) + '猫' + 'い'.repeat(150) + '。']]);
    expect(sentenceAround(long, find(long, '猫'), 21)).toBe(
      'あ'.repeat(10) + '猫' + 'い'.repeat(10),
    );
    expect(sentenceAround(long, 0)).toBe('あ'.repeat(150) + '猫' + 'い'.repeat(49));
    expect([...sentenceAround(long, 301)].length).toBe(SENTENCE_LENGTH);
  });

  it('returns an empty string for a token that does not exist', () => {
    expect(sentenceAround(jpn, jpn.length)).toBe('');
    expect(sentenceAround([], 0)).toBe('');
  });

  it('always holds the tapped token and is at most max characters', () => {
    const ch = fc.constantFrom('吾', 'は', 'a', 'Z', '7', '。', '！', '.', '?', '」', '"');
    const word = fc.array(ch, { minLength: 1, maxLength: 5 }).map((cs) => cs.join(''));
    const line = fc.array(word, { minLength: 1, maxLength: 4 });
    const page = fc.array(line, { minLength: 1, maxLength: 4 });
    const book = fc.array(page, { minLength: 1, maxLength: 3 });
    fc.assert(
      fc.property(book, fc.nat(), fc.integer({ min: 1, max: 40 }), (pages, pick, max) => {
        const tokens = pages.flatMap((lines, p) => pageTokens(p, lines));
        const index = pick % tokens.length;
        const tapped = tokens[index]!;
        const sentence = sentenceAround(tokens, index, max);
        expect(sentence).toContain(tapped.text);
        expect([...sentence].length).toBeLessThanOrEqual(max);
        // Without the spaces between words, the sentence is a piece of its page.
        const pageChars = tokens
          .filter((t) => t.page === tapped.page)
          .map((t) => t.text)
          .join('');
        expect(pageChars).toContain(sentence.replace(/ /g, ''));
      }),
    );
  });
});
