// The subtitles of a book. Pure: no DOM.

/** The name of the .srt of a book: "Neko.pdf" gives "Neko.srt". */
export function srtName(bookName: string): string {
  return `${bookName.replace(/\.pdf$/i, '')}.srt`;
}
