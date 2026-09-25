import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { positionAt, waitUntil, type PlayClock } from '../src/play-clock';

const ms = fc.nat({ max: 10 ** 8 });
const speed = fc.double({ min: 0.25, max: 4, noNaN: true, noDefaultInfinity: true });
const clock = fc.record({ positionMs: ms, reportedAtMs: ms, speed, playing: fc.boolean() });

describe('positionAt', () => {
  it('moves with the clock of the device at the speed', () => {
    const c: PlayClock = { positionMs: 1000, reportedAtMs: 500, speed: 2, playing: true };
    expect(positionAt(c, 500)).toBe(1000);
    expect(positionAt(c, 600)).toBe(1200);
  });

  it('holds the position while paused', () => {
    fc.assert(
      fc.property(clock, ms, (c, now) => {
        const paused = { ...c, playing: false };
        expect(positionAt(paused, now)).toBe(c.positionMs);
      }),
    );
  });

  it('never goes back while playing', () => {
    fc.assert(
      fc.property(clock, ms, ms, (c, t1, t2) => {
        const playing = { ...c, playing: true };
        const [a, b] = t1 <= t2 ? [t1, t2] : [t2, t1];
        expect(positionAt(playing, b)).toBeGreaterThanOrEqual(positionAt(playing, a));
      }),
    );
  });

  it('scales the distance with the speed', () => {
    fc.assert(
      fc.property(clock, ms, fc.double({ min: 1, max: 4, noNaN: true }), (c, dt, k) => {
        const playing = { ...c, playing: true };
        const faster = { ...playing, speed: playing.speed * k };
        const now = c.reportedAtMs + dt;
        const d1 = positionAt(playing, now) - c.positionMs;
        const d2 = positionAt(faster, now) - c.positionMs;
        expect(d2).toBeCloseTo(d1 * k, 3);
      }),
    );
  });
});

describe('waitUntil', () => {
  it('gives the real time until the target', () => {
    const c: PlayClock = { positionMs: 1000, reportedAtMs: 0, speed: 2, playing: true };
    expect(waitUntil(c, 3000, 0)).toBe(1000);
    expect(waitUntil(c, 3000, 500)).toBe(500);
  });

  it('gives null when paused or already past the target', () => {
    const paused: PlayClock = { positionMs: 0, reportedAtMs: 0, speed: 1, playing: false };
    expect(waitUntil(paused, 100, 0)).toBeNull();
    const playing = { ...paused, playing: true };
    expect(waitUntil(playing, 0, 0)).toBeNull();
    expect(waitUntil(playing, -5, 0)).toBeNull();
  });

  it('lands on the target after the wait', () => {
    fc.assert(
      fc.property(clock, ms, ms, (c, now, target) => {
        const playing = { ...c, playing: true };
        const wait = waitUntil(playing, target, now);
        if (wait === null) {
          expect(positionAt(playing, now)).toBeGreaterThanOrEqual(target);
        } else {
          expect(wait).toBeGreaterThan(0);
          expect(positionAt(playing, now + wait)).toBeGreaterThanOrEqual(target);
        }
      }),
    );
  });
});
