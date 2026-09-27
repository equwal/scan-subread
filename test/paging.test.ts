import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arrowsOff,
  arrowStep,
  defaultRtl,
  keyStep,
  LONG_PRESS_MOVE,
  movedTooFar,
  parsePage,
  SWIPE_MIN,
  SWIPE_RATIO,
  swipeStep,
  type Swipe,
} from '../src/paging';

const flat = { zoomed: false, wide: false };

describe('movedTooFar', () => {
  it('lets a finger shake up to 10 CSS pixels in a long press', () => {
    expect(LONG_PRESS_MOVE).toBe(10);
    expect(movedTooFar(0, 0)).toBe(false);
    expect(movedTooFar(6, -8)).toBe(false);
    expect(movedTooFar(7, 8)).toBe(true);
  });

  it('never gives a long press for a swipe that turns a page', () => {
    // A swipe, a tap and a long press never mix.
    const move = fc.integer({ min: -400, max: 400 });
    fc.assert(
      fc.property(move, move, fc.boolean(), (dx, dy, rtl) => {
        if (swipeStep({ dx, dy, ...flat }, rtl) !== 0) expect(movedTooFar(dx, dy)).toBe(true);
      }),
    );
  });
});

describe('keyStep', () => {
  it('turns with the arrow keys and the page keys', () => {
    expect(keyStep('ArrowRight', false)).toBe(1);
    expect(keyStep('ArrowLeft', false)).toBe(-1);
    expect(keyStep('PageDown', false)).toBe(1);
    expect(keyStep('PageUp', false)).toBe(-1);
    expect(keyStep('ArrowDown', false)).toBe(0);
    expect(keyStep(' ', false)).toBe(0);
  });

  it('goes forward with ArrowLeft in right-to-left mode', () => {
    expect(keyStep('ArrowLeft', true)).toBe(1);
    expect(keyStep('ArrowRight', true)).toBe(-1);
    expect(keyStep('PageDown', true)).toBe(1);
    expect(keyStep('PageUp', true)).toBe(-1);
  });
});

describe('swipeStep', () => {
  it('turns forward for a swipe to the left, back for a swipe to the right', () => {
    expect(swipeStep({ dx: -80, dy: 10, ...flat }, false)).toBe(1);
    expect(swipeStep({ dx: 80, dy: -10, ...flat }, false)).toBe(-1);
  });

  it('turns forward for a swipe to the right in right-to-left mode', () => {
    expect(swipeStep({ dx: 80, dy: 0, ...flat }, true)).toBe(1);
    expect(swipeStep({ dx: -80, dy: 0, ...flat }, true)).toBe(-1);
  });

  it('does not turn for a short swipe, a steep swipe, a zoomed page or a wide page', () => {
    expect(swipeStep({ dx: -49, dy: 0, ...flat }, false)).toBe(0);
    expect(swipeStep({ dx: -60, dy: 40, ...flat }, false)).toBe(0);
    expect(swipeStep({ dx: -80, dy: 0, zoomed: true, wide: false }, false)).toBe(0);
    expect(swipeStep({ dx: -80, dy: 0, zoomed: false, wide: true }, false)).toBe(0);
  });

  const swipe: fc.Arbitrary<Swipe> = fc.record({
    dx: fc.integer({ min: -400, max: 400 }),
    dy: fc.integer({ min: -400, max: 400 }),
    zoomed: fc.boolean(),
    wide: fc.boolean(),
  });

  it('turns exactly for a long, flat swipe on a page that is not zoomed or wide', () => {
    fc.assert(
      fc.property(swipe, fc.boolean(), (s, rtl) => {
        const turns =
          !s.zoomed &&
          !s.wide &&
          Math.abs(s.dx) >= SWIPE_MIN &&
          Math.abs(s.dx) > SWIPE_RATIO * Math.abs(s.dy);
        expect(swipeStep(s, rtl) !== 0).toBe(turns);
      }),
    );
  });

  it('turns the other way for the mirror swipe, and for the other direction', () => {
    fc.assert(
      fc.property(swipe, fc.boolean(), (s, rtl) => {
        const step = swipeStep(s, rtl);
        expect(swipeStep({ ...s, dx: -s.dx }, rtl)).toBe(-step || 0);
        expect(swipeStep(s, !rtl)).toBe(-step || 0);
      }),
    );
  });
});

describe('arrows', () => {
  it('gives the right arrow the next page, except in right-to-left mode', () => {
    expect(arrowStep('right', false)).toBe(1);
    expect(arrowStep('left', false)).toBe(-1);
    expect(arrowStep('right', true)).toBe(-1);
    expect(arrowStep('left', true)).toBe(1);
  });

  it('turns off the arrow that leads to no page', () => {
    expect(arrowsOff(0, 40, false)).toEqual({ left: true, right: false });
    expect(arrowsOff(39, 40, false)).toEqual({ left: false, right: true });
    expect(arrowsOff(0, 40, true)).toEqual({ left: false, right: true });
    expect(arrowsOff(0, 1, false)).toEqual({ left: true, right: true });
    // No PDF.
    expect(arrowsOff(-1, 0, false)).toEqual({ left: true, right: true });
  });

  it('turns an arrow off exactly when its step leaves the book', () => {
    const book = fc
      .integer({ min: 1, max: 500 })
      .chain((pages) => fc.tuple(fc.constant(pages), fc.nat({ max: pages - 1 }), fc.boolean()));
    fc.assert(
      fc.property(book, ([pages, page, rtl]) => {
        const off = arrowsOff(page, pages, rtl);
        for (const side of ['left', 'right'] as const) {
          const to = page + arrowStep(side, rtl);
          expect(off[side]).toBe(to < 0 || to >= pages);
        }
      }),
    );
  });
});

describe('parsePage', () => {
  it('reads a page number from 1 to the page count', () => {
    expect(parsePage('30', 40)).toBe(29);
    expect(parsePage(' 1 ', 40)).toBe(0);
    expect(parsePage('３０', 40)).toBe(29);
  });

  it('gives null for text that is no page of the book', () => {
    for (const text of ['', '0', '41', '-3', '2.5', '1e1', 'abc', '3 4']) {
      expect(parsePage(text, 40)).toBeNull();
    }
  });

  it('reads back each page number that it can show', () => {
    const book = fc
      .integer({ min: 1, max: 5000 })
      .chain((pages) => fc.tuple(fc.constant(pages), fc.nat({ max: pages - 1 })));
    fc.assert(
      fc.property(book, ([pages, index]) => {
        expect(parsePage(String(index + 1), pages)).toBe(index);
      }),
    );
  });
});

describe('defaultRtl', () => {
  it('is right to left for vertical Japanese only', () => {
    expect(defaultRtl('jpn_vert')).toBe(true);
    expect(defaultRtl('jpn')).toBe(false);
    expect(defaultRtl('jpn+eng')).toBe(false);
    expect(defaultRtl('eng')).toBe(false);
  });
});
