// The bridge to the SubRead suite: the typed side of SubReadPlugin.java.
//
// On the web there is no suite. The fallback reports no overlay, copies a
// lookup to the clipboard, and cannot make subtitles. It keeps the screen on
// with the Screen Wake Lock API when the browser has it.

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
  /**
   * Keeps the screen on while `on` is true. During read-along the user does
   * not touch the screen, so without this the screen turns off. On the web,
   * a screen wake lock where the browser has one; errors are ignored.
   */
  keepAwake(options: { on: boolean }): Promise<void>;
  /**
   * Opens the dictionary with the text. Resolves when the dictionary closes.
   * A dictionary that opens in its own task answers at once, so for such an
   * answer the call waits until the user is back in the reader, or 1.5 s
   * when the dictionary did not open.
   */
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
  /** The screen wake lock, while one is held. */
  private wakeLock: WakeLockSentinel | null = null;

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
  async keepAwake({ on }: { on: boolean }): Promise<void> {
    try {
      if (!on) {
        const lock = this.wakeLock;
        this.wakeLock = null;
        await lock?.release();
      } else if ('wakeLock' in navigator && (this.wakeLock === null || this.wakeLock.released)) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // No wake lock here: a hidden page, a page without HTTPS, or a refusal.
    }
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
