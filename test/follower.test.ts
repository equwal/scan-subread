import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { follow, LOOKBACK, pageForCue, type FollowInput, type FollowMode } from '../src/follower';

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
