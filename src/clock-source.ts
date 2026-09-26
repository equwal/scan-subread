// Where the time of the audio comes from.
//
// On Android the player app plays the audio, and SubRead Overlay reports
// its position (OverlayClock). On the web the page plays the audio itself
// (LocalAudioClock). Both give the same states to the reader.

import { positionAt, type PlayClock } from './play-clock';
import { isPlayerError, parseState } from './player-state';
import type { StateLine } from './subread';

export interface ClockState {
  /** Position in milliseconds. Null when no player reports one. */
  positionMs: number | null;
  playing: boolean;
  /** True when the audio jumped: a seek, not the normal run forward. */
  seeked: boolean;
  /** `no_overlay`, `no_notification_access`, `no_player`, or null. */
  error: string | null;
}

export interface ClockSource {
  start(onState: (state: ClockState) => void): void;
  stop(): void;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
}

/**
 * The player did not do a command. The message is the reason, the same
 * word as in `ClockState.error`: `no_player`, `no_overlay`,
 * `no_notification_access`.
 */
export class PlayerError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PlayerError';
  }
}

/** The part of the SubRead plugin that the overlay clock uses. */
export interface PlayerBridge {
  playerState(): Promise<StateLine>;
  play(): Promise<StateLine>;
  pause(): Promise<StateLine>;
  seek(options: { ms: number }): Promise<StateLine>;
}

/** Milliseconds between two reads of the player. */
export const POLL_MS = 2000;
/** Milliseconds between two reads while the last answer was an error. */
export const POLL_ERROR_MS = 5000;
/** Milliseconds between two computed positions between the reads. */
export const TICK_MS = 250;
/** A reported position this far from the expected one is a seek. */
export const JUMP_MS = 3000;

/**
 * The audio player, read through SubRead Overlay. The player reports its
 * position and speed, so the clock is exact between two reads. A read
 * only has to notice a pause, a seek or a new speed. After play, pause or
 * seek sent from here, one read is skipped: the player takes a moment,
 * and the read that comes at once after would bring the old state back.
 */
export class OverlayClock implements ClockSource {
  private clock: PlayClock | null = null;
  private error: string | null = null;
  private onState: ((state: ClockState) => void) | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private skipPoll = false;

  constructor(
    private readonly bridge: PlayerBridge,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(onState: (state: ClockState) => void): void {
    this.stop();
    this.onState = onState;
    void this.poll();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.pollTimer = null;
    this.tickTimer = null;
    this.onState = null;
  }

  private schedulePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), this.error ? POLL_ERROR_MS : POLL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.onState) return;
    if (this.skipPoll) {
      this.skipPoll = false;
      this.schedulePoll();
      return;
    }
    let line: string;
    try {
      ({ line } = await this.bridge.playerState());
    } catch {
      line = 'error=no_overlay';
    }
    if (!this.onState) return;
    this.apply(line, this.now());
    this.schedulePoll();
  }

  /** Takes a state line of the player and reports the state it gives. */
  private apply(line: string, at: number): void {
    const parsed = parseState(line);
    if (isPlayerError(parsed)) {
      // The player is gone, or cannot be read. Keep the place, stop the clock.
      this.error = parsed.error;
      if (this.clock)
        this.clock = {
          ...this.clock,
          positionMs: positionAt(this.clock, at),
          reportedAtMs: at,
          playing: false,
        };
      this.emit(false);
      return;
    }
    this.error = null;
    if (parsed.positionMs === null) {
      this.clock = null;
      this.emit(false);
      return;
    }
    const expected = this.clock ? positionAt(this.clock, at) : null;
    const seeked = expected !== null && Math.abs(parsed.positionMs - expected) > JUMP_MS;
    this.clock = {
      positionMs: parsed.positionMs,
      reportedAtMs: at,
      speed: parsed.speed,
      playing: parsed.playing,
    };
    this.emit(seeked);
  }

  /** Between two reads: the computed position, while the player plays. */
  private tick(): void {
    if (this.clock?.playing) this.emit(false);
  }

  private emit(seeked: boolean): void {
    if (!this.onState) return;
    const clock = this.clock;
    this.onState({
      positionMs: clock ? positionAt(clock, this.now()) : null,
      playing: clock?.playing ?? false,
      seeked,
      error: this.error,
    });
  }

  /** Sets the local clock as the command will leave the player, and skips one read. */
  private local(playing: boolean, positionMs?: number): void {
    const at = this.now();
    const clock = this.clock;
    const position = positionMs ?? (clock ? positionAt(clock, at) : null);
    if (position === null) return;
    this.clock = { positionMs: position, reportedAtMs: at, speed: clock?.speed ?? 1, playing };
    this.skipPoll = true;
    this.emit(positionMs !== undefined);
  }

  /**
   * Waits for the answer to a command. An error line sets the error state,
   * and the promise rejects with a PlayerError for the reason.
   */
  private async send(command: Promise<StateLine>): Promise<void> {
    let line: string;
    try {
      ({ line } = await command);
    } catch {
      line = 'error=no_overlay';
    }
    const parsed = parseState(line);
    if (isPlayerError(parsed)) {
      this.apply(line, this.now());
      throw new PlayerError(parsed.error);
    }
  }

  async play(): Promise<void> {
    await this.send(this.bridge.play());
    this.local(true);
  }

  async pause(): Promise<void> {
    await this.send(this.bridge.pause());
    this.local(false);
  }

  async seek(ms: number): Promise<void> {
    await this.send(this.bridge.seek({ ms: Math.max(0, Math.round(ms)) }));
    this.local(this.clock?.playing ?? false, ms);
  }
}

/** The audio element of the page, for the web. */
export class LocalAudioClock implements ClockSource {
  /** The events that give a new state. `loadedmetadata`: a file was chosen. */
  private static readonly EVENTS = ['timeupdate', 'play', 'pause', 'loadedmetadata'];
  private onState: ((state: ClockState) => void) | null = null;
  private readonly onTime = (): void => this.emit(false);
  private readonly onSeeked = (): void => this.emit(true);

  constructor(private readonly audio: HTMLAudioElement) {}

  start(onState: (state: ClockState) => void): void {
    this.stop();
    this.onState = onState;
    for (const ev of LocalAudioClock.EVENTS) this.audio.addEventListener(ev, this.onTime);
    this.audio.addEventListener('seeked', this.onSeeked);
    this.emit(false);
  }

  stop(): void {
    for (const ev of LocalAudioClock.EVENTS) this.audio.removeEventListener(ev, this.onTime);
    this.audio.removeEventListener('seeked', this.onSeeked);
    this.onState = null;
  }

  private emit(seeked: boolean): void {
    this.onState?.({
      positionMs: this.audio.src ? this.audio.currentTime * 1000 : null,
      playing: !this.audio.paused,
      seeked,
      error: this.audio.src ? null : 'no_player',
    });
  }

  async play(): Promise<void> {
    if (!this.audio.src) throw new PlayerError('no_player');
    await this.audio.play();
  }

  pause(): Promise<void> {
    this.audio.pause();
    return Promise.resolve();
  }

  seek(ms: number): Promise<void> {
    if (!this.audio.src) return Promise.reject(new PlayerError('no_player'));
    this.audio.currentTime = Math.max(0, ms) / 1000;
    return Promise.resolve();
  }
}
