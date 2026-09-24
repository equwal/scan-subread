// Types for the parts of align.js that the app uses.

/** One timed piece of text: a transcript segment or a subtitle cue. */
export interface Segment {
  text: string;
  start: number;
  end: number;
}

export interface Lang {
  code: string;
  translate(s: string): string;
  clean(s: string): string;
}

export interface BookAlignment {
  cues: Segment[];
  paragraphsUsed: number;
  paragraphsDropped: number;
  /** Share of cues whose text comes from the book, in [0, 1]. */
  matchRate: number;
}

export function language(code: string): Lang;
export function alignBook(
  transcript: readonly Segment[],
  paragraphs: readonly string[],
  lang: Lang,
): BookAlignment;
export function writeSrt(cues: readonly Segment[]): string;
export const UNMATCHED: string;
