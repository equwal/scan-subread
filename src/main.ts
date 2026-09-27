// UI wiring: the state of the book, the subtitles and the follow. The
// logic lives in the pure modules (align.ts, cue-pages.ts, follower.ts,
// hit-test.ts, line-boxes.ts, messages.ts, paging.ts, read-order.ts,
// scroll.ts, text-layer.ts, player-state.ts, play-clock.ts). The UI parts
// are in drawer.ts (the menu), nav.ts (page turns by the user), status.ts
// (the strip) and view.ts (the page).

import { createAligner, type Aligner, type OcrToken, type TokenSpan } from './align';
import { srtName, subtitlesOnOpen } from './book-subtitles';
import { bookText } from './book-text';
import { LocalAudioClock, OverlayClock, type ClockSource, type ClockState } from './clock-source';
import { audioPage, cueParts, cueProgress, pageStartTime, type CueParts } from './cue-pages';
import { setupDrawer } from './drawer';
import { follow, type FollowEvent, type FollowMode } from './follower';
import { lookupText, tapTolerance, tokenAt } from './hit-test';
import { lineBoxes, padBox } from './line-boxes';
import {
  clockText,
  EMPTY_FILE_TEXT,
  errorMessage,
  LAST_BOOK_GONE_TEXT,
  matchedText,
  noCuesText,
  notReadText,
  pagesReadText,
  pdfLoadedText,
  pdfOpenText,
  playerMessage,
  readingText,
  UPDATING_CACHE_TEXT,
  type Message,
} from './messages';
import { setupNav } from './nav';
import type { Ocr } from './ocr';
import { defaultRtl } from './paging';
import type { PdfDoc } from './pdf';
import { nextPage } from './read-order';
import { scrollTarget } from './scroll';
import { say, showPlayer, showReading } from './status';
import { isAndroid, SubRead } from './subread';
import { decodeSubtitles, lastCueAt, parseSubtitles, type Cue } from './subtitles';
import {
  bookKey,
  clearLastBook,
  clearPages,
  dbReady,
  getLastBook,
  getMeta,
  getPage,
  pageKey,
  putLastBook,
  putMeta,
  putPage,
  type BookMeta,
  type BookSubtitles,
  type PageEntry,
} from './token-cache';
import { createPageView, type Marks } from './view';

/** Page width in pixels for OCR and the text layer. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

/** Milliseconds to wait after a page is read before the cues are aligned again. */
const ALIGN_DEBOUNCE = 300;

/** Milliseconds after a page change before the page goes to the meta data of the book. */
const PAGE_SAVE_MS = 1000;

/** After this many milliseconds, the strip tells that the database upgrade holds the reading. */
const SLOW_DB_MS = 2000;

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
  follow: el<HTMLFieldSetElement>('follow'),
  lang: el<HTMLSelectElement>('lang'),
  forceOcr: el<HTMLInputElement>('force-ocr'),
  dictRow: el<HTMLLabelElement>('dict-row'),
  dict: el<HTMLSelectElement>('dict'),
  pauseRow: el<HTMLLabelElement>('pause-row'),
  pauseLookup: el<HTMLInputElement>('pause-lookup'),
  clearCache: el<HTMLButtonElement>('clear-cache'),
  cues: el<HTMLOListElement>('cues'),
  pageLeft: el<HTMLButtonElement>('page-left'),
  pageRight: el<HTMLButtonElement>('page-right'),
  play: el<HTMLButtonElement>('play'),
  syncPage: el<HTMLButtonElement>('sync-page'),
  pageLabel: el<HTMLButtonElement>('page-label'),
  pageInput: el<HTMLInputElement>('page-input'),
  followNow: el<HTMLButtonElement>('follow-now'),
  followNote: el<HTMLSpanElement>('follow-note'),
  rtl: el<HTMLInputElement>('rtl'),
  viewer: el<HTMLDivElement>('viewer'),
  empty: el<HTMLElement>('empty'),
  openPdf: el<HTMLButtonElement>('open-pdf'),
  page: el<HTMLDivElement>('page'),
  overlay: el<HTMLDivElement>('overlay'),
};

const state = {
  pdf: null as PdfDoc | null,
  file: null as File | null,
  /** The key of the open book (see bookKey), or null. */
  book: null as string | null,
  /** The tokens of each page that is read. Index = page. */
  pages: [] as (PageEntry | undefined)[],
  /** The tokens of the pages read so far, in page order. */
  tokens: [] as OcrToken[],
  cues: [] as Cue[],
  /** The aligner of the loaded subtitles. It keeps the result of each page. */
  aligner: null as Aligner | null,
  spans: [] as TokenSpan[],
  /** The parts of each cue on the pages. Empty for an unmatched cue. */
  cueParts: [] as CueParts[],
  currentPage: -1,
  /** The cue of the last clock state, or -1. */
  activeCue: -1,
  /** The cue whose box is drawn on the page, or -1. */
  markedCue: -1,
  clock: null as ClockState | null,
  readSeq: 0,
  alignTimer: null as ReturnType<typeof setTimeout> | null,
  /** The subtitles that are loaded, or null. */
  subtitles: null as BookSubtitles | null,
  /** The book of the loaded subtitles. Null when they were loaded while no book was open. */
  subtitlesBook: null as string | null,
  /** The count of subtitle loads. The meta data of a book does not replace later subtitles. */
  subtitlesSeq: 0,
  /** The last message of the reading of the pages, or null. */
  reading: null as Message | string | null,
  /** True while the database is not open after SLOW_DB_MS. */
  dbSlow: false,
  /** True while the player waits for a dictionary lookup that this app paused. */
  lookupPaused: false,
  /** True while a page turn by the user holds the follow. */
  held: false,
};

const view = createPageView(ui, marks);

// The cue list can show the cue of now only when the drawer opens.
const drawer = setupDrawer(ui, () => scrollCueList(state.activeCue));

const nav = setupNav(
  ui,
  {
    pages: () => state.pdf?.numPages ?? 0,
    current: () => state.currentPage,
    rtl: () => ui.rtl.checked,
    drawerOpen: drawer.covers,
  },
  turnByUser,
);

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
  loadRtl();
}

/**
 * The reading direction: the setting of the user, else the default for
 * the OCR language, so that vertical Japanese turns right to left.
 */
function loadRtl(): void {
  const saved = settings.get('rtl', '');
  ui.rtl.checked = saved === '' ? defaultRtl(ui.lang.value) : saved === '1';
  nav.update();
}

ui.rtl.addEventListener('change', () => {
  settings.set('rtl', ui.rtl.checked ? '1' : '0');
  nav.update();
});

// A new follow mode follows the audio at once.
ui.follow.addEventListener('change', () => {
  settings.set('follow', followMode());
  runFollow('follow');
});
ui.pauseLookup.addEventListener('change', () =>
  settings.set('pauseLookup', ui.pauseLookup.checked ? '1' : '0'),
);
ui.subLang.addEventListener('change', () => settings.set('subLang', ui.subLang.value));
ui.lang.addEventListener('change', () => {
  settings.set('lang', ui.lang.value);
  loadRtl();
  void readBook();
});
ui.forceOcr.addEventListener('change', () => {
  settings.set('forceOcr', ui.forceOcr.checked ? '1' : '0');
  void readBook();
});

/** Shows a command that failed in the strip. */
function sayError(err: unknown): void {
  say(errorMessage(err, isAndroid));
}

// --- The PDF ---

ui.openPdf.addEventListener('click', () => ui.pdfFile.click());

ui.pdfFile.addEventListener('change', () => {
  const file = ui.pdfFile.files?.[0];
  // The same file can be picked again.
  ui.pdfFile.value = '';
  if (!file) return;
  drawer.closeOnPhone();
  void openBook(file);
});

/** The count of attempts to open a book, and the attempt of the book that is open. */
const opens = { tried: 0, shown: 0 };

/**
 * Opens `file` as the book. The book that is open stays until the new
 * file loads: a file that is not a PDF, or is damaged, changes nothing.
 *
 * `meta` is what the reader keeps for the book, when the caller has it:
 * the book opens at its page. Else the meta data comes from IndexedDB
 * after the open. The page shows and the reading starts at once, and the
 * meta data applies when it comes: an upgrade of the database can hold
 * IndexedDB for many seconds. Gives true when the new book is open.
 */
async function openBook(file: File, meta?: BookMeta): Promise<boolean> {
  if (file.size === 0) {
    say(EMPTY_FILE_TEXT);
    return false;
  }
  const attempt = ++opens.tried;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    // The copy of the last book is gone, for example after the storage was cleared.
    say(meta ? LAST_BOOK_GONE_TEXT : `Cannot read ${file.name}: ${String(err)}`);
    return false;
  }
  let pdf: PdfDoc;
  try {
    // pdf.js loads with the first PDF, so the start card shows sooner.
    const { loadPdf } = await import('./pdf');
    pdf = await loadPdf(bytes);
  } catch (err) {
    say(pdfOpenText(err));
    return false;
  }
  // A file that the user picked later is open already.
  if (attempt < opens.shown) {
    void pdf.destroy();
    return false;
  }
  opens.shown = attempt;
  const key = bookKey(file);
  // The page of the book before goes to its meta data now.
  flushPageSave();
  const old = state.pdf;
  state.pdf = pdf;
  state.file = file;
  state.book = key;
  state.pages = [];
  state.tokens = [];
  state.spans = [];
  state.cueParts = [];
  state.activeCue = -1;
  state.markedCue = -1;
  state.held = false;
  // The subtitles of another book go at once. Subtitles that were loaded
  // while no book was open wait for the meta data of this book.
  if (state.subtitles && state.subtitlesBook !== null && state.subtitlesBook !== key) {
    clearSubtitles();
  }
  const subtitlesSeq = state.subtitlesSeq;
  ui.makeSubs.disabled = false;
  ui.empty.hidden = true;
  ui.page.hidden = false;
  if (state.clock) showPlayerStatus(state.clock);
  say(pdfLoadedText(pdf.numPages));
  // showPage sets the current page at once, so the reading starts there.
  void showPage(validPage(meta?.page, pdf.numPages) ?? 0);
  // readBook stops the reading of the old book before its document closes.
  void readBook();
  void old?.destroy();
  showSrtRow();
  if (meta) {
    applyMeta(meta, attempt, subtitlesSeq);
  } else {
    void putLastBook(file);
    void getMeta(key).then((m) => applyMeta(m, attempt, subtitlesSeq));
  }
  return true;
}

/** `page` when it is a page of a book of `pages` pages, else undefined. */
function validPage(page: number | undefined, pages: number): number | undefined {
  return page !== undefined && Number.isInteger(page) && page >= 0 && page < pages
    ? page
    : undefined;
}

/**
 * Applies the meta data of the book that open attempt `attempt` opened.
 * `subtitlesSeq` is the count of subtitle loads at the open: subtitles
 * that the user loaded after the open stay. The page applies only while
 * the first page shows, so a page turn after the open stays.
 */
function applyMeta(meta: BookMeta, attempt: number, subtitlesSeq: number): void {
  const key = state.book;
  const pdf = state.pdf;
  if (attempt !== opens.shown || key === null || !pdf) return;
  const page = validPage(meta.page, pdf.numPages);
  if (page !== undefined && page !== state.currentPage && state.currentPage === 0) {
    void showPage(page);
  }
  if (state.subtitlesSeq !== subtitlesSeq) return;
  const loaded = state.subtitles ? state.subtitlesBook : undefined;
  switch (subtitlesOnOpen(loaded, key, meta.subtitles !== undefined)) {
    case 'keep':
      if (state.subtitles) {
        state.subtitlesBook = key;
        void putMeta(key, { subtitles: state.subtitles });
      }
      break;
    case 'load':
      if (meta.subtitles) loadSubtitles(meta.subtitles, { save: false });
      break;
    case 'clear':
      clearSubtitles();
      break;
  }
}

// --- The page of the book, in its meta data ---

/** The page that goes to the meta data of its book after PAGE_SAVE_MS. */
let pageSave: { book: string; page: number; timer: ReturnType<typeof setTimeout> } | null = null;

/** Keeps the current page for the book, after PAGE_SAVE_MS without another page change. */
function savePageSoon(): void {
  const book = state.book;
  if (book === null) return;
  if (pageSave) clearTimeout(pageSave.timer);
  pageSave = { book, page: state.currentPage, timer: setTimeout(flushPageSave, PAGE_SAVE_MS) };
}

/** Keeps the page that waits now. */
function flushPageSave(): void {
  const save = pageSave;
  if (!save) return;
  pageSave = null;
  clearTimeout(save.timer);
  void putMeta(save.book, { page: save.page });
}

// A reload or a closed tab does not lose the last page turn.
window.addEventListener('pagehide', flushPageSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushPageSave();
});

// --- The last book ---

/** Shows the start card, while no book is open. */
function showStart(): void {
  if (!state.pdf) ui.empty.hidden = false;
}

/**
 * Opens the last book at its page, with its subtitles. Android stops the
 * reader while the user is in the dictionary or in the player app, and a
 * reload forgets the file that the user opened.
 */
async function restoreLastBook(): Promise<void> {
  const file = await getLastBook();
  // The user opened a book while the database was busy.
  if (state.pdf) return;
  if (!file) {
    showStart();
    return;
  }
  const meta = await getMeta(bookKey(file));
  if (state.pdf) return;
  if (await openBook(file, meta)) return;
  // The copy cannot be read, or it is no PDF now: forget it.
  await clearLastBook();
  showStart();
}

/**
 * The first open of the database after an upgrade can take many seconds.
 * The strip tells so after SLOW_DB_MS, and the start card shows, so that
 * the user can open a book.
 */
function watchDb(): void {
  let open = false;
  const timer = setTimeout(() => {
    if (open) return;
    state.dbSlow = true;
    showReadingPart();
    showStart();
  }, SLOW_DB_MS);
  void dbReady().then(() => {
    open = true;
    clearTimeout(timer);
    if (!state.dbSlow) return;
    state.dbSlow = false;
    showReadingPart();
  });
}

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
  state.cueParts = [];
  state.markedCue = -1;
  const total = pdf.numPages;
  const pending = new Set(Array.from({ length: total }, (_, i) => i));
  const counts = { text: 0, ocr: 0 };
  const read = (): number => counts.text + counts.ocr;
  /** The page that is read now. */
  let page = -1;
  const onOcrProgress = (p: number): void => {
    if (seq === state.readSeq) {
      setReading(readingText(read(), total, `page ${page + 1}: OCR ${Math.round(p * 100)}%`));
    }
  };
  // The OCR worker, and tesseract.js itself, load on the first page that needs them.
  const ocr: { started?: Promise<Ocr> } = {};
  const getOcr = (): Promise<Ocr> => {
    const lang = ui.lang.value;
    ocr.started ??= import('./ocr').then(({ createOcr }) => createOcr(lang, onOcrProgress));
    return ocr.started;
  };
  try {
    while (pending.size > 0) {
      page = nextPage(pending, state.currentPage);
      pending.delete(page);
      setReading(readingText(read(), total, `page ${page + 1}`));
      const entry = await readPage(pdf, file, page, getOcr);
      if (seq !== state.readSeq) return; // Another book or another setting took over.
      counts[entry.source]++;
      state.pages[page] = entry;
      // Put the tokens of the page at their place in page order.
      const at = state.pages.slice(0, page).reduce((n, p) => n + (p?.tokens.length ?? 0), 0);
      state.tokens.splice(at, 0, ...entry.tokens);
      const how = entry.source === 'text' ? 'text layer' : 'OCR';
      setReading(readingText(read(), total, `page ${page + 1}: ${how}`));
      if (page === state.currentPage) view.mark();
      scheduleAlign();
    }
    const matched = align();
    say(
      pagesReadText(counts) +
        (matched === null ? '' : ` ${matchedText(matched, state.cues.length, true)}`),
    );
  } catch (err) {
    if (seq === state.readSeq) say(`Cannot read the pages: ${String(err)}`);
  } finally {
    if (ocr.started) await (await ocr.started).terminate().catch(() => undefined);
    if (seq === state.readSeq) setReading(null);
  }
}

/** Shows the reading part of the strip: the database notice, else the reading of the pages. */
function showReadingPart(): void {
  showReading(state.dbSlow ? UPDATING_CACHE_TEXT : state.reading);
}

function setReading(m: Message | string | null): void {
  state.reading = m;
  showReadingPart();
}

/** True when every page of the book is read. */
function allPagesRead(): boolean {
  const pdf = state.pdf;
  return !!pdf && state.pages.filter((p) => p).length === pdf.numPages;
}

ui.clearCache.addEventListener('click', async () => {
  await clearPages();
  say('Page cache cleared.');
});

// --- Subtitles ---

/**
 * Loads subtitles from a file, from SubRead or from the meta data of the
 * book. They belong to the open book, or to the book that opens next.
 *
 * - `from` names where they came from in the message.
 * - `cues` are the cues of the text, when the caller parsed them already.
 * - `save` keeps them in the meta data of the open book. The default is
 *   true: each file and each SubRead result is kept.
 */
function loadSubtitles(
  subtitles: BookSubtitles,
  opts: { from?: string; cues?: Cue[]; save?: boolean } = {},
): void {
  const cues = opts.cues ?? parseSubtitles(subtitles.text);
  state.cues = cues;
  state.aligner = createAligner(cues.map((c) => c.text));
  state.subtitles = subtitles;
  state.subtitlesBook = state.book;
  state.subtitlesSeq++;
  if (opts.save !== false && state.book !== null) void putMeta(state.book, { subtitles });
  state.spans = [];
  state.cueParts = [];
  state.activeCue = -1;
  state.markedCue = -1;
  updateSyncPage();
  renderCueList();
  const matched = align();
  say(
    `${cues.length} cues loaded from ${opts.from ?? subtitles.name}.` +
      (matched === null ? '' : ` ${matchedText(matched, cues.length, allPagesRead())}`),
  );
  showSrtRow();
}

/** Removes the subtitles: the cues, the cue list, the mark, the .srt row. */
function clearSubtitles(): void {
  state.cues = [];
  state.aligner = null;
  state.subtitles = null;
  state.subtitlesBook = null;
  state.spans = [];
  state.cueParts = [];
  state.activeCue = -1;
  state.markedCue = -1;
  updateSyncPage();
  renderCueList();
  showSrtRow();
  view.mark();
  // The Follow button goes: with no cues there is no page to follow.
  runFollow('realign');
}

// A browser download of an .srt often has the type application/octet-stream,
// and a type filter makes such a file grey in the Android picker. So the
// field takes each file, and the parser decides.
ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  // The same file can be picked again.
  ui.subFile.value = '';
  if (!file) return;
  drawer.closeOnPhone();
  if (file.size === 0) {
    say(EMPTY_FILE_TEXT);
    return;
  }
  let text: string;
  try {
    text = decodeSubtitles(await file.arrayBuffer());
  } catch (err) {
    say(`Cannot read ${file.name}: ${String(err)}`);
    return;
  }
  // A file with no cues, for example a PDF, keeps the cues that are loaded.
  const cues = parseSubtitles(text);
  if (cues.length === 0) {
    say(noCuesText(file.name));
    return;
  }
  loadSubtitles({ name: file.name, text, source: 'file' }, { cues });
});

/**
 * The .srt row shows for subtitles that SubRead made: a download on the
 * web, the share sheet on Android. A file that the user loaded is on the
 * device already.
 */
function showSrtRow(): void {
  const subtitles = state.subtitles;
  ui.srtRow.hidden = subtitles?.source !== 'subread';
  if (!subtitles || ui.srtRow.hidden) return;
  const { name, text } = subtitles;
  ui.srtDownload.hidden = isAndroid;
  ui.srtShare.hidden = !isAndroid;
  if (!isAndroid) {
    URL.revokeObjectURL(ui.srtDownload.href);
    ui.srtDownload.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    ui.srtDownload.download = name;
  }
  ui.srtShare.onclick = () => {
    SubRead.shareText({ name, text }).catch(sayError);
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
  // The subtitles are for the book of the job, not for a book that opened since.
  if (state.file !== file) return;
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
  loadSubtitles(
    { name: srtName(file.name), text: result.srt, source: 'subread' },
    { from: 'SubRead' },
  );
});

// --- Alignment ---

function scheduleAlign(): void {
  if (state.alignTimer) clearTimeout(state.alignTimer);
  state.alignTimer = setTimeout(align, ALIGN_DEBOUNCE);
}

/**
 * Align the cues to the pages read so far. Gives the count of matched
 * cues, or null when there is nothing to align.
 */
function align(): number | null {
  if (state.alignTimer) clearTimeout(state.alignTimer);
  state.alignTimer = null;
  if (!state.aligner || state.cues.length === 0 || state.tokens.length === 0) return null;
  state.spans = state.aligner.spans(state.pages.map((p) => p?.tokens));
  state.cueParts = cueParts(state.tokens, state.spans);
  renderCueList();
  view.mark();
  // The cue of now can have a new page. A new alignment is no seek, so a
  // page that the user turned to stays.
  runFollow('realign');
  return state.cueParts.filter((parts) => parts.length > 0).length;
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
      li.addEventListener('click', () => {
        drawer.closeOnPhone();
        seek(cue.start * 1000);
      });
      return li;
    }),
  );
  scrollCueList(state.activeCue);
}

function markCueInList(i: number): void {
  ui.cues.querySelector('.active')?.classList.remove('active');
  ui.cues.children[i]?.classList.add('active');
  scrollCueList(i);
}

/**
 * Scrolls the cue list so that cue `i` shows, while the list shows. Only
 * the list scrolls: scrollIntoView also scrolled the menu, and the
 * settings went out of view.
 */
function scrollCueList(i: number): void {
  const item = ui.cues.children[i];
  if (!(item instanceof HTMLElement) || !drawer.shows()) return;
  const list = ui.cues;
  const mark = { top: item.offsetTop, bottom: item.offsetTop + item.offsetHeight };
  const shown = { top: list.scrollTop, height: list.clientHeight };
  const top = scrollTarget(mark, shown, list.scrollHeight - list.clientHeight);
  if (top !== null) list.scrollTop = top;
}

// --- The follow ---

function showPlayerStatus(s: ClockState): void {
  ui.play.disabled = s.error === 'no_overlay' || (!isAndroid && s.error === 'no_player');
  ui.play.classList.toggle('playing', s.playing);
  const action = s.playing ? 'Pause' : 'Play';
  if (ui.play.title !== action) {
    ui.play.title = action;
    ui.play.setAttribute('aria-label', action);
  }
  // Before a PDF is open, the start card tells what to do first.
  showPlayer(state.pdf ? playerMessage(s, isAndroid) : null);
  updateSyncPage();
}

/** "Move the audio to this page" needs cues and a player with a position. */
function updateSyncPage(): void {
  const s = state.clock;
  ui.syncPage.disabled = state.cues.length === 0 || !s || s.positionMs === null || s.error !== null;
}

/**
 * The follow for the last state of the clock: mark the cue of now, and
 * turn to the page of the audio unless the follow is held. In the silence
 * between two cues, the cue before stays the cue of now. In a cue on two
 * pages, the page follows the time.
 */
function runFollow(event: FollowEvent): void {
  const s = state.clock;
  const t = s?.positionMs == null ? null : s.positionMs / 1000;
  const cue = t === null ? -1 : lastCueAt(state.cues, t);
  if (cue !== state.activeCue) {
    markCueInList(cue);
    state.activeCue = cue;
  }
  const mode = followMode();
  const page =
    t === null || cue < 0 ? null : audioPage(state.cueParts, cue, cueProgress(state.cues[cue]!, t));
  const out = follow({
    mode,
    currentPage: state.currentPage,
    cue,
    matched: (state.cueParts[cue]?.length ?? 0) > 0,
    page,
    held: state.held,
    event,
  });
  state.held = out.held;
  // The Follow button shows only when it has a page to go to.
  const paused = out.held && mode !== 'off' && page !== null;
  ui.followNow.hidden = !paused;
  ui.followNote.hidden = !paused;
  const marked = out.highlightCue ?? -1;
  const markMoved = marked !== state.markedCue;
  state.markedCue = marked;
  if (out.turnToPage !== null) void showPage(out.turnToPage);
  else if (markMoved) view.mark();
}

/** One state of the clock. A jump of the audio is a seek. */
function applyClock(s: ClockState): void {
  state.clock = s;
  showPlayerStatus(s);
  runFollow(s.seeked ? 'seek' : 'tick');
}

/** A page turn by the user. It holds the follow, until the audio reaches the page. */
function turnByUser(index: number): void {
  state.held = true;
  void showPage(index);
  runFollow('tick');
}

/** Moves the audio from this app. The follow is not held after it. */
function seek(ms: number): void {
  clock.seek(ms).then(() => {
    state.held = false;
    say(`Audio moved to ${clockText(ms)}.`);
  }, sayError);
}

const clock: ClockSource = isAndroid ? new OverlayClock(SubRead) : new LocalAudioClock(ui.audio);
clock.start(applyClock);

ui.play.addEventListener('click', () => {
  const action = state.clock?.playing ? clock.pause() : clock.play();
  action.catch(sayError);
});

ui.followNow.addEventListener('click', () => runFollow('follow'));

// The audio goes to where the text of the page starts, also inside a cue
// that starts on the page before.
ui.syncPage.addEventListener('click', () => {
  const t = pageStartTime(state.cueParts, state.cues, state.currentPage);
  if (t === null) {
    say('No cue of the subtitles is on this page.');
    return;
  }
  seek(t * 1000);
});

ui.audioFile.addEventListener('change', () => {
  const file = ui.audioFile.files?.[0];
  if (!file) return;
  ui.audio.src = URL.createObjectURL(file);
});

// --- Page view ---

/** The mark of page `index`: one box per text line of the marked cue. */
function marks(index: number): Marks | null {
  const entry = state.pages[index];
  const span = state.spans[state.markedCue];
  if (!entry || !span) return null;
  return {
    width: entry.width,
    height: entry.height,
    boxes: (pad) => lineBoxes(state.tokens, span, index).map((box) => padBox(box, pad)),
  };
}

async function showPage(index: number): Promise<void> {
  const pdf = state.pdf;
  if (!pdf || index < 0 || index >= pdf.numPages) return;
  state.currentPage = index;
  nav.update();
  savePageSoon();
  try {
    await view.show(pdf, index);
  } catch (err) {
    // A render of a book that closed meanwhile fails. That is no error.
    if (state.pdf === pdf) sayError(err);
  }
}

// --- Tap on a word ---

/** Tap on the page: send the text under the tap to the dictionary. */
ui.page.addEventListener('click', (e) => {
  const canvas = ui.page.querySelector('canvas');
  const pdf = state.pdf;
  if (!canvas || !pdf) return;
  const size = state.pages[state.currentPage];
  if (!size) {
    say(notReadText(state.pages.filter((p) => p).length, pdf.numPages));
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * size.width;
  const y = ((e.clientY - rect.top) / rect.height) * size.height;
  const zoom = window.visualViewport?.scale ?? 1;
  const t = tokenAt(
    state.tokens,
    state.currentPage,
    x,
    y,
    tapTolerance(size.width, rect.width, zoom),
  );
  if (t < 0) return;
  const text = lookupText(state.tokens, t);
  // A tap on punctuation only gives no text.
  if (text === '') return;
  void (isAndroid ? lookUp(text) : copy(text));
});

/** The web has no dictionary app: the text goes to the clipboard. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied: "${text}"`);
  } catch {
    say(`Copy failed: "${text}"`);
  }
}

/**
 * Sends the text to the dictionary app. With "Pause on lookup", the
 * player pauses first and plays again when the dictionary closes. When
 * the pause fails, the lookup still runs.
 */
async function lookUp(text: string): Promise<void> {
  say(`Lookup: "${text}"`);
  const pause = ui.pauseLookup.checked && state.clock?.playing === true && !state.lookupPaused;
  let paused = false;
  if (pause) {
    state.lookupPaused = true;
    try {
      await clock.pause();
      paused = true;
    } catch (err) {
      sayError(err);
    }
  }
  // Play again when the dictionary closed, or when it did not open.
  let resume = true;
  try {
    ({ closed: resume } = await SubRead.lookup({ text }));
  } catch (err) {
    say(`Lookup failed: ${String(err)}`);
  }
  try {
    if (paused && resume) await clock.play();
  } catch (err) {
    sayError(err);
  } finally {
    if (pause) state.lookupPaused = false;
  }
}

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
  SubRead.setDictionary({ component: ui.dict.value }).catch(sayError);
});

// --- Start ---

loadSettings();
ui.make.hidden = !isAndroid;
ui.audioRow.hidden = isAndroid;
// The web copies a lookup at once: there is no dictionary app to choose or to wait for.
ui.dictRow.hidden = !isAndroid;
ui.pauseRow.hidden = !isAndroid;
if (isAndroid) void loadDictionaries().catch(sayError);
watchDb();
void restoreLastBook();
