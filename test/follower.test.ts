import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cueMoved,
  follow,
  LOOKBACK,
  pageForCue,
  type FollowInput,
  type FollowMode,
} from '../src/follower';

const pages: (number | null)[] = [0, 0, null, 1, 1, null, null, 2];

function input(over: Partial<FollowInput>): FollowInput {
  return {
    cuePages: pages,
    mode: 'highlight',
    currentPage: 0,
    previousCue: -1,
    cue: 0,
    seeked: false,
    ...over,
  };
}

describe('pageForCue', () => {
  it('gives the page of a matched cue', () => {
    expect(pageForCue(pages, 3)).toBe(1);
  });

  it('borrows the page of the nearest matched cue before an unmatched one', () => {
    expect(pageForCue(pages, 2)).toBe(0);
    expect(pageForCue(pages, 6)).toBe(1);
  });

  it('gives null when no matched cue is near enough', () => {
    const far = [0, ...new Array<null>(LOOKBACK + 1).fill(null)];
    expect(pageForCue(far, far.length - 1)).toBeNull();
    expect(pageForCue(far, LOOKBACK)).toBe(0);
  });
});

describe('cueMoved', () => {
  it('is false when the new alignment keeps the page of the cue', () => {
    expect(cueMoved([0, 1, 1], [0, 1, 1], 2)).toBe(false);
  });

  it('is false when only other cues change, as when a page is read in the background', () => {
    expect(cueMoved([0, 1, null, null], [0, 1, 2, 2], 1)).toBe(false);
  });

  it('is true when the cue becomes matched', () => {
    expect(cueMoved([], [0, 1, 1], 1)).toBe(true);
    expect(cueMoved([0, null, 1], [0, 1, 1], 1)).toBe(true);
  });

  it('is true when the cue moves to another page', () => {
    expect(cueMoved([0, 1], [0, 2], 1)).toBe(true);
  });

  it('is true when an unmatched cue borrows another page', () => {
    expect(cueMoved([0, null], [1, null], 1)).toBe(true);
  });

  it('is false between cues', () => {
    expect(cueMoved([0], [1], -1)).toBe(false);
  });

  it('is true whenever the new alignment changes what the follow does', () => {
    // Half of the cues are unmatched. The pages are few, so a change often
    // gives the same page again.
    const page = fc.option(fc.nat({ max: 3 }), { nil: null, freq: 2 });
    const step = fc.array(page, { minLength: 1, maxLength: 30 }).chain((before) =>
      fc.record({
        before: fc.constant(before),
        cue: fc.integer({ min: -1, max: before.length - 1 }),
        // Changes at the cue and in the cues that it can borrow a page from.
        changes: fc.array(fc.tuple(fc.nat({ max: LOOKBACK + 1 }), page), { maxLength: 3 }),
        mode: fc.constantFrom<FollowMode>('highlight', 'pages', 'off'),
        currentPage: fc.nat({ max: 3 }),
        previousCue: fc.integer({ min: -1, max: 30 }),
        seeked: fc.boolean(),
      }),
    );
    fc.assert(
      fc.property(step, ({ before, changes, ...i }) => {
        const after = [...before];
        for (const [back, p] of changes) if (i.cue - back >= 0) after[i.cue - back] = p;
        const old = follow({ ...i, cuePages: before });
        const now = follow({ ...i, cuePages: after });
        if (!cueMoved(before, after, i.cue)) expect(now).toEqual(old);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('follow', () => {
  it('marks a matched cue and stays on its page', () => {
    expect(follow(input({ cue: 1 }))).toEqual({ highlightCue: 1, turnToPage: null });
  });

  it('turns to the page of a matched cue', () => {
    expect(follow(input({ cue: 3 }))).toEqual({ highlightCue: 3, turnToPage: 1 });
  });

  it('turns for an unmatched cue with a matched cue before it, without a mark', () => {
    expect(follow(input({ cue: 5, currentPage: 0 }))).toEqual({
      highlightCue: null,
      turnToPage: 1,
    });
    expect(follow(input({ cue: 5, currentPage: 1 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
    });
  });

  it('does nothing for an unmatched cue with no matched cue near it', () => {
    const far = [0, ...new Array<null>(LOOKBACK + 1).fill(null)];
    expect(follow(input({ cuePages: far, cue: far.length - 1, currentPage: 5 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
    });
  });

  it('only turns pages in pages mode', () => {
    expect(follow(input({ mode: 'pages', cue: 3 }))).toEqual({
      highlightCue: null,
      turnToPage: 1,
    });
  });

  it('does nothing when off', () => {
    expect(follow(input({ mode: 'off', cue: 3 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
    });
  });

  it('does nothing for the same cue without a seek, and acts on a seek', () => {
    expect(follow(input({ cue: 3, previousCue: 3 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
    });
    expect(follow(input({ cue: 3, previousCue: 3, seeked: true }))).toEqual({
      highlightCue: 3,
      turnToPage: 1,
    });
  });

  it('does nothing between cues', () => {
    expect(follow(input({ cue: -1 }))).toEqual({ highlightCue: null, turnToPage: null });
  });

  const cuePages = fc.array(fc.option(fc.nat({ max: 9 }), { nil: null }), { maxLength: 30 });
  const mode = fc.constantFrom<FollowMode>('highlight', 'pages', 'off');
  const any = fc.record({
    cuePages,
    mode,
    currentPage: fc.nat({ max: 9 }),
    previousCue: fc.integer({ min: -1, max: 30 }),
    cue: fc.integer({ min: -1, max: 30 }),
    seeked: fc.boolean(),
  });

  it('never turns to a page that no cue maps to', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow(i);
        if (out.turnToPage !== null) {
          expect(i.cuePages).toContain(out.turnToPage);
          expect(out.turnToPage).not.toBe(i.currentPage);
        }
      }),
    );
  });

  it('marks only the cue of now, and only when it is matched', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow(i);
        if (out.highlightCue !== null) {
          expect(out.highlightCue).toBe(i.cue);
          expect(i.mode).toBe('highlight');
          expect(i.cuePages[i.cue]).not.toBeNull();
        }
      }),
    );
  });

  it('never acts when off, and never marks in pages mode', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow({ ...i, mode: 'off' });
        expect(out).toEqual({ highlightCue: null, turnToPage: null });
        expect(follow({ ...i, mode: 'pages' }).highlightCue).toBeNull();
      }),
    );
  });
});
