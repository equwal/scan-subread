import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JUMP_MS,
  OverlayClock,
  POLL_ERROR_MS,
  POLL_MS,
  TICK_MS,
  type ClockState,
  type PlayerBridge,
} from '../src/clock-source';

/** A fake SubRead Overlay: answers the line set in `line`, counts the calls. */
function fakeBridge(line: string) {
  const calls: string[] = [];
  const bridge: PlayerBridge & { line: string; calls: string[] } = {
    line,
    calls,
    playerState: () => {
      calls.push('state');
      return Promise.resolve({ line: bridge.line });
    },
    play: () => {
      calls.push('play');
      return Promise.resolve({ line: bridge.line });
    },
    pause: () => {
      calls.push('pause');
      return Promise.resolve({ line: bridge.line });
    },
    seek: ({ ms }) => {
      calls.push(`seek ${ms}`);
      return Promise.resolve({ line: bridge.line });
    },
  };
  return bridge;
}

describe('OverlayClock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const now = () => Date.now();

  it('reads the player and computes the position between two reads', async () => {
    const bridge = fakeBridge('playing=1;position=1000;speed=2;package=p');
    const states: ClockState[] = [];
    const clock = new OverlayClock(bridge, now);
    clock.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.calls).toEqual(['state']);
    expect(states.at(-1)).toEqual({ positionMs: 1000, playing: true, seeked: false, error: null });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(states.at(-1)!.positionMs).toBe(1000 + 2 * TICK_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS - TICK_MS);
    expect(bridge.calls).toEqual(['state', 'state']);
    clock.stop();
  });

  it('marks a jump of the player as a seek', async () => {
    const bridge = fakeBridge('playing=1;position=1000;speed=1;package=p');
    const states: ClockState[] = [];
    const clock = new OverlayClock(bridge, now);
    clock.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    bridge.line = `playing=1;position=${1000 + POLL_MS + JUMP_MS + 1};speed=1;package=p`;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(states.at(-1)!.seeked).toBe(true);
    bridge.line = `playing=1;position=${1000 + 2 * POLL_MS + JUMP_MS + 1};speed=1;package=p`;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(states.at(-1)!.seeked).toBe(false);
    clock.stop();
  });

  it('reports an error, keeps the place, and reads less often', async () => {
    const bridge = fakeBridge('playing=1;position=5000;speed=1;package=p');
    const states: ClockState[] = [];
    const clock = new OverlayClock(bridge, now);
    clock.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    bridge.line = 'error=no_player';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(states.at(-1)).toEqual({
      positionMs: 5000 + POLL_MS,
      playing: false,
      seeked: false,
      error: 'no_player',
    });
    const reads = bridge.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(bridge.calls.length).toBe(reads);
    await vi.advanceTimersByTimeAsync(POLL_ERROR_MS - POLL_MS);
    expect(bridge.calls.length).toBe(reads + 1);
    clock.stop();
  });

  it('reports no overlay when the bridge fails', async () => {
    const bridge = fakeBridge('');
    bridge.playerState = () => Promise.reject(new Error('no plugin'));
    const states: ClockState[] = [];
    const clock = new OverlayClock(bridge, now);
    clock.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({
      positionMs: null,
      playing: false,
      seeked: false,
      error: 'no_overlay',
    });
    clock.stop();
  });

  it('sets the clock at once on play, pause and seek, and skips one read', async () => {
    const bridge = fakeBridge('playing=0;position=1000;speed=1;package=p');
    const states: ClockState[] = [];
    const clock = new OverlayClock(bridge, now);
    clock.start((s) => states.push(s));
    await vi.advanceTimersByTimeAsync(0);
    await clock.play();
    expect(bridge.calls).toEqual(['state', 'play']);
    expect(states.at(-1)!.playing).toBe(true);
    // The next read is skipped: the player takes a moment to start.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(bridge.calls).toEqual(['state', 'play']);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(bridge.calls).toEqual(['state', 'play', 'state']);

    await clock.seek(30000);
    expect(bridge.calls.at(-1)).toBe('seek 30000');
    expect(states.at(-1)).toMatchObject({ positionMs: 30000, seeked: true });

    await clock.pause();
    expect(states.at(-1)!.playing).toBe(false);
    clock.stop();
  });
});
