// What the Android Back button does, and when the screen stays on. Pure: no DOM.

import type { FollowMode } from './follower';

/**
 * The step of the Back button: close the page jump, close the drawer, or
 * put the reader in the background.
 */
export type BackStep = 'close-jump' | 'close-drawer' | 'minimize';

/**
 * The step of the Back button. The reader never finishes its activity:
 * Android then destroys the WebView, and the reader loses its state.
 */
export function backStep(open: { jump: boolean; drawer: boolean }): BackStep {
  if (open.jump) return 'close-jump';
  if (open.drawer) return 'close-drawer';
  return 'minimize';
}

/**
 * True when the screen stays on: while the app shows, a book is open, the
 * player plays and the follow is not off. During read-along the user does
 * not touch the screen, so without this the screen turns off.
 */
export function keepScreenOn(s: {
  active: boolean;
  book: boolean;
  playing: boolean;
  mode: FollowMode;
}): boolean {
  return s.active && s.book && s.playing && s.mode !== 'off';
}
