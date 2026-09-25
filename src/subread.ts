// The bridge to the SubRead suite: the typed side of SubReadPlugin.java.
//
// On the web there is no suite. The fallback reports no overlay, copies a
// lookup to the clipboard, and cannot make subtitles.

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface StateLine {
  /** One state line of SubRead Overlay, or `error=<reason>`. */
  line: string;
}

export interface DictionaryApp {
  label: string;
  /** A flattened ComponentName. */
  component: string;
}

export interface SubtitlesResult {
  srt?: string;
  /** The number of cues. */
  cues?: number;
  /** 0 to 1: the share of lines whose words were found in the book. */
  matchRate?: number;
  language?: string | null;
  /** `not_installed`, `cancelled`, or the reason SubRead gave. */
  error?: string;
}

export interface SubReadPlugin {
  playerState(): Promise<StateLine>;
  play(): Promise<StateLine>;
  pause(): Promise<StateLine>;
  seek(options: { ms: number }): Promise<StateLine>;
  /** Opens the dictionary with the text. Resolves when the dictionary closes. */
  lookup(options: { text: string }): Promise<{ closed: boolean }>;
  dictionaries(): Promise<{ apps: DictionaryApp[]; chosen: string }>;
  /** An empty component means: ask each time. */
  setDictionary(options: { component: string }): Promise<void>;
  makeSubtitles(options: {
    audio: string;
    bookText: string;
    language: string;
  }): Promise<SubtitlesResult>;
  pickAudio(): Promise<{ uri: string; name: string }>;
  shareText(options: { name: string; text: string }): Promise<void>;
}

class SubReadWeb implements SubReadPlugin {
  private noOverlay(): Promise<StateLine> {
    return Promise.resolve({ line: 'error=no_overlay' });
  }
  playerState(): Promise<StateLine> {
    return this.noOverlay();
  }
  play(): Promise<StateLine> {
    return this.noOverlay();
  }
  pause(): Promise<StateLine> {
    return this.noOverlay();
  }
  seek(): Promise<StateLine> {
    return this.noOverlay();
  }
  async lookup({ text }: { text: string }): Promise<{ closed: boolean }> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard in this context. The status line still shows the text.
    }
    return { closed: true };
  }
  dictionaries(): Promise<{ apps: DictionaryApp[]; chosen: string }> {
    return Promise.resolve({ apps: [], chosen: '' });
  }
  setDictionary(): Promise<void> {
    return Promise.resolve();
  }
  makeSubtitles(): Promise<SubtitlesResult> {
    return Promise.resolve({ error: 'not_installed' });
  }
  pickAudio(): Promise<{ uri: string; name: string }> {
    return Promise.reject(new Error('Android only.'));
  }
  shareText(): Promise<void> {
    return Promise.reject(new Error('Android only.'));
  }
}

export const isAndroid = Capacitor.getPlatform() === 'android';

export const SubRead = registerPlugin<SubReadPlugin>('SubRead', {
  web: () => new SubReadWeb(),
});
