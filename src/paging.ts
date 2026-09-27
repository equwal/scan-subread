// Page turns from keys, swipes and the arrows of the top bar. Pure: no DOM.
//
// In right-to-left mode (vertical Japanese) the next page is on the left:
// ArrowLeft, a swipe to the right and the left arrow go forward.

/** A page turn: 1 goes to the next page, -1 to the page before. */
export type Step = -1 | 1;

/** The shortest swipe that turns a page, in CSS pixels. */
export const SWIPE_MIN = 50;

/** A swipe turns a page only when its horizontal move is more than this times its vertical move. */
export const SWIPE_RATIO = 1.5;

/** A press this long, in milliseconds, without a move is a long press: an Anki card. */
export const LONG_PRESS_MS = 500;

/** A finger that moves more than this, in CSS pixels, makes no long press. */
export const LONG_PRESS_MOVE = 10;

/** True when the finger moved too far for a long press. Such a move can be a swipe. */
export function movedTooFar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LONG_PRESS_MOVE;
}

/** The step of a key, or 0 for a key that turns no page. */
export function keyStep(key: string, rtl: boolean): Step | 0 {
  switch (key) {
    case 'PageDown':
      return 1;
    case 'PageUp':
      return -1;
    case 'ArrowRight':
      return rtl ? -1 : 1;
    case 'ArrowLeft':
      return rtl ? 1 : -1;
    default:
      return 0;
  }
}

export interface Swipe {
  /** The move of the finger in CSS pixels. A positive dx goes right, a positive dy goes down. */
  dx: number;
  dy: number;
  /** True when the user zoomed in on the page. */
  zoomed: boolean;
  /** True when the viewer can scroll sideways. */
  wide: boolean;
}

/**
 * The step of a swipe, or 0 when the swipe turns no page. A finger that
 * moves to the left goes to the next page, as on paper. A page that is
 * zoomed in or wider than the viewer needs the swipe to pan, so it does
 * not turn.
 */
export function swipeStep(s: Swipe, rtl: boolean): Step | 0 {
  if (s.zoomed || s.wide) return 0;
  const x = Math.abs(s.dx);
  if (x < SWIPE_MIN || x <= SWIPE_RATIO * Math.abs(s.dy)) return 0;
  return s.dx < 0 !== rtl ? 1 : -1;
}

/** The step of the left or the right arrow of the top bar. */
export function arrowStep(side: 'left' | 'right', rtl: boolean): Step {
  return (side === 'right') !== rtl ? 1 : -1;
}

/**
 * Which arrows are off: an arrow is off when its step leads to no page.
 * `pages` is 0 when no PDF is open.
 */
export function arrowsOff(
  page: number,
  pages: number,
  rtl: boolean,
): { left: boolean; right: boolean } {
  const off = (step: Step): boolean => page + step < 0 || page + step >= pages;
  return { left: off(arrowStep('left', rtl)), right: off(arrowStep('right', rtl)) };
}

/**
 * The index of the page that the user typed: a number from 1 to `pages`.
 * NFKC reads full-width digits. Null for other text.
 */
export function parsePage(text: string, pages: number): number | null {
  const t = text.normalize('NFKC').trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= pages ? n - 1 : null;
}

/** The reading direction before the user sets one: right to left for vertical Japanese. */
export function defaultRtl(ocrLang: string): boolean {
  return ocrLang.includes('vert');
}
