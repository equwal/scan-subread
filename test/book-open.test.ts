import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  beginOpen,
  createOpens,
  endOpen,
  opening,
  subtitlesOwner,
  type Opens,
} from '../src/book-open';

/** One step of a script of opens: start the next attempt, or end one that loads. */
interface Step {
  begin: boolean;
  /** The attempt that ends, when `begin` is false. */
  attempt: number;
  loaded: boolean;
}

/**
 * Scripts of up to 6 attempts. Each attempt starts in number order and ends
 * after its start, in any order, with or without a loaded PDF.
 */
const scripts: fc.Arbitrary<Step[]> = fc
  .record({
    count: fc.integer({ min: 1, max: 6 }),
    loaded: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    picks: fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
  })
  .map(({ count, loaded, picks }) => {
    const steps: Step[] = [];
    const loading: number[] = [];
    let begun = 0;
    for (const pick of picks) {
      if (begun < count && (loading.length === 0 || pick % 2 === 0)) {
        loading.push(++begun);
        steps.push({ begin: true, attempt: begun, loaded: false });
      } else if (loading.length > 0) {
        const [attempt] = loading.splice(pick % loading.length, 1);
        steps.push({ begin: false, attempt: attempt!, loaded: loaded[attempt! - 1]! });
      }
    }
    // The attempts that still load end in their order.
    for (const attempt of loading) {
      steps.push({ begin: false, attempt, loaded: loaded[attempt - 1]! });
    }
    return steps;
  });

describe('open attempts', () => {
  it('shows the book of the last attempt that loaded, whatever the order of the loads', () => {
    fc.assert(
      fc.property(scripts, (steps) => {
        const o = createOpens();
        let lastLoaded = 0;
        for (const step of steps) {
          const before = o.shown;
          if (step.begin) {
            expect(beginOpen(o)).toBe(step.attempt);
          } else {
            const shows = endOpen(o, step.attempt, step.loaded);
            // An attempt shows when it loaded and no later attempt shows.
            expect(shows).toBe(step.loaded && step.attempt > before);
            if (step.loaded) lastLoaded = Math.max(lastLoaded, step.attempt);
          }
          // The book that shows never goes back to an older attempt.
          expect(o.shown).toBeGreaterThanOrEqual(before);
          // An open loads that can replace the book that shows.
          expect(opening(o)).toBe([...o.loading].some((a) => a > o.shown));
        }
        expect(o.shown).toBe(lastLoaded);
        expect(opening(o)).toBe(false);
      }),
    );
  });
});

/** Opens where book P shows, and the attempt of P. */
function withP(): { o: Opens; p: number } {
  const o = createOpens();
  const p = beginOpen(o);
  endOpen(o, p, true);
  return { o, p };
}

describe('subtitlesOwner', () => {
  it('gives subtitles that load during the open of another book to no book', () => {
    // The finding: book P is open, the user picks a large PDF A, and loads
    // the .srt of A before A shows. The .srt went into the meta data of P,
    // over the subtitles of P, and the open of A then cleared it.
    const { o } = withP();
    expect(subtitlesOwner(o, 'P')).toBe('P');
    const a = beginOpen(o);
    expect(subtitlesOwner(o, 'P')).toBeNull();
    expect(endOpen(o, a, true)).toBe(true);
    expect(subtitlesOwner(o, 'A')).toBe('A');
  });

  it('gives them to the book that stays open when the open fails', () => {
    const { o } = withP();
    const a = beginOpen(o);
    expect(subtitlesOwner(o, 'P')).toBeNull();
    expect(endOpen(o, a, false)).toBe(false);
    expect(subtitlesOwner(o, 'P')).toBe('P');
  });

  it('does not wait for an older open that cannot show', () => {
    // The user picks a large A, then a small B. B shows while A loads.
    const o = createOpens();
    const a = beginOpen(o);
    const b = beginOpen(o);
    expect(endOpen(o, b, true)).toBe(true);
    expect(subtitlesOwner(o, 'B')).toBe('B');
    expect(endOpen(o, a, true)).toBe(false);
  });

  it('gives no book while no book is open', () => {
    const o = createOpens();
    expect(subtitlesOwner(o, null)).toBeNull();
    beginOpen(o);
    expect(subtitlesOwner(o, null)).toBeNull();
  });

  it('gives no book exactly while an open loads that can replace the book', () => {
    fc.assert(
      fc.property(scripts, (steps) => {
        const o = createOpens();
        for (const step of steps) {
          if (step.begin) beginOpen(o);
          else endOpen(o, step.attempt, step.loaded);
          expect(subtitlesOwner(o, 'book')).toBe(opening(o) ? null : 'book');
        }
      }),
    );
  });
});
