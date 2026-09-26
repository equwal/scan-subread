// UI wiring. The logic lives in the pure modules: align.ts, follower.ts,
// hit-test.ts, line-boxes.ts, read-order.ts, text-layer.ts, player-state.ts,
// play-clock.ts.

import { createAligner, type Aligner, type OcrToken, type TokenSpan } from './align';
import { bookText } from './book-text';
import { LocalAudioClock, OverlayClock, type ClockSource, type ClockState } from './clock-source';
import { cueMoved, follow, type FollowMode } from './follower';
import { lookupText, tokenAt } from './hit-test';
import { lineBoxes } from './line-boxes';
import { createOcr, type Ocr } from './ocr';
import { loadPdf, type PdfDoc } from './pdf';
import { nextPage } from './read-order';
import { isAndroid, SubRead } from './subread';
import { cueIndexAt, parseSubtitles, type Cue } from './subtitles';
import {
  bookKey,
  clearPages,
  getPage,
  getSrt,
  pageKey,
  putPage,
  putSrt,
  type PageEntry,
} from './token-cache';

/** Page width in pixels for OCR and the text layer. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

/** How far from a character a tap may land, as a share of the page width. */
const TAP_TOLERANCE = 0.015;

/** The space around a box of the mark, in CSS pixels. */
const BOX_PAD = 2;

/** Milliseconds to wait after a page is read before the cues are aligned again. */
const ALIGN_DEBOUNCE = 300;

const OVERLAY_RELEASES = 'https://github.com/equwal/subread-overlay/releases/latest';
const SUBREAD_RELEASES = 'https://github.com/equwal/subread-android/releases/latest';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

const ui = {
  menu: el<HTMLButtonElement>('menu'),
  panel: el<HTMLElement>('panel'),
  pdfFile: el<HTMLInputElement>('pdf-file'),
  subFile: el<HTMLInputElement>('sub-file'),
  make: el<HTMLElement>('make'),
  makeSubs: el<HTMLButtonElement>('make-subs'),
  subLang: el<HTMLSelectElement>('sub-lang'),
  makeStatus: el<HTMLDivElement>('make-status'),
  srtRow: el<HTMLDivElement>('srt-row'),
  srtDownload: el<HTMLAnchorElement>('srt-download'),
  srtShare: el<HTMLButtonElement>('srt-share'),
  audioRow: el<HTMLElement>('audio-row'),
  audioFile: el<HTMLInputElement>('audio-file'),
  audio: el<HTMLAudioElement>('audio'),
  playerStatus: el<HTMLDivElement>('player-status'),
  pagesStatus: el<HTMLDivElement>('pages-status'),
  status: el<HTMLDivElement>('status'),
  progress: el<HTMLProgressElement>('progress'),
  follow: el<HTMLFieldSetElement>('follow'),
  lang: el<HTMLSelectElement>('lang'),
  forceOcr: el<HTMLInputElement>('force-ocr'),
  dict: el<HTMLSelectElement>('dict'),
  pauseLookup: el<HTMLInputElement>('pause-lookup'),
  clearCache: el<HTMLButtonElement>('clear-cache'),
  cues: el<HTMLOListElement>('cues'),
  prev: el<HTMLButtonElement>('prev'),
  next: el<HTMLButtonElement>('next'),
  play: el<HTMLButtonElement>('play'),
  syncPage: el<HTMLButtonElement>('sync-page'),
  pageLabel: el<HTMLSpanElement>('page-label'),
  viewer: el<HTMLDivElement>('viewer'),
  page: el<HTMLDivElement>('page'),
  overlay: el<HTMLDivElement>('overlay'),
};

const state = {
  pdf: null as PdfDoc | null,
  file: null as File | null,
  /** The tokens of each page that is read. Index = page. */
  pages: [] as (PageEntry | undefined)[],
  /** The tokens of the pages read so far, in page order. */
  tokens: [] as OcrToken[],
  cues: [] as Cue[],
  /** The aligner of the loaded subtitles. It keeps the result of each page. */
  aligner: null as Aligner | null,
  spans: [] as TokenSpan[],
  /** The page of each cue, or null for an unmatched cue. */
  cuePages: [] as (number | null)[],
  currentPage: -1,
  /** The cue of the last clock state, or -1. */
  activeCue: -1,
  /** The cue whose box is drawn on the page, or -1. */
  markedCue: -1,
  clock: null as ClockState | null,
  renderSeq: 0,
  readSeq: 0,
  alignTimer: null as ReturnType<typeof setTimeout> | null,
  srt: null as string | null,
  /** True while the player waits for a dictionary lookup that this app paused. */
  lookupPaused: false,
};

// --- Settings ---

const settings = {
  get(key: string, fallback: string): string {
    return localStorage.getItem(`scan-subread.${key}`) ?? fallback;
  },
  set(key: string, value: string): void {
    localStorage.setItem(`scan-subread.${key}`, value);
  },
};

function followMode(): FollowMode {
  const checked = ui.follow.querySelector<HTMLInputElement>('input:checked');
  return (checked?.value as FollowMode | undefined) ?? 'highlight';
}

function loadSettings(): void {
  const mode = settings.get('follow', 'highlight');
  for (const input of ui.follow.querySelectorAll<HTMLInputElement>('input')) {
    input.checked = input.value === mode;
  }
  ui.lang.value = settings.get('lang', 'eng');
  ui.subLang.value = settings.get('subLang', 'auto');
  ui.forceOcr.checked = settings.get('forceOcr', '0') === '1';
  ui.pauseLookup.checked = settings.get('pauseLookup', '1') === '1';
}

ui.follow.addEventListener('change', () => {
  settings.set('follow', followMode());
  state.markedCue = -1;
  drawBoxes();
  if (state.clock) applyClock({ ...state.clock, seeked: true });
});
ui.pauseLookup.addEventListener('change', () =>
  settings.set('pauseLookup', ui.pauseLookup.checked ? '1' : '0'),
);
ui.subLang.addEventListener('change', () => settings.set('subLang', ui.subLang.value));
ui.lang.addEventListener('change', () => {
  settings.set('lang', ui.lang.value);
  void readBook();
});
ui.forceOcr.addEventListener('change', () => {
  settings.set('forceOcr', ui.forceOcr.checked ? '1' : '0');
  void readBook();
});

function setStatus(text: string, link?: { href: string; text: string }): void {
  ui.status.textContent = text;
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.text;
    ui.status.append(' ', a);
  }
}

// --- Drawer ---

function setMenu(open: boolean): void {
  document.body.classList.toggle('menu-open', open);
  ui.menu.setAttribute('aria-expanded', String(open));
}

ui.menu.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));

// A tap outside the drawer closes the drawer.
document.addEventListener('click', (e) => {
  const target = e.target as Node;
  if (
    document.body.classList.contains('menu-open') &&
    !ui.panel.contains(target) &&
    !ui.menu.contains(target)
  ) {
    setMenu(false);
  }
});

// --- The PDF ---

ui.pdfFile.addEventListener('change', async () => {
  const file = ui.pdfFile.files?.[0];
  if (!file) return;
  try {
    state.readSeq++;
    await state.pdf?.destroy();
    state.pdf = await loadPdf(await file.arrayBuffer());
    state.file = file;
    state.pages = [];
    state.tokens = [];
    state.spans = [];
    state.cuePages = [];
    state.activeCue = -1;
    state.markedCue = -1;
    ui.makeSubs.disabled = false;
    setStatus(`PDF loaded: ${state.pdf.numPages} pages.`);
    await showPage(0);
    const saved = await getSrt(bookKey(file));
    if (saved) loadSubtitles(saved, 'the last SubRead run');
    void readBook();
  } catch (err) {
    setStatus(`Cannot open PDF: ${String(err)}`);
  }
});

/** The tokens of one page: from the cache, else the text layer, else OCR. */
async function readPage(
  pdf: PdfDoc,
  file: File,
  page: number,
  ocr: () => Promise<Ocr>,
): Promise<PageEntry> {
  const lang = ui.lang.value;
  const force = ui.forceOcr.checked;
  if (!force) {
    const cached = await getPage(pageKey(file, page, lang, 'text'));
    if (cached) return cached;
  }
  const cachedOcr = await getPage(pageKey(file, page, lang, 'ocr'));
  if (cachedOcr) return cachedOcr;
  if (!force) {
    const text = await pdf.pageText(page, OCR_WIDTH);
    if (text.tokens) {
      const entry: PageEntry = { ...text, tokens: text.tokens, source: 'text' };
      await putPage(pageKey(file, page, lang, 'text'), entry);
      return entry;
    }
  }
  const canvas = await pdf.renderPage(page, OCR_WIDTH);
  const tokens = await (await ocr()).recognize(canvas, page);
  const entry: PageEntry = { tokens, width: canvas.width, height: canvas.height, source: 'ocr' };
  await putPage(pageKey(file, page, lang, 'ocr'), entry);
  return entry;
}

/**
 * Reads every page of the book: the current page first, then the pages
 * after it, then the pages before it. The cues are aligned again as pages
 * finish, so the follow starts before the whole book is read.
 */
async function readBook(): Promise<void> {
  const { pdf, file } = state;
  if (!pdf || !file) return;
  const seq = ++state.readSeq;
  state.pages = [];
  state.tokens = [];
  // The spans index the old tokens, so they go too.
  state.spans = [];
  state.cuePages = [];
  state.markedCue = -1;
  ui.pagesStatus.textContent = `Pages: 0/${pdf.numPages} read.`;
  const pending = new Set(Array.from({ length: pdf.numPages }, (_, i) => i));
  // The OCR worker starts on the first page that needs it.
  const ocr: { started?: Promise<Ocr> } = {};
  const getOcr = (): Promise<Ocr> => {
    ocr.started ??= createOcr(ui.lang.value, (p) => {
      ui.progress.value = p;
    });
    return ocr.started;
  };
  const counts = { text: 0, ocr: 0 };
  try {
    while (pending.size > 0) {
      const page = nextPage(pending, state.currentPage);
      pending.delete(page);
      ui.progress.hidden = false;
      ui.progress.value = 0;
      setStatus(`Reading page ${page + 1} of ${pdf.numPages}...`);
      const entry = await readPage(pdf, file, page, getOcr);
      if (seq !== state.readSeq) return; // Another book or another setting took over.
      counts[entry.source]++;
      state.pages[page] = entry;
      // Put the tokens of the page at their place in page order.
      const at = state.pages.slice(0, page).reduce((n, p) => n + (p?.tokens.length ?? 0), 0);
      state.tokens.splice(at, 0, ...entry.tokens);
      setStatus(`Page ${page + 1}: ${entry.source === 'text' ? 'text layer' : 'OCR'}.`);
      ui.pagesStatus.textContent =
        `Pages: ${counts.text + counts.ocr}/${pdf.numPages} read ` +
        `(${counts.text} text layer, ${counts.ocr} OCR).`;
      if (page === state.currentPage) drawBoxes();
      scheduleAlign();
    }
  } catch (err) {
    if (seq === state.readSeq) setStatus(`Cannot read the pages: ${String(err)}`);
  } finally {
    if (ocr.started) await (await ocr.started).terminate().catch(() => undefined);
    if (seq === state.readSeq) ui.progress.hidden = true;
  }
}

/** True when every page of the book is read. */
function allPagesRead(): boolean {
  const pdf = state.pdf;
  return !!pdf && state.pages.filter((p) => p).length === pdf.numPages;
}

ui.clearCache.addEventListener('click', async () => {
  await clearPages();
  setStatus('Page cache cleared.');
});

// --- Subtitles ---

/** Load subtitles from a file or from SubRead. `source` names where they came from. */
function loadSubtitles(text: string, source: string): void {
  state.cues = parseSubtitles(text);
  state.aligner = createAligner(state.cues.map((c) => c.text));
  state.srt = text;
  state.spans = [];
  state.cuePages = [];
  state.activeCue = -1;
  state.markedCue = -1;
  setStatus(`${state.cues.length} cues loaded from ${source}.`);
  ui.syncPage.disabled = state.cues.length === 0;
  renderCueList();
  align();
  offerSrt(text);
}

ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  if (!file) return;
  loadSubtitles(await file.text(), file.name);
});

function offerSrt(text: string): void {
  const name = `${(state.file?.name ?? 'book').replace(/\.pdf$/i, '')}.srt`;
  ui.srtRow.hidden = false;
  ui.srtDownload.hidden = isAndroid;
  ui.srtShare.hidden = !isAndroid;
  if (!isAndroid) {
    URL.revokeObjectURL(ui.srtDownload.href);
    ui.srtDownload.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    ui.srtDownload.download = name;
  }
  ui.srtShare.onclick = () => {
    SubRead.shareText({ name, text }).catch((err) => setStatus(String(err)));
  };
}

ui.makeSubs.addEventListener('click', async () => {
  const file = state.file;
  if (!file) return;
  let audio;
  try {
    audio = await SubRead.pickAudio();
  } catch {
    return;
  }
  const read = state.pages.filter((p) => p).length;
  ui.makeStatus.textContent = allPagesRead()
    ? `SubRead makes the subtitles for ${audio.name}...`
    : `Only ${read} of ${state.pdf?.numPages ?? 0} pages are read. The subtitles cover those pages. SubRead runs...`;
  const result = await SubRead.makeSubtitles({
    audio: audio.uri,
    bookText: bookText(state.tokens),
    language: ui.subLang.value,
  });
  if (result.error === 'not_installed') {
    ui.makeStatus.replaceChildren('SubRead is not installed. ');
    const a = document.createElement('a');
    a.href = SUBREAD_RELEASES;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Get SubRead';
    ui.makeStatus.append(a);
    return;
  }
  if (result.error !== undefined || result.srt === undefined) {
    ui.makeStatus.textContent = `SubRead made no subtitles: ${result.error ?? 'no file'}.`;
    return;
  }
  const rate = result.matchRate !== undefined && result.matchRate >= 0 ? result.matchRate : null;
  ui.makeStatus.textContent =
    `${result.cues ?? '?'} cues, language ${result.language ?? '?'}` +
    (rate === null ? '.' : `, ${Math.round(rate * 100)}% of the lines found in the book.`) +
    (rate !== null && rate < 0.8
      ? ' Under 80% usually means another edition or the wrong language.'
      : '');
  await putSrt(bookKey(file), result.srt);
  loadSubtitles(result.srt, 'SubRead');
});

// --- Alignment ---

function scheduleAlign(): void {
  if (state.alignTimer) clearTimeout(state.alignTimer);
  state.alignTimer = setTimeout(align, ALIGN_DEBOUNCE);
}

/** Align the cues to the pages read so far. */
function align(): void {
  state.alignTimer = null;
  if (!state.aligner || state.cues.length === 0 || state.tokens.length === 0) return;
  const before = state.cuePages;
  state.spans = state.aligner.spans(state.pages.map((p) => p?.tokens));
  state.cuePages = state.spans.map((s) => (s.matched ? state.tokens[s.start]!.page : null));
  const matched = state.cuePages.filter((p) => p !== null).length;
  setStatus(`${matched}/${state.cues.length} cues matched to the page text.`);
  renderCueList();
  // Follow again only when the alignment moved the cue of now, for
  // example when it became matched. A page read in the background must not
  // undo a page turn by hand.
  if (state.clock && cueMoved(before, state.cuePages, clockCue(state.clock))) {
    applyClock({ ...state.clock, seeked: true });
  }
}

// --- Cue list ---

function renderCueList(): void {
  ui.cues.replaceChildren(
    ...state.cues.map((cue, i) => {
      const li = document.createElement('li');
      li.textContent = cue.text;
      li.title = `${cue.start.toFixed(2)} s`;
      const span = state.spans[i];
      if (span && !span.matched) li.classList.add('unmatched');
      if (i === state.activeCue) li.classList.add('active');
      li.addEventListener('click', () => void clock.seek(cue.start * 1000));
      return li;
    }),
  );
}

function markCueInList(i: number): void {
  const items = ui.cues.children;
  items[state.activeCue]?.classList.remove('active');
  const item = items[i];
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ block: 'nearest' });
  }
}

// --- The follow ---

function clockText(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return `${h > 0 ? `${h}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function showPlayerStatus(s: ClockState): void {
  ui.playerStatus.replaceChildren();
  ui.play.disabled = s.error === 'no_overlay' || (!isAndroid && s.error === 'no_player');
  ui.play.textContent = s.playing ? '⏸' : '▶';
  const name = isAndroid ? 'Player' : 'Audio';
  if (s.error === 'no_overlay') {
    ui.playerStatus.append('SubRead Overlay not installed. ');
    const a = document.createElement('a');
    a.href = OVERLAY_RELEASES;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Get it';
    ui.playerStatus.append(a);
  } else if (s.error === 'no_notification_access') {
    ui.playerStatus.textContent = 'Allow notification access in SubRead Overlay.';
  } else if (s.error === 'no_player') {
    ui.playerStatus.textContent = isAndroid ? 'No player.' : 'No audio file.';
  } else if (s.positionMs === null) {
    ui.playerStatus.textContent = `${name}: no position.`;
  } else {
    ui.playerStatus.textContent = `${name}: ${clockText(s.positionMs)}, ${s.playing ? 'playing' : 'paused'}`;
  }
}

/** The cue at the position of a clock state, or -1. */
function clockCue(s: ClockState): number {
  return s.positionMs === null ? -1 : cueIndexAt(state.cues, s.positionMs / 1000);
}

/** One state of the clock: mark the cue of now and turn the page. */
function applyClock(s: ClockState): void {
  state.clock = s;
  showPlayerStatus(s);
  const cue = clockCue(s);
  // The last cue stays marked in the silence between two cues.
  if (cue < 0) return;
  const out = follow({
    cuePages: state.cuePages,
    mode: followMode(),
    currentPage: state.currentPage,
    previousCue: state.activeCue,
    cue,
    seeked: s.seeked,
  });
  const changed = cue !== state.activeCue || s.seeked;
  if (cue !== state.activeCue) markCueInList(cue);
  state.activeCue = cue;
  if (!changed || followMode() === 'off') return;
  state.markedCue = out.highlightCue ?? -1;
  if (out.turnToPage !== null) void showPage(out.turnToPage);
  else drawBoxes();
}

const clock: ClockSource = isAndroid ? new OverlayClock(SubRead) : new LocalAudioClock(ui.audio);
clock.start(applyClock);

ui.play.addEventListener('click', () => {
  const action = state.clock?.playing ? clock.pause() : clock.play();
  action.catch((err) => setStatus(String(err)));
});

ui.syncPage.addEventListener('click', () => {
  const i = state.cuePages.indexOf(state.currentPage);
  if (i < 0) {
    setStatus('No cue of the subtitles is on this page.');
    return;
  }
  const ms = state.cues[i]!.start * 1000;
  clock.seek(ms).then(
    () => setStatus(`Audio moved to ${clockText(ms)}.`),
    (err) => setStatus(String(err)),
  );
});

ui.audioFile.addEventListener('change', () => {
  const file = ui.audioFile.files?.[0];
  if (!file) return;
  ui.audio.src = URL.createObjectURL(file);
});

// --- Page view ---

async function showPage(index: number): Promise<void> {
  const pdf = state.pdf;
  if (!pdf || index < 0 || index >= pdf.numPages) return;
  const seq = ++state.renderSeq;
  state.currentPage = index;
  ui.pageLabel.textContent = `${index + 1} / ${pdf.numPages}`;
  // Render at device resolution, up to the OCR width, so zoom stays sharp.
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(Math.min(OCR_WIDTH, Math.max(300, ui.viewer.clientWidth - 16) * dpr));
  const canvas = await pdf.renderPage(index, width);
  if (seq !== state.renderSeq) return; // A newer render replaced this one.
  ui.page.querySelector('canvas')?.remove();
  ui.page.prepend(canvas);
  drawBoxes();
}

/** Draw one box per text line for the marked cue on the current page. */
function drawBoxes(): void {
  ui.overlay.replaceChildren();
  const span = state.spans[state.markedCue];
  const size = state.pages[state.currentPage];
  const shown = ui.page.querySelector('canvas')?.getBoundingClientRect().width;
  if (!span || !size || !shown) return;
  const pad = (BOX_PAD * size.width) / shown;
  for (const box of lineBoxes(state.tokens, span, state.currentPage, pad)) {
    const div = document.createElement('div');
    div.className = 'box';
    div.style.left = `${(100 * box.x0) / size.width}%`;
    div.style.top = `${(100 * box.y0) / size.height}%`;
    div.style.width = `${(100 * (box.x1 - box.x0)) / size.width}%`;
    div.style.height = `${(100 * (box.y1 - box.y0)) / size.height}%`;
    ui.overlay.append(div);
  }
}

ui.prev.addEventListener('click', () => void showPage(state.currentPage - 1));
ui.next.addEventListener('click', () => void showPage(state.currentPage + 1));

// --- Tap on a word ---

/** Tap on the page: send the text under the tap to the dictionary. */
ui.page.addEventListener('click', async (e) => {
  const canvas = ui.page.querySelector('canvas');
  const size = state.pages[state.currentPage];
  if (!canvas || !size) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * size.width;
  const y = ((e.clientY - rect.top) / rect.height) * size.height;
  const t = tokenAt(state.tokens, state.currentPage, x, y, TAP_TOLERANCE * size.width);
  if (t < 0) return;
  const text = lookupText(state.tokens, t);
  setStatus(`Lookup: "${text}"`);
  const pause = ui.pauseLookup.checked && state.clock?.playing === true && !state.lookupPaused;
  try {
    if (pause) {
      state.lookupPaused = true;
      await clock.pause();
    }
    const { closed } = await SubRead.lookup({ text });
    if (closed && state.lookupPaused) await clock.play();
  } catch (err) {
    setStatus(`Lookup failed: ${String(err)}`);
  } finally {
    if (pause) state.lookupPaused = false;
  }
});

// --- Dictionaries (Android) ---

async function loadDictionaries(): Promise<void> {
  const { apps, chosen } = await SubRead.dictionaries();
  for (const app of apps) {
    const option = document.createElement('option');
    option.value = app.component;
    option.textContent = app.label;
    ui.dict.append(option);
  }
  ui.dict.value = apps.some((a) => a.component === chosen) ? chosen : '';
}

ui.dict.addEventListener('change', () => {
  SubRead.setDictionary({ component: ui.dict.value }).catch((err) => setStatus(String(err)));
});

// --- Start ---

loadSettings();
ui.make.hidden = !isAndroid;
ui.audioRow.hidden = isAndroid;
if (isAndroid) void loadDictionaries().catch((err) => setStatus(String(err)));
