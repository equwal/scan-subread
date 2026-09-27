import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  beginOpen,
  createOpens,
  endOpen,
  failureShows,
  lateMeta,
  opening,
  subtitlesOwner,
  userOpened,
  type Opens,
} from '../src/book-open';

describe('lateMeta', () => {
  const none = { page: false, forceOcr: false };

  it('does not undo "Force OCR" that the user set before the meta data came', () => {
    // The finding: the user opens B and ticks Force OCR before the meta data
    // of B comes. The meta data set Force OCR back, and the reading started
    // again without it, while the store said on.
    expect(lateMeta({}, { page: false, forceOcr: true })).toEqual({});
    expect(lateMeta({ forceOcr: false }, { page: false, forceOcr: true })).toEqual({});
  });

  it('does not go to the saved page after a page turn', () => {
    expect(lateMeta({ page: 57 }, { page: true, forceOcr: false })).toEqual({ forceOcr: false });
  });

  it('applies each field that did not change', () => {
    expect(lateMeta({ page: 57, forceOcr: true }, none)).toEqual({ page: 57, forceOcr: true });
    // Without a saved setting, Force OCR is off. Without a saved page, the page stays.
    expect(lateMeta({}, none)).toEqual({ forceOcr: false });
  });

  it('gives exactly the fields that did not change, with their saved values', () => {
    const meta = fc.record(
      { page: fc.nat({ max: 500 }), forceOcr: fc.boolean() },
      { requiredKeys: [] },
    );
    const changes = fc.record({ page: fc.boolean(), forceOcr: fc.boolean() });
    fc.assert(
      fc.property(meta, changes, (m, changed) => {
        const late = lateMeta(m, changed);
        expect('page' in late).toBe(!changed.page && m.page !== undefined);
        if ('page' in late) expect(late.page).toBe(m.page);
        expect('forceOcr' in late).toBe(!changed.forceOcr);
        if ('forceOcr' in late) expect(late.forceOcr).toBe(m.forceOcr ?? false);
      }),
    );
  });
});

describe('failureShows', () => {
  it('does not say the error of an older pick over the book that shows', () => {
    // The finding: the user picks a large file A that is no PDF, then B. B
    // shows first. Then A fails, and the strip said "This file is not a
    // PDF, or it is damaged." over the good book B.
    const o = createOpens();
    const a = beginOpen(o, true);
    const b = beginOpen(o, true);
    expect(endOpen(o, b, true)).toBe(true);
    expect(endOpen(o, a, false)).toBe(false);
    expect(failureShows(o, a)).toBe(false);
  });

  it('says the error of a pick when no later pick shows', () => {
    const o = createOpens();
    const a = beginOpen(o, true);
    endOpen(o, a, false);
    expect(failureShows(o, a)).toBe(true);
    // B still loads when A fails. When B shows, its message replaces the error.
    const c = beginOpen(o, true);
    beginOpen(o, true);
    endOpen(o, c, false);
    expect(failureShows(o, c)).toBe(true);
  });

  it('does not say the error of the restore after an open of the user', () => {
    const o = createOpens();
    const since = o.byUser;
    const l = beginOpen(o, false);
    beginOpen(o, true);
    endOpen(o, l, false);
    // The book of the user still loads, and it shows its own message.
    expect(failureShows(o, l, since)).toBe(false);
  });

  it('says the error of the restore when the user opened nothing', () => {
    const o = createOpens();
    const since = o.byUser;
    const l = beginOpen(o, false);
    endOpen(o, l, false);
    expect(failureShows(o, l, since)).toBe(true);
  });
});

/** One step of a script of opens: start the next attempt, or end one that loads. */
interface Step {
  begin: boolean;
  /** The attempt that starts or ends. */
  attempt: number;
  /** For a start: the user picked the file. */
  byUser: boolean;
  /** For an end: the file loaded as a PDF. */
  loaded: boolean;
}

/**
 * Scripts of up to 6 attempts. Each attempt starts in number order and ends
 * after its start, in any order, with or without a loaded PDF.
 */
const scripts: fc.Arbitrary<Step[]> = fc
  .record({
    count: fc.integer({ min: 1, max: 6 }),
    byUser: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    loaded: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    picks: fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
  })
  .map(({ count, byUser, loaded, picks }) => {
    const steps: Step[] = [];
    const loading: number[] = [];
    let begun = 0;
    const end = (attempt: number): Step => ({
      begin: false,
      attempt,
      byUser: false,
      loaded: loaded[attempt - 1]!,
    });
    for (const pick of picks) {
      if (begun < count && (loading.length === 0 || pick % 2 === 0)) {
        loading.push(++begun);
        steps.push({ begin: true, attempt: begun, byUser: byUser[begun - 1]!, loaded: false });
      } else if (loading.length > 0) {
        steps.push(end(loading.splice(pick % loading.length, 1)[0]!));
      }
    }
    // The attempts that still load end in their order.
    for (const attempt of loading) steps.push(end(attempt));
    return steps;
  });

/** Runs one step of a script. */
function run(o: Opens, step: Step): void {
  if (step.begin) beginOpen(o, step.byUser);
  else endOpen(o, step.attempt, step.loaded);
}

describe('open attempts', () => {
  it('shows the book of the last attempt that loaded, whatever the order of the loads', () => {
    fc.assert(
      fc.property(scripts, (steps) => {
        const o = createOpens();
        let lastLoaded = 0;
        for (const step of steps) {
          const before = o.shown;
          if (step.begin) {
            expect(beginOpen(o, step.byUser)).toBe(step.attempt);
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
  const p = beginOpen(o, true);
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
    const a = beginOpen(o, true);
    expect(subtitlesOwner(o, 'P')).toBeNull();
    expect(endOpen(o, a, true)).toBe(true);
    expect(subtitlesOwner(o, 'A')).toBe('A');
  });

  it('gives them to the book that stays open when the open fails', () => {
    const { o } = withP();
    const a = beginOpen(o, true);
    expect(subtitlesOwner(o, 'P')).toBeNull();
    expect(endOpen(o, a, false)).toBe(false);
    expect(subtitlesOwner(o, 'P')).toBe('P');
  });

  it('does not wait for an older open that cannot show', () => {
    // The user picks a large A, then a small B. B shows while A loads.
    const o = createOpens();
    const a = beginOpen(o, true);
    const b = beginOpen(o, true);
    expect(endOpen(o, b, true)).toBe(true);
    expect(subtitlesOwner(o, 'B')).toBe('B');
    expect(endOpen(o, a, true)).toBe(false);
  });

  it('gives no book while no book is open', () => {
    const o = createOpens();
    expect(subtitlesOwner(o, null)).toBeNull();
    beginOpen(o, true);
    expect(subtitlesOwner(o, null)).toBeNull();
  });

  it('gives no book exactly while an open loads that can replace the book', () => {
    fc.assert(
      fc.property(scripts, (steps) => {
        const o = createOpens();
        for (const step of steps) {
          run(o, step);
          expect(subtitlesOwner(o, 'book')).toBe(opening(o) ? null : 'book');
        }
      }),
    );
  });
});

describe('userOpened', () => {
  it('keeps the copy of a book that the user opened while the last book loaded', () => {
    // The finding: the restore opens a large last book L. The user picks a
    // small B, B shows first, and the copy of B replaces L. The open of L
    // then gives false, and the restore deleted the copy of B.
    const o = createOpens();
    const since = o.byUser;
    const l = beginOpen(o, false);
    const b = beginOpen(o, true);
    expect(endOpen(o, b, true)).toBe(true);
    expect(endOpen(o, l, true)).toBe(false);
    expect(userOpened(o, since)).toBe(true);
  });

  it('does not open the last book over a book that the user picked while the database opened', () => {
    // The finding: the database upgrade holds the restore, and the start
    // card shows. The user picks B. When the database opens, B still loads
    // and no book shows, so the restore opened the last book as a later
    // attempt, and it won over B.
    const o = createOpens();
    const since = o.byUser;
    beginOpen(o, true);
    expect(o.shown).toBe(0);
    expect(userOpened(o, since)).toBe(true);
  });

  it('lets the restore open and forget the last book when the user opened nothing', () => {
    const o = createOpens();
    const since = o.byUser;
    const l = beginOpen(o, false);
    expect(userOpened(o, since)).toBe(false);
    expect(endOpen(o, l, false)).toBe(false);
    expect(userOpened(o, since)).toBe(false);
  });

  it('is true exactly when the user started an open after the restore started', () => {
    const input = scripts.chain((steps) =>
      fc.tuple(fc.constant(steps), fc.nat({ max: steps.length })),
    );
    fc.assert(
      fc.property(input, ([steps, start]) => {
        const o = createOpens();
        steps.slice(0, start).forEach((step) => run(o, step));
        const since = o.byUser;
        steps.slice(start).forEach((step) => run(o, step));
        const later = steps.slice(start).some((step) => step.begin && step.byUser);
        expect(userOpened(o, since)).toBe(later);
      }),
    );
  });
});
