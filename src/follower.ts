// The reader follows the audio: which cue to mark, which page to show. Pure.
//
// The alignment gives each matched cue a page. This reducer turns a change
// of the cue into at most one highlight and one page turn.

export type FollowMode = 'highlight' | 'pages' | 'off';

export interface FollowInput {
  /** The page of each cue, from the alignment. Null for an unmatched cue. */
  cuePages: readonly (number | null)[];
  mode: FollowMode;
  currentPage: number;
  /** The cue of the last call, or -1. */
  previousCue: number;
  /** The cue of now, or -1 between cues. */
  cue: number;
  /** True when the audio jumped: a seek, not the normal run forward. */
  seeked: boolean;
}

export interface FollowOutput {
  /** The cue to mark on the page, or null for no mark. */
  highlightCue: number | null;
  /** The page to show, or null to stay. */
  turnToPage: number | null;
}

/** How many cues back an unmatched cue borrows the page of a matched one. */
export const LOOKBACK = 5;

const NOTHING: FollowOutput = { highlightCue: null, turnToPage: null };

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
 * True when a new alignment moves the cue: its own page changed (for
 * example, it became matched), or the page that stands for it changed.
 * Only then must the follow act again after an alignment. Else a page
 * that the user turned by hand stays.
 */
export function cueMoved(
  before: readonly (number | null)[],
  after: readonly (number | null)[],
  cue: number,
): boolean {
  if (cue < 0) return false;
  return (
    (before[cue] ?? null) !== (after[cue] ?? null) ||
    pageForCue(before, cue) !== pageForCue(after, cue)
  );
}

/**
 * One step of the follow.
 *
 * `off` does nothing. The same cue as before, without a seek, does nothing
 * either: the user can turn pages by hand while a long cue plays. A page
 * turn happens when the page of the cue is not the current page. In
 * `highlight` mode a matched cue is marked; in `pages` mode nothing is.
 */
export function follow(input: FollowInput): FollowOutput {
  const { cuePages, mode, currentPage, previousCue, cue, seeked } = input;
  if (mode === 'off' || cue < 0 || cue >= cuePages.length) return NOTHING;
  if (cue === previousCue && !seeked) return NOTHING;
  const own = cuePages[cue] ?? null;
  const page = pageForCue(cuePages, cue);
  return {
    highlightCue: mode === 'highlight' && own !== null ? cue : null,
    turnToPage: page !== null && page !== currentPage ? page : null,
  };
}
