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

/**
 * How long to wait, on the clock of the device, until the media is at
 * `targetMs`. Null when the media does not move forward, or is already there.
 */
export function waitUntil(clock: PlayClock, targetMs: number, nowMs: number): number | null {
  if (!clock.playing || clock.speed <= 0) return null;
  const left = targetMs - positionAt(clock, nowMs);
  if (left <= 0) return null;
  return Math.ceil(left / clock.speed);
}
