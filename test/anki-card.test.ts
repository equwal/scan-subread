import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { OcrToken, TokenSpan } from '../src/align';
import { ankiCard, cardSource, wordAt } from '../src/anki-card';

const box = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** Tokens for one page, one per character: each line is a list of words. */
function pageTokens(lines: readonly (readonly string[])[], page = 0): OcrToken[] {
  const out: OcrToken[] = [];
  lines.forEach((words, li) => {
    words.forEach((word, wi) => {
      for (const ch of word) {
        out.push({
          text: ch,
          page,
          line: page * 1000 + li,
          word: page * 1000 + li * 100 + wi,
          bbox: box,
        });
      }
    });
  });
  return out;
}

/** The index of token number `n` (from 0) with the text `ch`. */
function find(tokens: readonly OcrToken[], ch: string, n = 0): number {
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.text !== ch) continue;
    if (seen === n) return i;
    seen++;
  }
  throw new Error(`No token ${ch} number ${n}.`);
}

// The first page of sample-eng-2p: two cues on two lines.
const eng = pageTokens([
  ['The', 'morning', 'sun', 'rose', 'over', 'the', 'quiet', 'hills,'],
  ['and', 'the', 'village', 'below', 'began', 'to', 'stir.'],
]);
const engCues = [
  { text: 'The morning sun rose over the quiet hills,' },
  { text: 'and the village below began to stir.' },
];
const firstLine = eng.filter((t) => t.line === 0).length;
const engSpans: TokenSpan[] = [
  { start: 0, end: firstLine, matched: true },
  { start: firstLine, end: eng.length, matched: true },
];

// sample-jpn: one OCR word for a whole line, as Japanese OCR gives.
const jpn = pageTokens([['吾輩は猫である。名前はまだ無い。']]);
const jpnCues = [{ text: '吾輩は猫である。' }, { text: '名前はまだ無い。' }];
const jpnSpans: TokenSpan[] = [
  { start: 0, end: 8, matched: true },
  { start: 8, end: 16, matched: true },
];

const source = 'sample-eng-2p, p. 1';

describe('ankiCard', () => {
  it('gives the word without its comma, and the marked cue as the sentence', () => {
    const card = ankiCard({
      tokens: eng,
      index: find(eng, ','),
      spans: engSpans,
      markedCue: 0,
      cues: engCues,
      source,
    });
    expect(card).toEqual({
      word: 'hills',
      sentence: 'The morning sun rose over the quiet hills,',
      source,
    });
  });

  it('gives the sentence around the token when the token is not in the marked cue', () => {
    const input = { tokens: eng, spans: engSpans, cues: engCues, source };
    // The first "v" is in "over".
    const village = find(eng, 'v', 1);
    const sentence =
      'The morning sun rose over the quiet hills, and the village below began to stir.';
    expect(ankiCard({ ...input, index: village, markedCue: 0 })).toEqual({
      word: 'village',
      sentence,
      source,
    });
    expect(ankiCard({ ...input, index: village, markedCue: -1 })).toEqual({
      word: 'village',
      sentence,
      source,
    });
    const unmatched = [engSpans[0]!, { start: 0, end: 0, matched: false }];
    expect(ankiCard({ ...input, spans: unmatched, index: village, markedCue: 1 })).toEqual({
      word: 'village',
      sentence,
      source,
    });
  });

  it('gives a CJK token the text only, so the user taps the word in SubRead Anki', () => {
    const input = { tokens: jpn, spans: jpnSpans, cues: jpnCues, source: 'sample-jpn, p. 1' };
    expect(ankiCard({ ...input, index: find(jpn, '猫'), markedCue: 0 })).toEqual({
      text: '吾輩は猫である。',
      source: 'sample-jpn, p. 1',
    });
    expect(ankiCard({ ...input, index: find(jpn, '前'), markedCue: -1 })).toEqual({
      text: '名前はまだ無い。',
      source: 'sample-jpn, p. 1',
    });
  });

  it('joins the lines of a cue: a space between Latin lines, none between CJK lines', () => {
    const cues = [{ text: 'was clear and bright,\nover the hills.' }];
    const spans: TokenSpan[] = [{ start: 0, end: eng.length, matched: true }];
    expect(ankiCard({ tokens: eng, index: 0, spans, markedCue: 0, cues, source })?.sentence).toBe(
      'was clear and bright, over the hills.',
    );
    const jpnCue = [{ text: '吾輩は猫\nである。' }];
    const all: TokenSpan[] = [{ start: 0, end: jpn.length, matched: true }];
    expect(
      ankiCard({ tokens: jpn, index: 0, spans: all, markedCue: 0, cues: jpnCue, source })?.text,
    ).toBe('吾輩は猫である。');
  });

  it('gives the text only for a token of punctuation with no word', () => {
    const dash = pageTokens([['Wait', '—', 'no.']]);
    const card = ankiCard({
      tokens: dash,
      index: find(dash, '—'),
      spans: [],
      markedCue: -1,
      cues: [],
      source,
    });
    expect(card).toEqual({ text: 'Wait — no.', source });
  });

  it('gives null for a token that does not exist', () => {
    const input = { tokens: eng, spans: engSpans, markedCue: 0, cues: engCues, source };
    expect(ankiCard({ ...input, index: eng.length })).toBeNull();
    expect(ankiCard({ ...input, index: -1 })).toBeNull();
  });
});

describe('wordAt', () => {
  it('keeps the punctuation inside a word', () => {
    const tokens = pageTokens([['"don\'t"', 'go.']]);
    expect(wordAt(tokens, find(tokens, 'd'))).toBe("don't");
    expect(wordAt(tokens, find(tokens, '"', 1))).toBe("don't");
  });

  it('gives a word with no punctuation at its edges, from the letters of its line', () => {
    const ch = fc.constantFrom('a', 'Z', '7', ',', '.', '"', '!', '(', ')', "'", '-');
    const word = fc.array(ch, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(''));
    const lines = fc.array(fc.array(word, { minLength: 1, maxLength: 4 }), {
      minLength: 1,
      maxLength: 3,
    });
    fc.assert(
      fc.property(lines, fc.nat(), (text, pick) => {
        const tokens = pageTokens(text);
        const index = pick % tokens.length;
        const got = wordAt(tokens, index);
        expect(got).not.toMatch(/^[\p{P}\p{S}]|[\p{P}\p{S}]$/u);
        const t = tokens[index]!;
        const own = tokens
          .filter((o) => o.line === t.line && o.word === t.word)
          .map((o) => o.text)
          .join('');
        expect(own).toContain(got);
      }),
    );
  });
});

describe('cardSource', () => {
  it('names the book without .pdf and the page from 1', () => {
    expect(cardSource('sample-eng-2p.pdf', 0)).toBe('sample-eng-2p, p. 1');
    expect(cardSource('吾輩は猫である.PDF', 9)).toBe('吾輩は猫である, p. 10');
  });
});
