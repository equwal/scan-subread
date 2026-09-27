// The open of a book: the open attempts, the owner of subtitles that load
// during an open, and the restore of the last book. Pure: no DOM.

/**
 * The open attempts of books. Each attempt gets the next number: 1, 2, 3 ...
 * A large PDF can load for many seconds, so the user can pick another book
 * while one loads. The book of the last attempt that loads shows.
 */
export interface Opens {
  /** The number of the last attempt. */
  tried: number;
  /** The attempt of the book that shows, or 0. */
  shown: number;
  /** The count of attempts that the user started: a file of the file picker. */
  byUser: number;
  /** The attempts that still load. */
  loading: Set<number>;
}

export function createOpens(): Opens {
  return { tried: 0, shown: 0, byUser: 0, loading: new Set() };
}

/** Starts an attempt, and gives its number. `byUser` is true for a file that the user picked. */
export function beginOpen(o: Opens, byUser: boolean): number {
  const attempt = ++o.tried;
  if (byUser) o.byUser++;
  o.loading.add(attempt);
  return attempt;
}

/**
 * Ends an attempt. `loaded` is true when its file loaded as a PDF. Gives
 * true when the book of the attempt shows now: it loaded, and no later
 * attempt shows a book.
 */
export function endOpen(o: Opens, attempt: number, loaded: boolean): boolean {
  o.loading.delete(attempt);
  if (!loaded || attempt < o.shown) return false;
  o.shown = attempt;
  return true;
}

/** True while an attempt loads that can replace the book that shows: an attempt after it. */
export function opening(o: Opens): boolean {
  for (const attempt of o.loading) if (attempt > o.shown) return true;
  return false;
}

/**
 * The book of subtitles that the user loads now, when `book` shows. While an
 * open loads that can replace `book`, the subtitles belong to no book yet:
 * they are for the book that shows when the opens end, the new book or, when
 * its open fails, `book`. Before, a subtitle file for the new book went into
 * the meta data of the book before it, over its own subtitles, and the new
 * book did not get it.
 */
export function subtitlesOwner(o: Opens, book: string | null): string | null {
  return opening(o) ? null : book;
}

/**
 * True when the user started an open after `since`, the value of o.byUser
 * when the restore of the last book started. The restore waits for the
 * database, and the first open after an upgrade can take many seconds. A
 * book that the user picks meanwhile wins: the restore does not open the
 * last book over it, also while it still loads, and does not forget the copy
 * of the last book, because the copy can be of the user's book now.
 */
export function userOpened(o: Opens, since: number): boolean {
  return o.byUser !== since;
}

/**
 * True when the strip may tell why the attempt `attempt` failed: no later
 * attempt shows a book. For the restore of the last book, `since` is
 * o.byUser when the restore started, and the error shows only when the user
 * started no open after that: the user's book tells its own state. Before,
 * "This file is not a PDF, or it is damaged." of an older pick showed over
 * the good book that the user picked after it.
 */
export function failureShows(o: Opens, attempt: number, since?: number): boolean {
  return attempt > o.shown && (since === undefined || !userOpened(o, since));
}
