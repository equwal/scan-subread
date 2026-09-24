/* Copied from equwal/subplz-web frontend/engine (AGPL-3.0, same author).
 * Adapted: the paragraphs come in as a string list (the OCR lines), so the
 * book reader is gone; the video and read-along epub outputs are gone; the
 * engine assets load from a configurable base URL.
 */

/* One conversion, start to finish, in this tab.
 *
 *   audio --ffmpeg--> two-minute chunks --whisper--> rough transcript
 *   OCR lines ------> paragraphs
 *   transcript + paragraphs --align--> subtitles (.srt)
 *
 * Nothing leaves the machine. The transcript is saved to IndexedDB after every
 * chunk, because transcribing a book takes hours and tabs get closed: opening
 * the same files again carries on from the last chunk.
 */
import { Media, quietestPoint, SAMPLE_RATE } from './media.js';
import { Recogniser } from './asr.js';

const CHUNK_SECONDS = 120;

export class Cancelled extends Error { constructor() { super('Stopped.'); } }

/* ------------------------------------------------------------ saved progress */

const db = () => new Promise((resolve, reject) => {
  const open = indexedDB.open('subread', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('transcripts');
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});

async function store(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('transcripts', mode);
    const req = fn(tx.objectStore('transcripts'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** The same files picked again resume, whatever route they were picked by. */
const keyFor = (files, language) => files.map((f) => `${f.name}|${f.size}`).join('//') + `#${language}`;

export async function savedProgress(files, language) {
  try { return (await store('readonly', (s) => s.get(keyFor(files, language)))) ?? null; } catch { return null; }
}

/* ------------------------------------------------------------------- the job */

export class Job {
  #media = null;
  #paths = [];
  #cancelled = false;

  constructor({ audio, paragraphs, language, assets, onStatus }) {
    this.audio = audio;            // File[], in playback order
    this.paragraphs = paragraphs;  // string[], the book text lines
    this.language = language;      // Whisper code; always explicit, see asr.js
    this.assets = assets;          // URL that ends with "/", see asr.js and media.js
    this.onStatus = onStatus ?? (() => {});
    this.result = null;
  }

  cancel() { this.#cancelled = true; }
  #check() { if (this.#cancelled) throw new Cancelled(); }
  #status(phase, detail, fraction, extra = {}) { this.onStatus({ phase, detail, fraction, ...extra }); }

  async run() {
    if (!this.paragraphs.length) throw new Error('The book has no text. Run OCR first.');

    this.#status('preparing', 'Starting the audio decoder', 0);
    this.#media = await Media.open(this.assets);
    const parts = [];
    for (const [i, file] of this.audio.entries()) {
      const path = await this.#media.mount(file, `/in${i}`);
      parts.push({ path, ...(await this.#media.probe(path)) });
      this.#paths.push(path);
    }
    const total = parts.reduce((n, p) => n + p.duration, 0);

    const transcript = await this.#transcribe(parts, total);
    this.#check();

    this.#status('aligning', 'Matching the book to the narration', 0.97);
    const aligned = await alignInWorker(transcript, this.paragraphs, this.language);
    const stem = this.audio[0].name.replace(/\.[^.]+$/, '');
    this.result = {
      ...aligned, stem, duration: total, parts,
      srtName: `${stem}.${this.language}.srt`,
      segments: transcript.length,
    };
    this.#status('done', 'Done', 1);
    return this.result;
  }

  async #transcribe(parts, total) {
    const key = keyFor(this.audio, this.language);
    const saved = (await savedProgress(this.audio, this.language)) ?? { doneUntil: 0, segments: [], complete: false };
    if (saved.complete) return saved.segments;

    this.#status('preparing', 'Loading the speech model', 0, { indeterminate: true });
    const asr = await Recogniser.open(this.assets, (p) => {
      if (p.total) this.#status('preparing', 'Downloading the speech model (once)', p.loaded / p.total * 0.02);
    });
    this.device = asr.device;

    const resumedAt = saved.doneUntil, started = performance.now();
    let base = 0;   // where the current part starts on the whole book's clock
    for (const part of parts) {
      let pos = Math.max(0, saved.doneUntil - base);
      while (pos < part.duration - 0.05) {
        this.#check();
        let pcm = await this.#media.pcm(part.path, pos, CHUNK_SECONDS);
        if (!pcm.length) break;
        const last = pos + pcm.length / SAMPLE_RATE >= part.duration - 0.5;
        // Cut where the narrator pauses, so no word straddles two chunks.
        if (!last) pcm = pcm.subarray(0, quietestPoint(pcm));

        const at = base + pos;
        saved.segments.push(...await asr.transcribe(pcm, this.language, at));
        pos += pcm.length / SAMPLE_RATE;
        saved.doneUntil = base + pos;
        await store('readwrite', (s) => s.put(saved, key)).catch(() => {});

        const elapsed = (performance.now() - started) / 1000;
        const speed = (saved.doneUntil - resumedAt) / elapsed;
        this.#status('transcribing', `Listening: ${clock(saved.doneUntil)} of ${clock(total)}`,
          0.02 + 0.94 * saved.doneUntil / total,
          { eta: elapsed > 10 ? (total - saved.doneUntil) / speed : null, speed: elapsed > 10 ? speed : null });
      }
      base += part.duration;
    }
    saved.complete = true;
    await store('readwrite', (s) => s.put(saved, key)).catch(() => {});
    return saved.segments;
  }

  close() { this.#media?.close(); }
}

function alignInWorker(transcript, paragraphs, language) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./align.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.ok) resolve(data); else reject(new Error(data.error));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'The aligner crashed.')); };
    worker.postMessage({ transcript, paragraphs, language });
  });
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds)), pad = (v) => String(v).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
