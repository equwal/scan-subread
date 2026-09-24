// The "Audiobook" section of the drawer: make subtitles from the audiobook
// and the OCR text, on subread.space or in this app. The result is an SRT
// that goes down the same path as a hand-picked subtitle file.

import { bookFile, paragraphs, bookText, whisperCode } from './book-text';
import type { OcrToken } from './align';
import {
  accountLine,
  ApiError,
  cancelJob,
  fetchSrt,
  getAccount,
  pollUntilDone,
  requestSignIn,
  SITE,
  startJob,
  tokenFrom,
  upload,
  verifySignIn,
  type Http,
  type JobOut,
} from './cloud';
import type { Job, JobStatus } from './engine/job.js';
import { createHttp, DEFAULT_SERVER, defaultAssets } from './http';
import { audioKey, getSrt, putSrt } from './srt-cache';

const POLL_MS = 5000;

const KEYS = {
  server: 'subread.server',
  assets: 'subread.assets',
  job: 'subread.job',
};

/** The server job that may still run after the app was closed. */
interface PendingJob {
  id: string;
  audioKey: string;
  audioName: string;
}

export interface AudiobookHooks {
  tokens(): readonly OcrToken[];
  /** The tesseract language of the last OCR run. */
  ocrLang(): string;
  /** Load finished subtitles into the reader. */
  loadSrt(srt: string, source: string): void;
}

export interface Audiobook {
  /** Call after an OCR run: enables the buttons and sets the language. */
  onTokens(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is off. The setting lives for this session only.
  }
}

/** A URL that ends with one slash. */
function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function setupAudiobook(hooks: AudiobookHooks): Audiobook {
  const ui = {
    audioFile: el<HTMLInputElement>('audio-file'),
    audio: el<HTMLAudioElement>('audio'),
    lang: el<HTMLSelectElement>('ab-lang'),
    cloud: el<HTMLButtonElement>('ab-cloud'),
    local: el<HTMLButtonElement>('ab-local'),
    stop: el<HTMLButtonElement>('ab-stop'),
    status: el<HTMLDivElement>('ab-status'),
    progress: el<HTMLProgressElement>('ab-progress'),
    account: el<HTMLDivElement>('ab-account'),
    email: el<HTMLInputElement>('ab-email'),
    send: el<HTMLButtonElement>('ab-send'),
    token: el<HTMLInputElement>('ab-token'),
    verify: el<HTMLButtonElement>('ab-verify'),
    server: el<HTMLInputElement>('ab-server'),
    assets: el<HTMLInputElement>('ab-assets'),
  };

  const state = {
    audio: null as File | null,
    busy: false,
    /** Stops the poll loop of the server job. */
    abort: null as AbortController | null,
    /** The in-app job, while it runs. */
    job: null as Job | null,
    http: null as Http | null,
  };

  // --- Settings ---

  function server(): string {
    return (read(KEYS.server) ?? DEFAULT_SERVER).replace(/\/+$/, '');
  }

  function assets(): string {
    return withSlash(read(KEYS.assets) ?? defaultAssets());
  }

  function http(): Http {
    state.http ??= createHttp(server());
    return state.http;
  }

  ui.server.value = read(KEYS.server) ?? '';
  ui.server.placeholder = DEFAULT_SERVER || '(dev proxy)';
  ui.assets.value = read(KEYS.assets) ?? '';
  ui.assets.placeholder = defaultAssets();

  ui.server.addEventListener('change', () => {
    write(KEYS.server, ui.server.value.trim() || null);
    state.http = null;
    void refreshAccount();
  });
  ui.assets.addEventListener('change', () => {
    write(KEYS.assets, ui.assets.value.trim() || null);
  });

  // --- Status ---

  function setStatus(text: string, link?: { href: string; label: string }): void {
    ui.status.replaceChildren(text);
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = link.label;
      ui.status.append(' ', a);
    }
  }

  function setProgress(value: number | null): void {
    ui.progress.hidden = value === null;
    if (value !== null) ui.progress.value = value;
  }

  function updateButtons(): void {
    const ready = !state.busy && state.audio !== null && hooks.tokens().length > 0;
    ui.cloud.disabled = !ready;
    ui.local.disabled = !ready;
    ui.stop.hidden = !state.busy;
  }

  function setBusy(busy: boolean): void {
    state.busy = busy;
    updateButtons();
    if (!busy) setProgress(null);
  }

  // --- Account ---

  async function refreshAccount(): Promise<void> {
    try {
      const account = await getAccount(http());
      ui.account.textContent = `Account: ${accountLine(account)}`;
    } catch (err) {
      ui.account.textContent = `Account: cannot reach the server (${String(err)}).`;
    }
  }

  ui.send.addEventListener('click', async () => {
    ui.send.disabled = true;
    try {
      const r = await requestSignIn(http(), ui.email.value);
      ui.account.textContent = r.dev_link
        ? `Account: no mail server. Paste this link below: ${r.dev_link}`
        : `Account: link sent to ${r.email}. Open it, then paste the link or token below.`;
    } catch (err) {
      ui.account.textContent = `Account: ${String(err)}`;
    } finally {
      ui.send.disabled = false;
    }
  });

  ui.verify.addEventListener('click', async () => {
    ui.verify.disabled = true;
    try {
      const account = await verifySignIn(http(), tokenFrom(ui.token.value));
      ui.token.value = '';
      ui.account.textContent = `Account: ${accountLine(account)}`;
    } catch (err) {
      ui.account.textContent = `Account: ${String(err)}`;
    } finally {
      ui.verify.disabled = false;
    }
  });

  // --- Audio file and the SRT cache ---

  ui.audioFile.addEventListener('change', async () => {
    const file = ui.audioFile.files?.[0];
    if (!file) return;
    state.audio = file;
    ui.audio.src = URL.createObjectURL(file);
    updateButtons();
    const cached = await getSrt(audioKey(file)).catch(() => undefined);
    if (cached) {
      hooks.loadSrt(cached, 'the cache');
      setStatus(`Subtitles for ${file.name} loaded from the cache.`);
    } else {
      setStatus(`${file.name}: no subtitles yet.`);
    }
  });

  /** Keep the SRT, and show it when its audio file is the picked one. */
  async function finish(srt: string, key: string, name: string, source: string): Promise<void> {
    await putSrt(key, srt).catch(() => {});
    if (state.audio && audioKey(state.audio) === key) {
      hooks.loadSrt(srt, source);
      setStatus(`Subtitles ready from ${source}.`);
    } else {
      setStatus(`Subtitles for ${name} are ready. Pick that audio file to load them.`);
    }
  }

  // --- Server job ---

  function jobLine(job: JobOut): string {
    const pct = Math.round(job.progress * 100);
    return `Server job ${job.status}: ${job.stage} (${pct}%)`;
  }

  /** Poll a server job to its end and load the SRT. */
  async function follow(pending: PendingJob): Promise<void> {
    const abort = new AbortController();
    state.abort = abort;
    try {
      const job = await pollUntilDone(http(), pending.id, {
        intervalMs: POLL_MS,
        signal: abort.signal,
        onStatus: (j) => {
          setStatus(jobLine(j));
          setProgress(j.progress);
        },
      });
      write(KEYS.job, null);
      if (job.status === 'succeeded') {
        const srt = await fetchSrt(http(), job.id);
        await finish(srt, pending.audioKey, pending.audioName, 'subread.space');
      } else {
        setStatus(`Server job ${job.status}: ${job.error ?? job.stage}`);
      }
    } finally {
      state.abort = null;
    }
  }

  ui.cloud.addEventListener('click', async () => {
    const audio = state.audio;
    if (!audio || state.busy) return;
    setBusy(true);
    try {
      setStatus(`Uploading ${audio.name} and the OCR text...`);
      setProgress(0);
      const job = await upload(http(), audio, bookFile(hooks.tokens()));
      const pending: PendingJob = { id: job.id, audioKey: audioKey(audio), audioName: audio.name };
      write(KEYS.job, JSON.stringify(pending));
      try {
        await startJob(http(), job.id, ui.lang.value);
      } catch (err) {
        write(KEYS.job, null);
        if (err instanceof ApiError && err.status === 402) {
          setStatus(`No credit: ${err.message}`, { href: SITE, label: 'Buy credits or sign in.' });
          return;
        }
        throw err;
      }
      await follow(pending);
      void refreshAccount();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setStatus(`Server job failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  });

  // --- In-app job ---

  function phaseLine(s: JobStatus): string {
    let line = `${s.phase}: ${s.detail}`;
    if (s.eta) line += `, about ${Math.round(s.eta / 60)} min left`;
    return line;
  }

  ui.local.addEventListener('click', async () => {
    const audio = state.audio;
    if (!audio || state.busy) return;
    setBusy(true);
    let wakeLock: WakeLockSentinel | null = null;
    try {
      setStatus('preparing: loading the engine');
      setProgress(0);
      const { Job, Cancelled } = await import('./engine/job.js');
      const job = new Job({
        audio: [audio],
        paragraphs: paragraphs(bookText(hooks.tokens())),
        language: ui.lang.value,
        assets: assets(),
        onStatus: (s) => {
          setStatus(phaseLine(s));
          setProgress(s.indeterminate ? null : s.fraction);
        },
      });
      state.job = job;
      try {
        wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Not granted. The user keeps the screen on by hand.
      }
      try {
        const result = await job.run();
        const pct = Math.round(result.matchRate * 100);
        await finish(result.srt, audioKey(audio), audio.name, `this app (${pct}% matched)`);
      } catch (err) {
        setStatus(err instanceof Cancelled ? 'Stopped.' : `In-app job failed: ${String(err)}`);
      } finally {
        job.close();
      }
    } catch (err) {
      setStatus(`Cannot load the engine: ${String(err)}`);
    } finally {
      state.job = null;
      await wakeLock?.release().catch(() => {});
      setBusy(false);
    }
  });

  ui.stop.addEventListener('click', async () => {
    if (state.job) {
      state.job.cancel();
      return;
    }
    const raw = read(KEYS.job);
    state.abort?.abort();
    if (raw) {
      const pending = JSON.parse(raw) as PendingJob;
      write(KEYS.job, null);
      try {
        await cancelJob(http(), pending.id);
        setStatus('Server job canceled.');
      } catch (err) {
        setStatus(`Cancel failed: ${String(err)}`);
      }
    }
    setBusy(false);
  });

  // --- Start ---

  const raw = read(KEYS.job);
  if (raw) {
    const pending = JSON.parse(raw) as PendingJob;
    setStatus(`Resuming the server job for ${pending.audioName}...`);
    setBusy(true);
    follow(pending)
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setStatus(`Server job failed: ${String(err)}`);
      })
      .finally(() => setBusy(false));
  }
  void refreshAccount();
  updateButtons();

  return {
    onTokens() {
      ui.lang.value = whisperCode(hooks.ocrLang());
      updateButtons();
    },
  };
}
