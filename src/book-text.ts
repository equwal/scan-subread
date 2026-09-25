// The page text as a plain-text book. Pure: no DOM.
//
// SubRead reads the book as text lines when it makes the subtitles. This
// module turns the page tokens (OCR or text layer) into that text.

import type { OcrToken } from './align';

/** Han, kana and CJK punctuation: scripts that are written without spaces. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** True when a space belongs between two neighboring words. Not between two CJK words. */
function needsSpace(prev: string, next: string): boolean {
  return !(CJK.test(prev.slice(-1)) && CJK.test(next.slice(0, 1)));
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

/** The Whisper language code for a tesseract language ("jpn", "jpn_vert", "jpn+eng", "eng"). */
export function whisperCode(ocrLang: string): 'ja' | 'en' {
  return ocrLang.startsWith('jpn') ? 'ja' : 'en';
}
