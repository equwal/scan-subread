// Convert a tesseract.js page result to flat symbol tokens. Pure: no DOM.

import type Tesseract from 'tesseract.js';
import type { OcrToken } from './align';

/** Line ids are unique across pages: page * LINES_PER_PAGE + line. */
export const LINES_PER_PAGE = 100000;

/**
 * One token per recognized symbol (character). Symbol level works for
 * both spaced scripts and CJK, where a Tesseract "word" can be a whole
 * line or column. The UI merges tokens on one line into one box. The
 * word id marks the word boundaries, so the book text keeps its spaces.
 */
export function pageToTokens(page: Pick<Tesseract.Page, 'blocks'>, pageIndex: number): OcrToken[] {
  const tokens: OcrToken[] = [];
  let line = 0;
  let word = 0;
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const ln of paragraph.lines) {
        const lineId = pageIndex * LINES_PER_PAGE + line;
        line++;
        for (const w of ln.words) {
          const wordId = pageIndex * LINES_PER_PAGE + word;
          word++;
          for (const symbol of w.symbols) {
            tokens.push({
              text: symbol.text,
              page: pageIndex,
              line: lineId,
              word: wordId,
              bbox: symbol.bbox,
            });
          }
        }
      }
    }
  }
  return tokens;
}
