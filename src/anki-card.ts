// The fields of a SubRead Anki card for a long press on the page. Pure: no DOM.

import type { OcrToken, TokenSpan } from './align';
import { isCjk, joinWords } from './book-text';
import { sentenceAround } from './sentence';
import type { AnkiCard } from './subread';

/** Punctuation and symbols at the start and at the end of a word. */
const EDGES = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * The word of token `index`: the text of the tokens with its page, line
 * and word id, without punctuation and symbols at its edges. "hills,"
 * gives "hills", and "don't" stays "don't".
 */
export function wordAt(tokens: readonly OcrToken[], index: number): string {
  const token = tokens[index];
  if (!token) return '';
  const same = (t: OcrToken | undefined): boolean =>
    t !== undefined && t.page === token.page && t.line === token.line && t.word === token.word;
  let start = index;
  let end = index + 1;
  while (same(tokens[start - 1])) start--;
  while (same(tokens[end])) end++;
  return tokens
    .slice(start, end)
    .map((t) => t.text)
    .join('')
    .replace(EDGES, '');
}

/** Where the sentence of a card is from: "<book name without .pdf>, p. <page number>". */
export function cardSource(bookName: string, page: number): string {
  return `${bookName.replace(/\.pdf$/i, '')}, p. ${page + 1}`;
}

export interface CardInput {
  tokens: readonly OcrToken[];
  /** The pressed token. */
  index: number;
  /** The span of each cue, from the alignment. */
  spans: readonly TokenSpan[];
  /** The cue with the mark on the page, or -1. */
  markedCue: number;
  /** The texts of the cues. */
  cues: readonly { text: string }[];
  /** Where the sentence is from: see cardSource. */
  source: string;
}

/**
 * The card for a long press on token `index`, or null when there is no
 * such token.
 *
 * - The sentence is the text of the marked cue when the token is in the
 *   span of that cue, else the sentence around the token (sentenceAround).
 * - A CJK token gives `{ text, source }`. OCR does not show where a
 *   Japanese word ends, so SubRead Anki shows the sentence, and the user
 *   taps the word.
 * - Another token gives `{ word, sentence, source }`. A token of
 *   punctuation only has no word: it gives `{ text, source }`.
 */
export function ankiCard(input: CardInput): AnkiCard | null {
  const { tokens, index, source } = input;
  const token = tokens[index];
  if (!token) return null;
  const span = input.spans[input.markedCue];
  const cue = input.cues[input.markedCue];
  const inCue = !!span && !!cue && span.matched && span.start <= index && index < span.end;
  const sentence = inCue
    ? joinWords(cue.text.split('\n').map((line) => line.trim()))
    : sentenceAround(tokens, index);
  if (isCjk(token.text)) return { text: sentence, source };
  const word = wordAt(tokens, index);
  return word ? { word, sentence, source } : { text: sentence, source };
}
