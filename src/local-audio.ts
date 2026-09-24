// Word pronunciations from a Yomitan local-audio `android.db`.
//
// The native side (android/app/.../LocalAudioPlugin.java) reads the SQLite
// file. This module holds the typed bridge and the pure helpers that pick
// which clips to offer for a lookup result.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface LocalAudioStatus {
  available: boolean;
  /** Absolute path of the db in use, or null when none exists. */
  path: string | null;
  sizeBytes: number;
}

/** One row of the `entries` table. */
export interface LocalAudioEntry {
  source: string;
  speaker: string | null;
  display: string | null;
  file: string;
}

export interface ImportProgress {
  copied: number;
  total: number;
}

export interface LocalAudioPlugin {
  status(): Promise<LocalAudioStatus>;
  /** Opens the system file picker and copies the picked file into the app. */
  importDb(): Promise<LocalAudioStatus>;
  /** Deletes the imported copy. */
  remove(): Promise<LocalAudioStatus>;
  lookup(options: {
    expression: string;
    reading?: string;
  }): Promise<{ entries: LocalAudioEntry[] }>;
  /** One clip as base64. The MIME type follows from the file name; see `mimeFor`. */
  audio(options: { file: string; source: string }): Promise<{ data: string }>;
  addListener(
    eventName: 'importProgress',
    listener: (progress: ImportProgress) => void,
  ): Promise<PluginListenerHandle>;
}

/** Where the user can put the file by hand, relative to the shared storage root. */
export const MANUAL_PATH = 'Android/data/com.equwal.scansubread/files/android.db';

export const isAndroid = Capacitor.getPlatform() === 'android';

/** On the web only `status` exists, and it reports "not available". */
const webImpl: Pick<LocalAudioPlugin, 'status'> = {
  status: async () => ({ available: false, path: null, sizeBytes: 0 }),
};

export const LocalAudio = registerPlugin<LocalAudioPlugin>('LocalAudio', { web: () => webImpl });

/** MIME type of a clip from its file extension. */
export function mimeFor(file: string): string {
  const dot = file.lastIndexOf('.');
  const ext = dot < 0 ? '' : file.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

/** A word to look up: the expression with its reading, if any. */
export interface Word {
  expression: string;
  reading: string;
}

/** Unique words in order of first appearance. Several results may share one word. */
export function uniqueWords(words: readonly Word[]): Word[] {
  const seen = new Set<string>();
  const out: Word[] = [];
  for (const w of words) {
    const key = `${w.expression}\t${w.reading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ expression: w.expression, reading: w.reading });
  }
  return out;
}

/** One play button: what to show and what to fetch. */
export interface AudioChoice {
  label: string;
  source: string;
  file: string;
}

/** One choice per source, the first stored entry of each. The label is `display` or the source name. */
export function choices(entries: readonly LocalAudioEntry[]): AudioChoice[] {
  const seen = new Set<string>();
  const out: AudioChoice[] = [];
  for (const e of entries) {
    if (seen.has(e.source)) continue;
    seen.add(e.source);
    out.push({ label: e.display || e.source, source: e.source, file: e.file });
  }
  return out;
}

/** Data URL for one clip. */
export function dataUrl(file: string, base64: string): string {
  return `data:${mimeFor(file)};base64,${base64}`;
}
