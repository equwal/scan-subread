// The sentence around a tapped token, for a SubRead Anki card. Pure: no DOM.

import type { OcrToken } from './align';
import { joinWords } from './book-text';

/** Longest sentence, in characters. */
export const SENTENCE_LENGTH = 200;

/**
 * A sentence end: one or more of 。．！？.!? and the closing marks after
 * them, as in 。」 or ." so that the closing mark stays with its sentence.
 */
const END = /[。．！？.!?]+[」』）)"'”’]*/gu;

/** An end of only ".", "!" and "?", with no closing mark. */
const LATIN_END = /^[.!?]+$/;

/** After such an end, a Latin letter or a digit means no sentence end: 3.14, e.g. */
const LATIN_NEXT = /[A-Za-z0-9]/;

/** True when two tokens are in one word: the same page, line id and word id. */
function sameWord(a: OcrToken, b: OcrToken): boolean {
  return a.page === b.page && a.line === b.line && a.word === b.word;
}

/**
 * The text of the page that holds token `index`, and the offset of that
 * token in it. The words of a line and the lines of the page are joined
 * with `joinWords`, the same as in the book text. The tokens of one page
 * are next to each other in `tokens`.
 */
function pageText(tokens: readonly OcrToken[], index: number): { text: string; at: number } {
  const page = tokens[index]!.page;
  let i = index;
  while (i > 0 && tokens[i - 1]!.page === page) i--;
  let text = '';
  let at = 0;
  while (i < tokens.length && tokens[i]!.page === page) {
    const first = tokens[i]!;
    let word = '';
    let tapped = -1;
    do {
      if (i === index) tapped = word.length;
      word += tokens[i]!.text;
      i++;
    } while (i < tokens.length && sameWord(first, tokens[i]!));
    const trimmed = word.trim();
    const joined = joinWords([text, trimmed]);
    if (tapped >= 0) {
      const lead = word.length - word.trimStart().length;
      at = joined.length - trimmed.length + Math.max(0, tapped - lead);
    }
    text = joined;
  }
  return { text, at };
}

/** The start and the end of the sentence that holds offset `at` of `text`. */
function sentenceSpan(text: string, at: number): [number, number] {
  let start = 0;
  for (const m of text.matchAll(END)) {
    const end = m.index + m[0].length;
    if (LATIN_END.test(m[0]) && LATIN_NEXT.test(text.charAt(end))) continue;
    if (end > at) return [start, end];
    start = end;
  }
  return [start, text.length];
}

/**
 * The sentence that holds token `index`: from the end of the sentence
 * before it to the end of its own sentence, across the lines of its page.
 *
 * A sentence ends at 。．！？ and at .!?, with the closing marks that follow
 * them (」』） and closing quotes). A "." before a Latin letter or a digit is
 * not an end (3.14, e.g.). A 」 with no end mark before it is not an end, so
 * 「はい」と言った。 is one sentence. On a page with no sentence end, the
 * sentence runs to the edge of the page.
 *
 * The words are joined with `joinWords`, and the result is trimmed. When the
 * sentence is longer than `max` characters, the result is the `max`
 * characters around the tapped token.
 */
export function sentenceAround(
  tokens: readonly OcrToken[],
  index: number,
  max = SENTENCE_LENGTH,
): string {
  const tapped = tokens[index];
  if (!tapped) return '';
  const { text, at } = pageText(tokens, index);
  const [start, end] = sentenceSpan(text, at);
  const sentence = text.slice(start, end);
  const trimmed = sentence.trim();
  const chars = [...trimmed];
  if (chars.length <= max) return trimmed;
  // A window of `max` characters, with the tapped token in the middle.
  const lead = sentence.length - sentence.trimStart().length;
  const tap = [...trimmed.slice(0, Math.max(0, at - start - lead))].length;
  const size = [...tapped.text].length;
  const from = Math.max(0, Math.min(tap - Math.floor((max - size) / 2), chars.length - max));
  return chars
    .slice(from, from + max)
    .join('')
    .trim();
}
