// The order in which the reader reads the pages of a book. Pure.

/**
 * The next page to read: the current page, then the pages after it up to
 * the end, then the pages before it, nearest first. The narration goes on
 * from the current page, so the pages after it are necessary first.
 * `pending` holds the pages that are not read yet. -1 when it is empty.
 */
export function nextPage(pending: ReadonlySet<number>, current: number): number {
  let after = Infinity;
  let before = -1;
  for (const page of pending) {
    if (page >= current) after = Math.min(after, page);
    else before = Math.max(before, page);
  }
  return after < Infinity ? after : before;
}
