import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nextPage } from '../src/read-order';

/** The whole numbers from `from` up to, but not including, `to`. */
function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** All pages of a book of `count` pages, in the order of nextPage, while the current page stays. */
function readAll(count: number, current: number): number[] {
  const pending = new Set(range(0, count));
  const order: number[] = [];
  while (pending.size > 0) {
    const page = nextPage(pending, current);
    pending.delete(page);
    order.push(page);
  }
  return order;
}

describe('nextPage', () => {
  it('reads the current page, then the pages after it, then the pages before it', () => {
    expect(readAll(6, 2)).toEqual([2, 3, 4, 5, 1, 0]);
  });

  it('gives -1 when all pages are read', () => {
    expect(nextPage(new Set(), 3)).toBe(-1);
  });

  it('reads every page once: from the current page to the end, then back to the start', () => {
    const book = fc
      .integer({ min: 1, max: 60 })
      .chain((count) => fc.tuple(fc.constant(count), fc.nat({ max: count - 1 })));
    fc.assert(
      fc.property(book, ([count, current]) => {
        expect(readAll(count, current)).toEqual([
          ...range(current, count),
          ...range(0, current).reverse(),
        ]);
      }),
    );
  });

  it('follows the current page when the user turns pages during the read', () => {
    // At each step the user can be on another page.
    const read = fc
      .integer({ min: 1, max: 40 })
      .chain((count) =>
        fc.tuple(
          fc.constant(count),
          fc.array(fc.nat({ max: count - 1 }), { minLength: count, maxLength: count }),
        ),
      );
    fc.assert(
      fc.property(read, ([count, currents]) => {
        const pending = new Set(range(0, count));
        const order: number[] = [];
        for (const current of currents) {
          const page = nextPage(pending, current);
          // The nearest page at or after the current page, else the nearest before it.
          const after = [...pending].filter((p) => p >= current);
          expect(page).toBe(after.length > 0 ? Math.min(...after) : Math.max(...pending));
          pending.delete(page);
          order.push(page);
        }
        expect(order.sort((x, y) => x - y)).toEqual(range(0, count));
      }),
    );
  });
});
