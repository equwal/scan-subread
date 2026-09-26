import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { audioPage, type CueParts } from '../src/cue-pages';
import { follow, type FollowEvent, type FollowInput, type FollowMode } from '../src/follower';

/** The page of each cue. Null for an unmatched cue. */
const pages: (number | null)[] = [0, 0, null, 1, 1, null, null, 2];
const parts: CueParts[] = pages.map((p) => (p === null ? [] : [{ page: p, share: 1 }]));

function input(over: Partial<FollowInput>): FollowInput {
  return {
    mode: 'highlight',
    currentPage: 0,
    cue: 0,
    matched: true,
    page: 0,
    held: false,
    event: 'tick',
    ...over,
  };
}

/** The input of the follow at the start of cue `cue` of `pages`. */
function at(cue: number, over: Partial<FollowInput> = {}): FollowInput {
  return input({
    cue,
    matched: pages[cue] !== null && pages[cue] !== undefined,
    page: audioPage(parts, cue, 0),
    ...over,
  });
}

describe('follow', () => {
  it('marks a matched cue and stays on its page', () => {
    expect(follow(at(1))).toEqual({ highlightCue: 1, turnToPage: null, held: false });
  });

  it('turns to the page of a matched cue', () => {
    expect(follow(at(3))).toEqual({ highlightCue: 3, turnToPage: 1, held: false });
  });

  it('turns for an unmatched cue with a matched cue before it, without a mark', () => {
    expect(follow(at(5, { currentPage: 0 }))).toEqual({
      highlightCue: null,
      turnToPage: 1,
      held: false,
    });
    expect(follow(at(5, { currentPage: 1 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
      held: false,
    });
  });

  it('does nothing for a cue that has no page', () => {
    expect(follow(input({ cue: 9, matched: false, page: null, currentPage: 5 }))).toEqual({
      highlightCue: null,
      turnToPage: null,
      held: false,
    });
  });

  it('only turns pages in pages mode', () => {
    expect(follow(at(3, { mode: 'pages' }))).toEqual({
      highlightCue: null,
      turnToPage: 1,
      held: false,
    });
  });

  it('does nothing when off, and before the first cue', () => {
    expect(follow(at(3, { mode: 'off' }))).toEqual({
      highlightCue: null,
      turnToPage: null,
      held: false,
    });
    expect(follow(input({ cue: -1, page: null }))).toEqual({
      highlightCue: null,
      turnToPage: null,
      held: false,
    });
  });

  it('turns again inside the same cue when the page of the audio changes', () => {
    // A cue on two pages: the page follows the time, so one cue gives two pages.
    expect(follow(input({ cue: 7, page: 0, currentPage: 0 })).turnToPage).toBeNull();
    expect(follow(input({ cue: 7, page: 1, currentPage: 0 })).turnToPage).toBe(1);
  });

  it('keeps a page that the user turned to while the audio plays on', () => {
    // The audio plays cue 1 on page 0. At 4.43 s the user turns to page 1.
    // The next cue, on page 0, must not turn the page back.
    let held = true;
    let out = follow(at(1, { currentPage: 1, held }));
    expect(out).toEqual({ highlightCue: 1, turnToPage: null, held: true });
    held = out.held;
    out = follow(at(2, { currentPage: 1, held }));
    expect(out).toEqual({ highlightCue: null, turnToPage: null, held: true });
    // A page that is read and aligned again does not end the hold either.
    out = follow(at(2, { currentPage: 1, held, event: 'realign' }));
    expect(out.held).toBe(true);
    expect(out.turnToPage).toBeNull();
    // The audio reaches page 1: the hold ends, and the cue is marked.
    out = follow(at(3, { currentPage: 1, held }));
    expect(out).toEqual({ highlightCue: 3, turnToPage: null, held: false });
    // From here the follow turns the page again.
    expect(follow(at(7, { currentPage: 1, held: out.held })).turnToPage).toBe(2);
  });

  it('ends the hold on a seek and on the Follow button, and turns at once', () => {
    for (const event of ['seek', 'follow'] as const) {
      expect(follow(at(3, { currentPage: 0, held: true, event }))).toEqual({
        highlightCue: 3,
        turnToPage: 1,
        held: false,
      });
    }
  });

  const mode = fc.constantFrom<FollowMode>('highlight', 'pages', 'off');
  const event = fc.constantFrom<FollowEvent>('tick', 'realign', 'seek', 'follow');
  const any = fc.record({
    mode,
    currentPage: fc.nat({ max: 5 }),
    cue: fc.integer({ min: -1, max: 30 }),
    matched: fc.boolean(),
    page: fc.option(fc.nat({ max: 5 }), { nil: null }),
    held: fc.boolean(),
    event,
  });

  it('never turns a page while held, without a seek or the Follow button', () => {
    fc.assert(
      fc.property(any, fc.constantFrom<FollowEvent>('tick', 'realign'), (i, quiet) => {
        const out = follow({ ...i, held: true, event: quiet });
        if (out.held) expect(out.turnToPage).toBeNull();
        // A held follow that ends without a seek ends because the audio is on the page shown.
        if (!out.held) expect(i.page).toBe(i.currentPage);
        expect(out.turnToPage).toBeNull();
      }),
    );
  });

  it('ends the hold when the audio is on the page shown', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow({ ...i, page: i.currentPage });
        if (i.mode !== 'off' && i.cue >= 0) expect(out.held).toBe(false);
        expect(out.turnToPage).toBeNull();
      }),
    );
  });

  it('ends the hold on a seek and on the Follow button', () => {
    fc.assert(
      fc.property(any, fc.constantFrom<FollowEvent>('seek', 'follow'), (i, loud) => {
        expect(follow({ ...i, event: loud }).held).toBe(false);
      }),
    );
  });

  it('shows the page of the audio when the follow is not held', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow(i);
        if (out.turnToPage !== null) {
          expect(out.turnToPage).toBe(i.page);
          expect(out.turnToPage).not.toBe(i.currentPage);
        }
        if (!out.held && i.mode !== 'off' && i.cue >= 0 && i.page !== null) {
          expect(out.turnToPage ?? i.currentPage).toBe(i.page);
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
          expect(i.matched).toBe(true);
        }
      }),
    );
  });

  it('never acts when off, and never marks in pages mode', () => {
    fc.assert(
      fc.property(any, (i) => {
        const out = follow({ ...i, mode: 'off' });
        expect(out.highlightCue).toBeNull();
        expect(out.turnToPage).toBeNull();
        expect(follow({ ...i, mode: 'pages' }).highlightCue).toBeNull();
      }),
    );
  });
});
