import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeText, type OcrToken } from '../src/align';
import {
  audioPage,
  cueParts,
  cueProgress,
  LOOKBACK,
  pageStartTime,
  SEEK_INTO,
  type CueParts,
} from '../src/cue-pages';
import { lastCueAt } from '../src/subtitles';

/** Tokens of one text line, one per character; a space gets no token. */
function lineTokens(text: string, page: number): OcrToken[] {
  return [...text]
    .filter((ch) => ch !== ' ')
    .map((ch, i) => ({ text: ch, page, line: page, bbox: { x0: i, y0: 0, x1: i + 1, y1: 1 } }));
}

// Cue 8 of sample-eng-2p.srt, 17.5 s to 20 s: the last line of page 1 and
// the first line of page 2.
const PAGE_1_END = 'with nothing more than light and sound.';
const PAGE_2_START = 'It rolled across the fields and woke the geese,';
const crossing = [...lineTokens(PAGE_1_END, 0), ...lineTokens(PAGE_2_START, 1)];
/** The alignment drops the comma at the end, so the span ends before it. */
const crossingSpan = { start: 0, end: crossing.length - 1, matched: true };
const CUE_8 = { start: 17.5, end: 20 };

describe('cueParts', () => {
  it('splits a cue at the page break by its normalized characters', () => {
    const [parts] = cueParts(crossing, [crossingSpan]);
    expect(parts).toEqual([
      { page: 0, share: 32 / 70 },
      { page: 1, share: 38 / 70 },
    ]);
  });

  it('gives no parts for an unmatched cue', () => {
    expect(cueParts(crossing, [{ start: 0, end: 0, matched: false }])).toEqual([[]]);
  });

  it('gives shares that add up to 1, one part per page in page order', () => {
    const token = fc.record({
      text: fc.constantFrom('a', 'B', '猫', ',', '。', ' '),
      page: fc.nat({ max: 3 }),
    });
    const input = fc
      .array(token, { minLength: 1, maxLength: 60 })
      .map((ts) => ts.sort((x, y) => x.page - y.page))
      .chain((ts) =>
        fc.tuple(fc.constant(ts), fc.nat({ max: ts.length - 1 }), fc.nat({ max: ts.length - 1 })),
      );
    fc.assert(
      fc.property(input, ([ts, a, b]) => {
        const tokens: OcrToken[] = ts.map((t, i) => ({
          ...t,
          line: t.page,
          bbox: { x0: i, y0: 0, x1: i + 1, y1: 1 },
        }));
        const span = { start: Math.min(a, b), end: Math.max(a, b) + 1, matched: true };
        const [parts] = cueParts(tokens, [span]);
        // A slow reference: count the normalized characters of each page.
        const counts = new Map<number, number>();
        for (const t of tokens.slice(span.start, span.end)) {
          const n = normalizeText(t.text).length;
          if (n > 0) counts.set(t.page, (counts.get(t.page) ?? 0) + n);
        }
        const total = [...counts.values()].reduce((x, y) => x + y, 0);
        expect(parts!.map((p) => p.page)).toEqual([...counts.keys()]);
        parts!.forEach((p) => expect(p.share).toBeCloseTo(counts.get(p.page)! / total, 12));
        if (parts!.length > 0) {
          expect(parts!.reduce((x, p) => x + p.share, 0)).toBeCloseTo(1, 12);
        }
      }),
    );
  });
});

describe('cueProgress', () => {
  it('goes from 0 at the start of the cue to 1 at its end', () => {
    expect(cueProgress(CUE_8, 17)).toBe(0);
    expect(cueProgress(CUE_8, 17.5)).toBe(0);
    expect(cueProgress(CUE_8, 18.75)).toBe(0.5);
    expect(cueProgress(CUE_8, 20)).toBe(1);
    expect(cueProgress(CUE_8, 21)).toBe(1);
    expect(cueProgress({ start: 3, end: 3 }, 3)).toBe(1);
  });
});

describe('audioPage', () => {
  const [parts] = cueParts(crossing, [crossingSpan]);
  const split = CUE_8.start + (CUE_8.end - CUE_8.start) * (32 / 70);

  it('turns inside a crossing cue at the share of its text on the first page', () => {
    expect(split).toBeCloseTo(18.643, 3);
    expect(audioPage([parts!], 0, cueProgress(CUE_8, 18.5))).toBe(0);
    expect(audioPage([parts!], 0, cueProgress(CUE_8, split - 0.01))).toBe(0);
    expect(audioPage([parts!], 0, cueProgress(CUE_8, split + 0.01))).toBe(1);
    expect(audioPage([parts!], 0, 1)).toBe(1);
  });

  it('lets an unmatched cue borrow the last page of the cue before it', () => {
    // After the crossing cue the audio is on page 2, not back on page 1.
    expect(audioPage([parts!, []], 1, 0)).toBe(1);
  });

  it('gives null when no matched cue is near enough', () => {
    const far: CueParts[] = [
      [{ page: 0, share: 1 }],
      ...new Array<CueParts>(LOOKBACK + 1).fill([]),
    ];
    expect(audioPage(far, far.length - 1, 0)).toBeNull();
    expect(audioPage(far, LOOKBACK, 0)).toBe(0);
  });

  /** Parts of cues: each cue is unmatched, or on one to three pages that rise. */
  const cueList = fc.array(
    fc.oneof(
      fc.constant<CueParts>([]),
      fc
        .array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 3 })
        .chain((counts) =>
          fc.tuple(
            fc.constant(counts),
            fc.array(fc.integer({ min: 1, max: 2 }), {
              minLength: counts.length,
              maxLength: counts.length,
            }),
            fc.nat({ max: 5 }),
          ),
        )
        .map(([counts, gaps, first]) => {
          const total = counts.reduce((x, y) => x + y, 0);
          let page = first;
          return counts.map((c, k) => {
            if (k > 0) page += gaps[k]!;
            return { page, share: c / total };
          });
        }),
    ),
    { minLength: 1, maxLength: 12 },
  );

  it('moves forward through the pages of a cue as the audio goes on', () => {
    fc.assert(
      fc.property(
        cueList,
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (list, pick, p) => {
          const cue = pick % list.length;
          const own = list[cue]!;
          if (own.length === 0) return;
          const page = audioPage(list, cue, p);
          expect(own.map((x) => x.page)).toContain(page);
          expect(audioPage(list, cue, 0)).toBe(own[0]!.page);
          expect(audioPage(list, cue, 1)).toBe(own[own.length - 1]!.page);
          expect(audioPage(list, cue, Math.min(1, p + 0.1))!).toBeGreaterThanOrEqual(page!);
        },
      ),
    );
  });

  it('finds the page again at the time where the page starts', () => {
    // Cues one after the other, 0.5 s to 5 s long, with gaps.
    const input = cueList.chain((list) =>
      fc.tuple(
        fc.constant(list),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 50, max: 500 })), {
          minLength: list.length,
          maxLength: list.length,
        }),
      ),
    );
    fc.assert(
      fc.property(input, ([list, times]) => {
        let clock = 0;
        const cues = times.map(([gap, length]) => {
          const start = clock + gap / 10;
          clock = start + length / 100;
          return { start, end: clock };
        });
        const pages = new Set(list.flatMap((parts) => parts.map((p) => p.page)));
        for (const page of pages) {
          const t = pageStartTime(list, cues, page);
          expect(t).not.toBeNull();
          // The clock counts whole milliseconds.
          const ms = Math.round(t! * 1000) / 1000;
          const cue = lastCueAt(cues, ms);
          expect(audioPage(list, cue, cueProgress(cues[cue]!, ms))).toBe(page);
          // No cue before has text on the page.
          for (let i = 0; i < cue; i++) expect(list[i]!.some((p) => p.page === page)).toBe(false);
        }
      }),
    );
  });
});

describe('pageStartTime', () => {
  const [parts] = cueParts(crossing, [crossingSpan]);

  it('gives the time where the text of page 2 starts inside the crossing cue', () => {
    const t = pageStartTime([parts!], [CUE_8], 1);
    expect(t).toBeCloseTo(17.5 + 2.5 * (32 / 70) + SEEK_INTO, 6);
  });

  it('gives the start of the first cue on a page, and null for a page with no cue', () => {
    const list: CueParts[] = [[], [{ page: 0, share: 1 }], [{ page: 0, share: 1 }]];
    const cues = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ];
    expect(pageStartTime(list, cues, 0)).toBeCloseTo(2 + SEEK_INTO, 9);
    expect(pageStartTime(list, cues, 1)).toBeNull();
  });
});
