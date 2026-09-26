import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LEAD, scrollTarget } from '../src/scroll';

describe('scrollTarget', () => {
  const view = { top: 500, height: 800 };

  it('gives null for a mark in view', () => {
    expect(scrollTarget({ top: 600, bottom: 640 }, view, 2000)).toBeNull();
  });

  it('brings a mark above or below the view to the upper third', () => {
    // The follower turned to page 2: the view stayed at 500, the mark was at -220.
    expect(scrollTarget({ top: 280, bottom: 320 }, view, 2000)).toBe(280 - 800 * LEAD);
    expect(scrollTarget({ top: 1400, bottom: 1440 }, view, 2000)).toBe(1400 - 800 * LEAD);
  });

  it('scrolls for a mark that is only partly in view', () => {
    expect(scrollTarget({ top: 1280, bottom: 1330 }, view, 2000)).toBe(1280 - 800 * LEAD);
  });

  it('stays inside the content', () => {
    expect(scrollTarget({ top: 50, bottom: 90 }, view, 2000)).toBe(0);
    expect(scrollTarget({ top: 2700, bottom: 2740 }, view, 2000)).toBe(2000);
  });

  it('gives a position for a mark in view when asked', () => {
    expect(scrollTarget({ top: 600, bottom: 640 }, view, 2000, true)).toBe(400);
  });

  const input = fc
    .record({ height: fc.integer({ min: 100, max: 2000 }), max: fc.nat({ max: 5000 }) })
    .chain(({ height, max }) =>
      fc.record({
        height: fc.constant(height),
        max: fc.constant(max),
        viewTop: fc.integer({ min: 0, max }),
        // A mark inside the content, which is max + height high.
        top: fc.integer({ min: 0, max: max + height }),
        size: fc.nat({ max: 200 }),
        always: fc.boolean(),
      }),
    );

  it('gives null only for a mark in view, and a position inside the content', () => {
    fc.assert(
      fc.property(input, ({ height, max, viewTop, top, size, always }) => {
        const mark = { top, bottom: top + size };
        const view = { top: viewTop, height };
        const target = scrollTarget(mark, view, max, always);
        const inView = mark.top >= viewTop && mark.bottom <= viewTop + height;
        expect(target === null).toBe(inView && !always);
        if (target !== null) {
          expect(target).toBeGreaterThanOrEqual(0);
          expect(target).toBeLessThanOrEqual(max);
        }
      }),
    );
  });

  it('shows the top of the mark after the scroll, in the upper third when it can', () => {
    fc.assert(
      fc.property(input, ({ height, max, viewTop, top, size, always }) => {
        const target = scrollTarget(
          { top, bottom: top + size },
          { top: viewTop, height },
          max,
          always,
        );
        if (target === null) return;
        expect(top).toBeGreaterThanOrEqual(target);
        expect(top).toBeLessThanOrEqual(target + height);
        if (target > 0 && target < max) {
          expect(Math.abs(top - target - height * LEAD)).toBeLessThanOrEqual(0.5);
          expect(top - target).toBeLessThanOrEqual(height / 3);
        }
      }),
    );
  });
});
