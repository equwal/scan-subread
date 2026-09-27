// The page text as a plain-text book. Pure: no DOM.
//
// SubRead reads the book as text lines when it makes the subtitles. This
// module turns the page tokens (OCR or text layer) into that text.

import type { OcrToken } from './align';

/**
 * Han, kana and CJK punctuation: scripts that are written without spaces.
 * Script_Extensions (scx) also include the characters that these scripts
 * share, for example ー, ・, ゛ and ゜. Their Script is Common.
 */
const CJK = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}　-〿＀-￯]/u;

/** True when the first character of `text` is Han, kana or CJK punctuation. */
export function isCjk(text: string): boolean {
  return CJK.test(text);
}

/** True when a space belongs between two neighboring words. Not between two CJK words. */
function needsSpace(prev: string, next: string): boolean {
  // Split into code points: a character outside the BMP is two UTF-16 units.
  const last = [...prev].at(-1) ?? '';
  return !(isCjk(last) && isCjk(next));
}

/** One line from its words: a space between words, except between CJK words. */
export function joinWords(words: readonly string[]): string {
  let out = '';
  for (const w of words) {
    if (out.length > 0 && w.length > 0 && needsSpace(out, w)) out += ' ';
    out += w;
  }
  return out;
}

/**
 * One text line per OCR line, pages in order, one blank line between
 * pages. Words on a line are joined with `joinWords`. Blank lines inside
 * a page are dropped. The result ends with a newline.
 */
export function bookText(tokens: readonly OcrToken[]): string {
  const pages: string[][] = [];
  let lines: string[] = [];
  let words: string[] = [];
  let word = '';
  let page = -1;
  let lineId = -1;
  let wordId: number | undefined;

  const endWord = (): void => {
    const text = word.trim();
    if (text.length > 0) words.push(text);
    word = '';
  };
  const endLine = (): void => {
    endWord();
    const text = joinWords(words);
    if (text.length > 0) lines.push(text);
    words = [];
  };
  const endPage = (): void => {
    endLine();
    if (lines.length > 0) pages.push(lines);
    lines = [];
  };

  for (const t of tokens) {
    if (t.page !== page) {
      endPage();
      page = t.page;
      lineId = t.line;
      wordId = t.word;
    } else if (t.line !== lineId) {
      endLine();
      lineId = t.line;
      wordId = t.word;
    } else if (t.word !== wordId) {
      endWord();
      wordId = t.word;
    }
    word += t.text;
  }
  endPage();
  return pages.map((p) => p.join('\n')).join('\n\n') + (pages.length > 0 ? '\n' : '');
}
