// The reader follows the audio: which cue to mark, which page to show. Pure.
//
// The alignment gives each matched cue a page. At each step the follow
// compares the page of the audio with the page shown, and turns the page
// when they differ. A page turn by the user holds the follow: the page
// stays until the audio reaches it, the audio jumps, or the user asks to
// follow again.

export type FollowMode = 'highlight' | 'pages' | 'off';

/**
 * Why the follow runs.
 *
 * - `tick`: a new state of the clock in the normal run.
 * - `realign`: the alignment changed, because a page was read.
 * - `seek`: the audio jumped. The player jumped, or the user moved the
 *   audio from this app.
 * - `follow`: the user asked to follow: the Follow button, or a new
 *   follow mode.
 */
export type FollowEvent = 'tick' | 'realign' | 'seek' | 'follow';

export interface FollowInput {
  mode: FollowMode;
  currentPage: number;
  /** The cue of now, or -1 before the first cue. */
  cue: number;
  /** True when the cue of now is matched: it has tokens on a page. */
  matched: boolean;
  /** The page of the audio now, or null when no page stands for the cue of now. */
  page: number | null;
  /** True while a page turn by the user holds the follow. */
  held: boolean;
  event: FollowEvent;
}

export interface FollowOutput {
  /** The cue to mark on the page, or null for no mark. */
  highlightCue: number | null;
  /** The page to show, or null to stay. */
  turnToPage: number | null;
  /** True when the follow stays held. */
  held: boolean;
}

/** How many cues back an unmatched cue borrows the page of a matched one. */
export const LOOKBACK = 5;

/**
 * The page that stands for `cue`: its own page when the cue is matched,
 * else the page of the nearest matched cue before it, within LOOKBACK.
 * Null when there is none.
 */
export function pageForCue(cuePages: readonly (number | null)[], cue: number): number | null {
  for (let i = cue; i >= 0 && i >= cue - LOOKBACK; i--) {
    const page = cuePages[i];
    if (page !== null && page !== undefined) return page;
  }
  return null;
}

/**
 * One step of the follow.
 *
 * A seek or the Follow button ends the hold. The hold also ends when the
 * audio is on the page shown. A tick or a new alignment does not end it.
 * While the follow is held, the page does not turn. Else the page turns
 * when the page of the audio is not the page shown. In `highlight` mode a
 * matched cue is marked, also while the follow is held: the mark shows
 * only on the page of the cue. `off` does nothing.
 */
export function follow(input: FollowInput): FollowOutput {
  const { mode, currentPage, cue, matched, page, event } = input;
  let held = input.held && (event === 'tick' || event === 'realign');
  if (mode === 'off' || cue < 0) return { highlightCue: null, turnToPage: null, held };
  if (page === currentPage) held = false;
  return {
    highlightCue: mode === 'highlight' && matched ? cue : null,
    turnToPage: !held && page !== null && page !== currentPage ? page : null,
    held,
  };
}
