import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isPlayerError, parseState, seekArgument, type PlayerState } from '../src/player-state';

function state(line: string): PlayerState {
  const parsed = parseState(line);
  if (isPlayerError(parsed)) throw new Error(`error ${parsed.error} for ${line}`);
  return parsed;
}

describe('parseState', () => {
  it('reads a playing report', () => {
    expect(state('playing=1;position=96153;speed=1.5;package=de.ph1b.audiobook')).toEqual({
      playing: true,
      positionMs: 96153,
      speed: 1.5,
      package: 'de.ph1b.audiobook',
    });
  });

  it('reads a paused report', () => {
    const s = state('playing=0;position=0;speed=1.0;package=p');
    expect(s.playing).toBe(false);
    expect(s.positionMs).toBe(0);
  });

  it('gives no position for a player without one', () => {
    const s = state('playing=1;position=-1;speed=1.0;package=p');
    expect(s.playing).toBe(true);
    expect(s.positionMs).toBeNull();
  });

  it('returns the error name of a problem line', () => {
    expect(parseState('error=no_player')).toEqual({ error: 'no_player' });
    expect(parseState('error=no_notification_access')).toEqual({
      error: 'no_notification_access',
    });
    expect(parseState('error=no_overlay')).toEqual({ error: 'no_overlay' });
  });

  it('rejects an empty or broken line', () => {
    expect(parseState(null)).toEqual({ error: 'empty' });
    expect(parseState(undefined)).toEqual({ error: 'empty' });
    expect(parseState('')).toEqual({ error: 'empty' });
    expect(parseState('hello')).toEqual({ error: 'malformed' });
    expect(parseState('playing=1;position=abc')).toEqual({ error: 'malformed' });
    expect(parseState('playing=1;position=')).toEqual({ error: 'malformed' });
  });

  it('falls back to speed 1 for a missing or zero speed', () => {
    expect(state('playing=1;position=5').speed).toBe(1);
    expect(state('playing=1;position=5;speed=0').speed).toBe(1);
    expect(state('playing=1;position=5;speed=-2').speed).toBe(1);
    expect(state('playing=1;position=5').package).toBe('');
  });

  it('round trips a position through the seek argument', () => {
    for (const ms of [0, 1, 1000, 96153, 3600500, 12345678.9]) {
      const argument = seekArgument(ms);
      expect(argument).toMatch(/^\d+$/);
      expect(state(`playing=0;position=${argument}`).positionMs).toBeCloseTo(ms, -1);
    }
    expect(seekArgument(-3)).toBe('0');
  });

  it('round trips any state line', () => {
    const pkg = fc.stringMatching(/^[a-z][a-z0-9_.]{0,30}$/);
    const speed = fc.double({ min: 0.25, max: 4, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(fc.boolean(), fc.nat({ max: 10 ** 9 }), speed, pkg, (playing, ms, sp, p) => {
        const line = `playing=${playing ? 1 : 0};position=${ms};speed=${sp};package=${p}`;
        expect(state(line)).toEqual({ playing, positionMs: ms, speed: sp, package: p });
      }),
    );
  });
});
