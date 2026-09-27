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

/**
 * The name of the result file of SubRead for the book `book` (see bookKey),
 * for example "subread-1a2b3c4d.srt". The plugin keeps only A-Z, a-z, 0-9,
 * ".", "_" and "-" of a name, so a Japanese file name gives only "_". The
 * FNV-1a hash of the key tells two books apart.
 */
export function resultName(book: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(book)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return `subread-${hash.toString(16).padStart(8, '0')}.srt`;
}

/** A SubRead result is suspect when it found less than this share of the lines in the book. */
export const LOW_MATCH_RATE = 0.8;

/** What the reader knows when SubRead gives subtitles for the open book. */
export interface SubreadCheck {
  /** The narration language that the user asked SubRead for: "auto", "ja", "en". */
  requested: string;
  /** The OCR language of the book: "eng", "jpn", "jpn_vert", "jpn+eng". */
  ocrLang: string;
  /** The language that SubRead found, when it tells. */
  language?: string | null;
  /** 0 to 1: the share of the lines that SubRead found in the book, when it tells. */
  matchRate?: number;
  /** The subtitles that are loaded now, if any. */
  loaded?: { name: string; source: 'file' | 'subread' } | null;
}

/** The languages that the narration can have: the requested one, else those of the OCR language. */
function expectedLanguages(requested: string, ocrLang: string): string[] {
  if (requested !== 'auto') return [requested];
  const out: string[] = [];
  if (ocrLang.includes('jpn')) out.push('ja');
  if (ocrLang.includes('eng')) out.push('en');
  return out;
}

/**
 * The reasons to ask the user before the subtitles of SubRead load. Empty
 * when they can load at once.
 *
 * SubRead 0.9.1 gave 23 cues cut in the middle of words, the language "km"
 * and a match rate of 1 for an audio file with no speech, and the result
 * replaced the subtitles that the user loaded. So the reader asks when
 * subtitles from a file are loaded, when the language is not the one of
 * the book, and when the match rate is low. With the language "auto", the
 * OCR language tells the language of the book.
 */
export function subreadConcerns(c: SubreadCheck): string[] {
  const out: string[] = [];
  if (c.loaded?.source === 'file') {
    out.push(`They replace ${c.loaded.name}, the subtitles that you loaded.`);
  }
  const want = expectedLanguages(c.requested, c.ocrLang);
  // "en-US" and "ja_JP" count as "en" and "ja".
  const found = c.language?.trim().toLowerCase().split(/[-_]/)[0];
  if (found && want.length > 0 && !want.includes(found)) {
    out.push(`SubRead found the language "${c.language}", not "${want.join('" or "')}".`);
  }
  if (c.matchRate !== undefined && c.matchRate >= 0 && c.matchRate < LOW_MATCH_RATE) {
    out.push(`SubRead found only ${Math.round(c.matchRate * 100)}% of the lines in the book.`);
  }
  return out;
}
