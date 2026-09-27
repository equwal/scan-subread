// The subtitles of a book. Pure: no DOM.

/** The name of the .srt of a book: "Neko.pdf" gives "Neko.srt". */
export function srtName(bookName: string): string {
  return `${bookName.replace(/\.pdf$/i, '')}.srt`;
}

/**
 * What happens to the loaded subtitles when a book opens:
 *
 * - `keep`: they stay, and they are saved for the book.
 * - `load`: the saved subtitles of the book replace them.
 * - `clear`: they go, and the book has no subtitles.
 */
export type OpenStep = 'keep' | 'load' | 'clear';

/**
 * What happens to the loaded subtitles when the book `book` opens (see
 * bookKey). `loaded` is the book of the loaded subtitles: null when they
 * were loaded while no book was open, undefined when no subtitles are
 * loaded. `saved` is true when the book has saved subtitles.
 *
 * Subtitles belong to a book. Subtitles that were loaded while no book was
 * open are for the book that opens next, so they stay also when that book
 * has saved subtitles.
 */
export function subtitlesOnOpen(
  loaded: string | null | undefined,
  book: string,
  saved: boolean,
): OpenStep {
  if (loaded === null || loaded === book) return 'keep';
  return saved ? 'load' : 'clear';
}
