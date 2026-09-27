// The state line of the audio player, as SubRead Overlay reports it. Pure.
//
// SubRead Overlay is an Android app with notification access. It reads the
// media session of the player and gives one line to other apps:
//
//     playing=1;position=96153;speed=1.0;package=de.ph1b.audiobook
//
// The position is in milliseconds, for the moment of the query. A problem is
// one line `error=<reason>`. This is a port of player_state.lua from the
// SubRead plugin for KOReader.

export interface PlayerState {
  playing: boolean;
  /** Position in milliseconds. Null when the player reports none. */
  positionMs: number | null;
  /** Playback speed. 1 when the line has none, or a value of zero or less. */
  speed: number;
  /** Package name of the player app. Empty when the line has none. */
  package: string;
}

export interface PlayerError {
  /** `no_overlay`, `no_notification_access`, `no_player`, `empty` or `malformed`. */
  error: string;
}

export function isPlayerError(x: PlayerState | PlayerError): x is PlayerError {
  return 'error' in x;
}

const FIELD = /([\w]+)=([^;]*)/g;

/** Parses a state line. */
export function parseState(line: string | null | undefined): PlayerState | PlayerError {
  if (typeof line !== 'string' || line === '') return { error: 'empty' };
  const fields = new Map<string, string>();
  for (const m of line.matchAll(FIELD)) fields.set(m[1]!, m[2]!);
  const error = fields.get('error');
  if (error !== undefined) return { error };
  const playing = fields.get('playing');
  const position = fields.get('position');
  if (playing === undefined || position === undefined) return { error: 'malformed' };
  const positionMs = Number(position);
  if (position.trim() === '' || Number.isNaN(positionMs)) return { error: 'malformed' };
  let speed = Number(fields.get('speed') ?? '1');
  if (Number.isNaN(speed) || speed <= 0) speed = 1;
  return {
    playing: playing === '1',
    positionMs: positionMs >= 0 ? positionMs : null,
    speed,
    package: fields.get('package') ?? '',
  };
}
