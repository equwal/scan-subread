import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  alignCuesToTokens,
  createAligner,
  normalizeText,
  risingChain,
  shiftSpans,
  type TokenSpan,
} from '../src/align';
import { books, char, grams, pagesOfCue, readPages, word, type Book, type Token } from './book';

/** One token for each character of `text`, all on `page`. */
function tokensOf(text: string, page = 0): Token[] {
  return [...text].map((ch) => ({ text: ch, page }));
}

/** Books without noise that are long enough for anchors. */
const exactBooks = books({ cues: [15, 60], cueLength: [5, 40], pageLength: [16, 200], noise: 0 });

/** A book and a random choice of read pages. About one page in three is read. */
function withReadPages(arb: fc.Arbitrary<Book>): fc.Arbitrary<[Book, boolean[]]> {
  return arb.chain((book) =>
    fc.tuple(
      fc.constant(book),
      fc.array(fc.constantFrom(true, false, false), {
        minLength: book.pages.length,
        maxLength: book.pages.length,
      }),
    ),
  );
}

/**
 * For a book without noise: the index of each character in the tokens of
 * the read pages, joined in page order. -1 for a character on an unread page.
 */
function tokenIndex(book: Book, read: readonly boolean[]): number[] {
  let next = 0;
  return book.pageOf.map((page) => (read[page] ? next++ : -1));
}

/** The spans of the matched cues rise and stay inside [0, total]. */
function expectRising(spans: readonly TokenSpan[], total: number, disjoint: boolean): void {
  let last: TokenSpan | null = null;
  for (const span of spans) {
    if (!span.matched) {
      expect(span).toEqual({ start: 0, end: 0, matched: false });
      continue;
    }
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeGreaterThan(span.start);
    expect(span.end).toBeLessThanOrEqual(total);
    if (last) {
      expect(span.start).toBeGreaterThanOrEqual(disjoint ? last.end : last.start);
      expect(span.end).toBeGreaterThanOrEqual(last.end);
    }
    last = span;
  }
}

describe('normalizeText', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        const once = normalizeText(s);
        expect(normalizeText(once)).toBe(once);
      }),
    );
  });
});

describe('risingChain', () => {
  /** The length of a longest strictly rising chain, by the slow O(n²) method. */
  function slowLength(values: readonly number[]): number {
    const best = values.map(() => 1);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < i; j++) {
        if (values[j]! < values[i]!) best[i] = Math.max(best[i]!, best[j]! + 1);
      }
    }
    return Math.max(0, ...best);
  }

  it('gives a strictly rising chain as long as the slow reference', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 40 }), (values) => {
        const chain = risingChain(values);
        for (let k = 1; k < chain.length; k++) {
          expect(chain[k]!).toBeGreaterThan(chain[k - 1]!);
          expect(values[chain[k]!]!).toBeGreaterThan(values[chain[k - 1]!]!);
        }
        expect(chain.length).toBe(slowLength(values));
      }),
    );
  });
});

describe('createAligner properties', () => {
  it('maps exact text on all pages to exactly the tokens of each cue', () => {
    fc.assert(
      fc.property(exactBooks, (book) => {
        const spans = createAligner(book.cues).spans(book.pages);
        book.cues.forEach((_, i) => {
          expect(spans[i]).toEqual({
            start: book.offsets[i],
            end: book.offsets[i + 1],
            matched: true,
          });
        });
      }),
    );
  });

  it('matches cues only on read pages, and each cue there to exactly its tokens', () => {
    // The regression: with a few pages read, cues matched to wrong places.
    fc.assert(
      fc.property(withReadPages(exactBooks), ([book, read]) => {
        const spans = createAligner(book.cues).spans(readPages(book, read));
        const index = tokenIndex(book, read);
        book.cues.forEach((_, i) => {
          const tokens = index.slice(book.offsets[i], book.offsets[i + 1]).filter((t) => t >= 0);
          if (tokens.length === 0) {
            // The cue lies wholly on unread pages: no false positive.
            expect(spans[i]!.matched).toBe(false);
          } else {
            expect(spans[i]).toEqual({
              start: tokens[0],
              end: tokens[tokens.length - 1]! + 1,
              matched: true,
            });
          }
        });
      }),
    );
  });

  it('matches no cue when the cues share no 8-character run with the pages', () => {
    // Cues from one random text, pages from another. Both use one alphabet,
    // so chance runs of a few characters are common. The cue stream is
    // longer than a short stream, which is compared with the pages in full.
    fc.assert(
      fc.property(
        fc.array(word(15, 40), { minLength: 5, maxLength: 30 }),
        exactBooks,
        (cues, book) => {
          const cueGrams = grams(cues.join(''));
          fc.pre(
            book.pages.every((page) =>
              [...grams(page.map((t) => t.text).join(''))].every((g) => !cueGrams.has(g)),
            ),
          );
          const spans = createAligner(cues).spans(book.pages);
          expect(spans.filter((s) => s.matched)).toEqual([]);
        },
      ),
    );
  });

  it('gives the same spans with the page cache as a new aligner', () => {
    fc.assert(
      fc.property(withReadPages(exactBooks), ([book, read]) => {
        const aligner = createAligner(book.cues);
        aligner.spans(readPages(book, read));
        // Read the other pages one by one, as the reader does.
        const now = [...read];
        for (let p = 0; p < now.length; p++) {
          if (now[p]) continue;
          now[p] = true;
          const pages = readPages(book, now);
          expect(aligner.spans(pages)).toEqual(createAligner(book.cues).spans(pages));
        }
      }),
      { numRuns: 30 },
    );
  });

  it('gives rising, in-range spans when pages repeat, overlap or come out of order', () => {
    const slices = (length: number) =>
      fc.array(
        fc.option(fc.record({ start: fc.nat({ max: length }), length: fc.nat({ max: 300 }) }), {
          nil: undefined,
        }),
        { maxLength: 12 },
      );
    fc.assert(
      fc.property(
        exactBooks.chain((book) => fc.tuple(fc.constant(book), slices(book.pageOf.length))),
        ([book, parts]) => {
          const text = book.cues.join('');
          const pages = parts.map(
            (s, p) => s && tokensOf(text.slice(s.start, s.start + s.length), p),
          );
          const total = pages.reduce((n, p) => n + (p?.length ?? 0), 0);
          // One character per token: the spans do not overlap.
          expectRising(createAligner(book.cues).spans(pages), total, true);
        },
      ),
    );
  });

  it('gives rising, in-range spans for any text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: 'grapheme' }), { maxLength: 20 }),
        fc.array(fc.option(fc.array(fc.string({ unit: 'grapheme' })), { nil: undefined }), {
          maxLength: 5,
        }),
        (cues, texts) => {
          const pages = texts.map((page, p) => page?.map((text) => ({ text, page: p })));
          const total = pages.reduce((n, p) => n + (p?.length ?? 0), 0);
          const spans = createAligner(cues).spans(pages);
          expect(spans).toHaveLength(cues.length);
          // A token can hold characters of two cues, so two spans can share a token.
          expectRising(spans, total, false);
        },
      ),
    );
  });

  it('keeps 95% of the cues on read pages on their own pages under 5% noise', () => {
    const noisy = books({
      cues: [100, 150],
      cueLength: [10, 40],
      pageLength: [100, 400],
      noise: 0.05,
    });
    fc.assert(
      fc.property(withReadPages(noisy), ([book, read]) => {
        const pages = readPages(book, read);
        const tokens = pages.flatMap((p) => p ?? []);
        const spans = createAligner(book.cues).spans(pages);
        let onRead = 0;
        let right = 0;
        book.cues.forEach((_, i) => {
          const own = pagesOfCue(book, i);
          if (![...own].every((p) => read[p])) return;
          onRead++;
          const span = spans[i]!;
          if (span.matched && tokens.slice(span.start, span.end).every((t) => own.has(t.page))) {
            right++;
          }
        });
        expect(right).toBeGreaterThanOrEqual(0.95 * onRead);
      }),
      { numRuns: 30 },
    );
  });
});

describe('shiftSpans', () => {
  const unmatched: TokenSpan = { start: 0, end: 0, matched: false };

  /** A span of `n` tokens: matched and inside [0, n], or unmatched. */
  function span(n: number): fc.Arbitrary<TokenSpan> {
    if (n === 0) return fc.constant(unmatched);
    const matched = fc
      .nat({ max: n - 1 })
      .chain((start) =>
        fc.integer({ min: start + 1, max: n }).map((end) => ({ start, end, matched: true })),
      );
    return fc.oneof(fc.constant(unmatched), matched);
  }

  it('keeps the first and the last token of each span when tokens go in', () => {
    // The finding: page 19, read after page 20, put its tokens in front of
    // the tokens of page 20, and the spans pointed at other tokens until
    // the next alignment.
    const input = fc
      .nat({ max: 40 })
      .chain((n) =>
        fc.tuple(fc.constant(n), fc.array(span(n)), fc.nat({ max: n }), fc.nat({ max: 20 })),
      );
    fc.assert(
      fc.property(input, ([n, spans, at, count]) => {
        const before = Array.from({ length: n }, (_, i) => `old ${i}`);
        const after = [...before];
        after.splice(at, 0, ...Array.from({ length: count }, (_, i) => `new ${i}`));
        const shifted = shiftSpans(spans, at, count);
        expect(shifted).toHaveLength(spans.length);
        spans.forEach((s, i) => {
          const moved = shifted[i]!;
          if (!s.matched) {
            expect(moved).toEqual(unmatched);
            return;
          }
          expect(moved.matched).toBe(true);
          expect(after[moved.start]).toBe(before[s.start]);
          expect(after[moved.end - 1]).toBe(before[s.end - 1]);
        });
      }),
    );
  });

  it('moves the spans of page 20 behind the tokens of page 19', () => {
    // Page 20 has 5 tokens and two cues. Page 19 puts 4 tokens in front.
    const spans = [
      { start: 0, end: 3, matched: true },
      { start: 3, end: 5, matched: true },
      unmatched,
    ];
    expect(shiftSpans(spans, 0, 4)).toEqual([
      { start: 4, end: 7, matched: true },
      { start: 7, end: 9, matched: true },
      unmatched,
    ]);
  });

  it('keeps a span before the new tokens, and stretches a span across them', () => {
    const spans = [
      { start: 0, end: 2, matched: true },
      { start: 2, end: 6, matched: true },
    ];
    expect(shiftSpans(spans, 4, 3)).toEqual([
      { start: 0, end: 2, matched: true },
      { start: 2, end: 9, matched: true },
    ]);
  });
});

describe('alignCuesToTokens on one page', () => {
  it('maps exact text to exact spans, for short cues too', () => {
    fc.assert(
      fc.property(fc.array(word(1, 30), { minLength: 1, maxLength: 20 }), (cues) => {
        const spans = alignCuesToTokens(cues, tokensOf(cues.join('')));
        let offset = 0;
        cues.forEach((cue, i) => {
          expect(spans[i]).toEqual({ start: offset, end: offset + cue.length, matched: true });
          offset += cue.length;
        });
      }),
    );
  });

  it('keeps spans near the truth under modest random character noise', () => {
    // One cue with up to one edit per ten characters.
    const noisyCue = word(15, 40).chain((text) =>
      fc.tuple(
        fc.constant(text),
        fc.array(
          fc.record({
            pos: fc.nat({ max: text.length - 1 }),
            kind: fc.constantFrom('sub', 'del', 'ins'),
            ch: char,
          }),
          { maxLength: Math.floor(text.length / 10) },
        ),
      ),
    );

    fc.assert(
      fc.property(fc.array(noisyCue, { minLength: 1, maxLength: 15 }), (items) => {
        const cues = items.map(([text]) => text);
        const noisy = items.map(([text, edits]) => applyEdits(text, edits));
        const spans = alignCuesToTokens(cues, tokensOf(noisy.join('')));

        let offset = 0;
        noisy.forEach((truth, i) => {
          const trueStart = offset;
          const trueEnd = offset + truth.length;
          offset = trueEnd;
          const s = spans[i]!;
          const overlap = Math.max(0, Math.min(s.end, trueEnd) - Math.max(s.start, trueStart));
          expect(overlap).toBeGreaterThanOrEqual(0.6 * truth.length);
          expect(s.start).toBeGreaterThanOrEqual(trueStart - 4);
          expect(s.end).toBeLessThanOrEqual(trueEnd + 4);
        });
      }),
    );
  });
});

interface Edit {
  pos: number;
  kind: 'sub' | 'del' | 'ins';
  ch: string;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  const chars = [...text];
  // Apply from the end so earlier positions stay valid.
  for (const e of [...edits].sort((x, y) => y.pos - x.pos)) {
    if (e.kind === 'sub') chars[e.pos] = e.ch;
    else if (e.kind === 'del') chars.splice(e.pos, 1);
    else chars.splice(e.pos, 0, e.ch);
  }
  return chars.join('');
}
