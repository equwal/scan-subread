// What a media player said about its position, and when it said it. Pure.
//
// A player does not report each millisecond. It reports a position, the
// time of the report, and the speed. The position now is computed from
// these three. This is a port of PlayClock.kt from SubRead Overlay.

export interface PlayClock {
  positionMs: number;
  /** The time of the report, on the same clock as the `nowMs` parameters. */
  reportedAtMs: number;
  speed: number;
  playing: boolean;
}

/** The position in the media at `nowMs`. */
export function positionAt(clock: PlayClock, nowMs: number): number {
  if (!clock.playing) return clock.positionMs;
  return clock.positionMs + (nowMs - clock.reportedAtMs) * clock.speed;
}
