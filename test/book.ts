// Synthetic books for the alignment tests: cue texts, pages of one token
// per character, and OCR noise. All randomness comes from fast-check.

import fc from 'fast-check';
import { normalizeText, type OcrToken } from '../src/align';

/** A small mixed alphabet: Latin, kana and kanji, so CJK is always covered. */
export const ALPHABET = [...'abcdefghijklmnop', ...'あいうえおかきくけこ', ...'吾輩猫名前春夏秋冬'];

export const char = fc.constantFrom(...ALPHABET);

export const word = (min: number, max: number): fc.Arbitrary<string> =>
  fc.array(char, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

export type Token = Pick<OcrToken, 'text' | 'page'>;

export interface Book {
  cues: string[];
  /** The start of each cue in the book text, and the end of the text last. */
  offsets: number[];
  /** The page of each character of the book text. */
  pageOf: number[];
  /** The tokens of each page, one for each character, after the noise. */
  pages: Token[][];
}

/**
 * One noise draw for each character: a number in [0, 1) and a character
 * for a substitution or an insertion. No bias, so the rate is exact.
 */
const draw = fc.tuple(
  fc.noBias(fc.integer({ min: 0, max: 9999 })).map((n) => n / 10000),
  char,
);

export interface BookShape {
  /** The count of cues. */
  cues: [number, number];
  /** The length of a cue in characters. */
  cueLength: [number, number];
  /** The length of a page in characters. The last page takes the rest. */
  pageLength: [number, number];
  /** The share of characters with an edit: a drop, a substitution or an insertion. */
  noise: number;
}

/** Books of the given shape. */
export function books(shape: BookShape): fc.Arbitrary<Book> {
  return fc
    .record({
      cues: fc.array(word(shape.cueLength[0], shape.cueLength[1]), {
        minLength: shape.cues[0],
        maxLength: shape.cues[1],
      }),
      pageLength: fc.integer({ min: shape.pageLength[0], max: shape.pageLength[1] }),
    })
    .chain(({ cues, pageLength }) => {
      const length = shape.noise > 0 ? cues.join('').length : 0;
      return fc
        .array(draw, { minLength: length, maxLength: length })
        .map((draws) => makeBook(cues, pageLength, draws, shape.noise));
    });
}

function makeBook(
  cues: string[],
  pageLength: number,
  draws: readonly [number, string][],
  noise: number,
): Book {
  const text = cues.join('');
  const offsets: number[] = [];
  let at = 0;
  for (const cue of cues) {
    offsets.push(at);
    at += cue.length;
  }
  offsets.push(at);
  const pageCount = Math.max(1, Math.floor(text.length / pageLength));
  const pageOf = [...text].map((_, i) => Math.min(pageCount - 1, Math.floor(i / pageLength)));
  const pages: Token[][] = Array.from({ length: pageCount }, () => []);
  [...text].forEach((ch, i) => {
    const page = pageOf[i]!;
    const [r, other] = draws[i] ?? [1, ch];
    // A third of the edits drop the character, a third put another in its
    // place, and a third put another before it.
    let read = [ch];
    if (r < noise / 3) read = [];
    else if (r < (2 * noise) / 3) read = [other];
    else if (r < noise) read = [other, ch];
    for (const text of read) pages[page]!.push({ text, page });
  });
  return { cues, offsets, pageOf, pages };
}

/** The pages that hold the characters of cue `i`. */
export function pagesOfCue(book: Book, i: number): Set<number> {
  const pages = new Set<number>();
  for (let k = book.offsets[i]!; k < book.offsets[i + 1]!; k++) pages.add(book.pageOf[k]!);
  return pages;
}

/** The runs of `k` characters in the normalized form of `text`. */
export function grams(text: string, k = 8): Set<string> {
  const norm = normalizeText(text);
  const out = new Set<string>();
  for (let i = 0; i + k <= norm.length; i++) out.add(norm.slice(i, i + k));
  return out;
}

/** The read pages of a book: `read[p]` true keeps page p, else it is undefined. */
export function readPages(book: Book, read: readonly boolean[]): (Token[] | undefined)[] {
  return book.pages.map((tokens, p) => (read[p] ? tokens : undefined));
}
