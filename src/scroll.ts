// Where a scroll box scrolls to show a mark. Pure: no DOM.

/** The share of the view height above the mark after a scroll. The mark lands in the upper third. */
export const LEAD = 0.25;

/** A vertical extent, in the scroll space of the box: 0 is the top of its content. */
export interface Extent {
  top: number;
  bottom: number;
}

/**
 * The scroll position that shows `mark`, or null when the mark is in view
 * already. The view shows `height` pixels from the scroll position `top`.
 * `max` is the largest scroll position. The mark goes LEAD of the height
 * below the top of the view, so the lines after it show too. With
 * `always`, there is a position also for a mark in view.
 */
export function scrollTarget(
  mark: Extent,
  view: { top: number; height: number },
  max: number,
  always = false,
): number | null {
  const inView = mark.top >= view.top && mark.bottom <= view.top + view.height;
  if (inView && !always) return null;
  return Math.round(Math.min(Math.max(0, mark.top - view.height * LEAD), Math.max(0, max)));
}
