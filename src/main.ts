// UI wiring: the state of the book, the subtitles and the follow. The
// logic lives in the pure modules (align.ts, cue-pages.ts, follower.ts,
// hit-test.ts, line-boxes.ts, messages.ts, paging.ts, read-order.ts,
// scroll.ts, text-layer.ts, player-state.ts, play-clock.ts). The UI parts
// are in drawer.ts (the menu), nav.ts (page turns by the user), status.ts
// (the strip) and view.ts (the page).

import { App } from '@capacitor/app';
import { createAligner, shiftSpans, type Aligner, type OcrToken, type TokenSpan } from './align';
import { ankiCard, cardSource } from './anki-card';
import { backStep, keepScreenOn } from './app-state';
import {
  beginOpen,
  createOpens,
  endOpen,
  failureShows,
  subtitlesOwner,
  userOpened,
} from './book-open';
import {
  keepMakeStatus,
  resultName,
  srtName,
  subreadConcerns,
  subtitlesOnOpen,
} from './book-subtitles';
import { bookText } from './book-text';
import { LocalAudioClock, OverlayClock, type ClockSource, type ClockState } from './clock-source';
import { audioPage, cueParts, cueProgress, pageStartTime, type CueParts } from './cue-pages';
import { setupDrawer } from './drawer';
import { follow, type FollowEvent, type FollowMode } from './follower';
import { lookupText, tapTolerance, tokenAt } from './hit-test';
import { lineBoxes, padBox } from './line-boxes';
import {
  ANKI_WEB_TEXT,
  ankiText,
  CLEAR_ALL_QUESTION,
  clearBookQuestion,
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
  playerCommandsOff,
  playerMessage,
  readingEndMessage,
  readingText,
  shownInPlayerPart,
  SUBREAD_NOT_INSTALLED,
  subreadErrorText,
  subreadQuestion,
  subreadResultText,
  UPDATING_CACHE_TEXT,
  waitPagesText,
  withForceOcr,
  type Message,
} from './messages';
import { setupNav } from './nav';
import { createOcrJob, OcrStartError, pageTimeLimit, type OcrJob } from './ocr-job';
import { defaultRtl } from './paging';
import type { PdfDoc } from './pdf';
import { nextPage } from './read-order';
import { scrollTarget } from './scroll';
import { fill, onAction, say, showPlayer, showReading } from './status';
import { isAndroid, SubRead, type AnkiCard, type SubtitlesResult, type SuiteApps } from './subread';
import { suiteChecklist } from './suite';
import { decodeSubtitles, lastCueAt, parseSubtitles, type Cue } from './subtitles';
import {
  bookKey,
  bookName,
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
  clearBook: el<HTMLButtonElement>('clear-book'),
  clearAll: el<HTMLButtonElement>('clear-all'),
  suite: el<HTMLElement>('suite'),
  suiteList: el<HTMLUListElement>('suite-list'),
  suiteChecklist: el<HTMLDivElement>('suite-checklist'),
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
  /** "Force OCR" of the open book: the reading skips the text layer. */
  forceOcr: false,
  /** A SubRead job that waits until all pages of its book are read. */
  makeWait: null as { audio: { uri: string; name: string }; book: string } | null,
  /** The book of the SubRead job that runs, or null. */
  making: null as string | null,
  /** True while the player waits for a dictionary lookup that this app paused. */
  lookupPaused: false,
  /** False while the app is in the background. */
  active: true,
  /** True while the plugin keeps the screen on. */
  awake: false,
  /** The apps of the SubRead suite on the device, or null before the first answer. */
  suite: null as SuiteApps | null,
  /** The player error that the checklist shows. Undefined before the first player state. */
  suiteError: undefined as string | null | undefined,
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
  longPress,
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

// A new follow mode follows the audio at once. "Off" lets the screen turn off.
ui.follow.addEventListener('change', () => {
  settings.set('follow', followMode());
  runFollow('follow');
  updateAwake();
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
// Force OCR is a setting of the book. As a global setting it sent each
// later text PDF through the slow OCR.
ui.forceOcr.addEventListener('change', () => {
  const book = state.book;
  if (book === null) return;
  setForceOcr(ui.forceOcr.checked);
  void putMeta(book, { forceOcr: state.forceOcr });
  void readBook();
});

/** Sets Force OCR of the open book: the state, the checkbox and the strip. */
function setForceOcr(on: boolean): void {
  state.forceOcr = on;
  ui.forceOcr.checked = on;
  showReadingPart();
}

/**
 * Shows a command that failed in the strip. The player part shows the
 * problem of the player while a book is open, so the event part does not
 * say it again.
 */
function sayError(err: unknown): void {
  if (state.pdf && shownInPlayerPart(err, state.clock?.error)) return;
  say(errorMessage(err, isAndroid, overlayInstalled()));
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

/** The attempts to open a book, and the attempt of the book that is open. */
const opens = createOpens();

/** The restore of the last book: its meta data, and opens.byUser when the restore started. */
interface Restore {
  meta: BookMeta;
  since: number;
}

/**
 * Opens `file` as the book. The book that is open stays until the new
 * file loads: a file that is not a PDF, or is damaged, changes nothing.
 *
 * `restore` comes from the restore of the last book: the book opens at the
 * page of its meta data. An open without it is a file that the user
 * picked, and its meta data comes from IndexedDB after the open. The page
 * shows and the reading starts at once, and the meta data applies when it
 * comes: an upgrade of the database can hold IndexedDB for many seconds.
 * Gives true when the new book is open.
 */
async function openBook(file: File, restore?: Restore): Promise<boolean> {
  const meta = restore?.meta;
  const attempt = beginOpen(opens, restore === undefined);
  /** Ends the attempt that failed. The strip shows `text` only when failureShows allows it. */
  const fail = (text: string): false => {
    endOpen(opens, attempt, false);
    claimSubtitles();
    if (failureShows(opens, attempt, restore?.since)) say(text);
    return false;
  };
  if (file.size === 0) return fail(EMPTY_FILE_TEXT);
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    // The copy of the last book is gone, for example after the storage was cleared.
    return fail(restore ? LAST_BOOK_GONE_TEXT : `Cannot read ${file.name}: ${String(err)}`);
  }
  let pdf: PdfDoc;
  try {
    // pdf.js loads with the first PDF, so the start card shows sooner.
    const { loadPdf } = await import('./pdf');
    pdf = await loadPdf(bytes);
  } catch (err) {
    return fail(pdfOpenText(err));
  }
  // A file that the user picked later is open already.
  if (!endOpen(opens, attempt, true)) {
    void pdf.destroy();
    claimSubtitles();
    return false;
  }
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
  // The subtitles of another book go at once. Subtitles of no book, loaded
  // while no book was open or while this book loaded, are for this book.
  if (state.subtitles && state.subtitlesBook !== null && state.subtitlesBook !== key) {
    clearSubtitles();
  }
  claimSubtitles();
  const subtitlesSeq = state.subtitlesSeq;
  // The SubRead status of the book before goes, unless a job runs.
  if (!keepMakeStatus(key, state.making, state.makeWait?.book ?? null)) {
    ui.makeStatus.textContent = '';
  }
  // A SubRead job that waits for the pages of another book does not start.
  if (state.makeWait && state.makeWait.book !== key) state.makeWait = null;
  setForceOcr(meta?.forceOcr ?? false);
  ui.forceOcr.disabled = false;
  ui.clearBook.disabled = false;
  // One SubRead job at a time.
  ui.makeSubs.disabled = state.making !== null;
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
  const forceOcr = meta.forceOcr ?? false;
  if (forceOcr !== state.forceOcr) {
    setForceOcr(forceOcr);
    void readBook();
  }
  if (state.subtitlesSeq === subtitlesSeq) {
    const loaded = state.subtitles ? state.subtitlesBook : undefined;
    switch (subtitlesOnOpen(loaded, key, meta.subtitles !== undefined)) {
      case 'keep':
        claimSubtitles();
        break;
      case 'load':
        if (meta.subtitles) loadSubtitles(meta.subtitles, { book: key, save: false });
        break;
      case 'clear':
        clearSubtitles();
        break;
    }
  }
  // After the saved subtitles: a SubRead result for a book with a file of
  // the user asks first.
  void checkPendingSubtitles();
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
 *
 * A book that the user opens while the restore waits for the database
 * wins, also while it still loads (userOpened).
 */
async function restoreLastBook(): Promise<void> {
  const since = opens.byUser;
  const file = await getLastBook();
  if (!file || userOpened(opens, since)) {
    showStart();
    return;
  }
  const meta = await getMeta(bookKey(file));
  if (userOpened(opens, since)) {
    showStart();
    return;
  }
  if (await openBook(file, { meta, since })) return;
  // The copy cannot be read, or it is no PDF now: forget it. After an open
  // by the user, the copy can be of the user's book, so it stays.
  if (!userOpened(opens, since)) await clearLastBook(bookKey(file));
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

/**
 * The tokens of one page: from the cache, else the text layer, else OCR.
 * `force` skips the text layer. Rejects with OcrStartError when the page
 * needs OCR and OCR cannot start or its start takes too long, and with
 * OcrTimeoutError when the OCR of the page takes too long.
 */
async function readPage(
  pdf: PdfDoc,
  file: File,
  page: number,
  lang: string,
  force: boolean,
  ocr: OcrJob<HTMLCanvasElement>,
): Promise<PageEntry> {
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
  // OCR starts before the render: when it cannot start, no page is rendered for nothing.
  await ocr.start();
  const canvas = await pdf.renderPage(page, OCR_WIDTH);
  const tokens = await ocr.recognize(canvas, page, pageTimeLimit(canvas.width * canvas.height));
  const entry: PageEntry = { tokens, width: canvas.width, height: canvas.height, source: 'ocr' };
  await putPage(pageKey(file, page, lang, 'ocr'), entry);
  return entry;
}

/** The OCR of the reading that runs now. */
let readingOcr: OcrJob<HTMLCanvasElement> | undefined;

/**
 * Reads every page of the book: the current page first, then the pages
 * after it, then the pages before it. The cues are aligned again as pages
 * finish, so the follow starts before the whole book is read.
 *
 * A page that cannot be read does not stop the other pages. At the end the
 * strip tells how many pages could not be read, with Retry. `retry` reads
 * only the pages that are not read.
 */
async function readBook(retry = false): Promise<void> {
  const { pdf, file } = state;
  if (!pdf || !file) return;
  const seq = ++state.readSeq;
  // The OCR of the reading before stops at once. It does not finish its
  // page: two quick changes of a setting ran two OCR jobs at the same time.
  readingOcr?.stop();
  if (!retry) {
    state.pages = [];
    state.tokens = [];
    // The spans index the old tokens, so they go too.
    state.spans = [];
    state.cueParts = [];
    state.markedCue = -1;
  }
  const total = pdf.numPages;
  const pending = new Set(
    Array.from({ length: total }, (_, i) => i).filter((i) => !state.pages[i]),
  );
  const counts = { text: 0, ocr: 0 };
  for (const entry of state.pages) if (entry) counts[entry.source]++;
  const read = (): number => counts.text + counts.ocr;
  let failed = 0;
  let startFailed = false;
  const lang = ui.lang.value;
  const force = state.forceOcr;
  /** The page that is read now. */
  let page = -1;
  const onOcrProgress = (p: number): void => {
    if (seq === state.readSeq) {
      setReading(readingText(read(), total, `page ${page + 1}: OCR ${Math.round(p * 100)}%`));
    }
  };
  // The OCR worker, and tesseract.js itself, load on the first page that
  // needs them. After a page that fails or takes too long, the job stops
  // the worker, and the next page starts a new one. A start that takes too
  // long gives each page the start error, and the strip shows Retry.
  const ocr = createOcrJob<HTMLCanvasElement>((signal) =>
    import('./ocr').then(
      ({ createOcr }) => createOcr(lang, onOcrProgress, signal),
      (err: unknown) => {
        throw new OcrStartError(err);
      },
    ),
  );
  readingOcr = ocr;
  try {
    while (pending.size > 0) {
      page = nextPage(pending, state.currentPage);
      pending.delete(page);
      setReading(readingText(read(), total, `page ${page + 1}`));
      let entry: PageEntry;
      try {
        entry = await readPage(pdf, file, page, lang, force, ocr);
      } catch (err) {
        if (seq !== state.readSeq) return; // Another book or another setting took over.
        failed++;
        // Each page that needs OCR gives the same start error. Tell it once.
        if (err instanceof OcrStartError) {
          if (!startFailed) console.warn(err);
          startFailed = true;
        } else {
          console.warn(`Page ${page + 1} could not be read.`, err);
        }
        continue;
      }
      if (seq !== state.readSeq) return; // Another book or another setting took over.
      counts[entry.source]++;
      state.pages[page] = entry;
      // Put the tokens of the page at their place in page order. The spans
      // keep their tokens until the next alignment: the mark and the Anki
      // card use them.
      const at = state.pages.slice(0, page).reduce((n, p) => n + (p?.tokens.length ?? 0), 0);
      state.tokens.splice(at, 0, ...entry.tokens);
      state.spans = shiftSpans(state.spans, at, entry.tokens.length);
      const how = entry.source === 'text' ? 'text layer' : 'OCR';
      setReading(readingText(read(), total, `page ${page + 1}: ${how}`));
      if (page === state.currentPage) view.mark();
      scheduleAlign();
      startMakeWhenRead();
    }
    const matched = align();
    say(
      pagesReadText(counts) +
        (matched === null ? '' : ` ${matchedText(matched, state.cues.length, failed === 0)}`),
    );
  } catch (err) {
    if (seq === state.readSeq) say(`Cannot read the pages: ${String(err)}`);
  } finally {
    ocr.stop();
    if (seq === state.readSeq) setReading(readingEndMessage(failed, startFailed));
  }
}

/**
 * Shows the reading part of the strip: the database notice, else the
 * reading of the pages, with the note while Force OCR is on.
 */
function showReadingPart(): void {
  if (state.dbSlow) {
    showReading(UPDATING_CACHE_TEXT);
    return;
  }
  const m = typeof state.reading === 'string' ? { text: state.reading } : state.reading;
  showReading(withForceOcr(m, state.forceOcr && state.book !== null));
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

// The pages of other books cost hours of OCR, so each clear asks first.
ui.clearBook.addEventListener('click', async () => {
  const { book, file } = state;
  if (book === null || !file || !confirm(clearBookQuestion(file.name))) return;
  await clearPages(book);
  say(`The saved pages of ${file.name} are removed.`);
});

ui.clearAll.addEventListener('click', async () => {
  if (!confirm(CLEAR_ALL_QUESTION)) return;
  await clearPages();
  say('The saved pages of all books are removed.');
});

// --- Subtitles ---

/**
 * Loads subtitles from a file, from SubRead or from the meta data of the
 * book.
 *
 * - `book` is the book that they belong to. Null: no book yet, and the
 *   book that shows when no open loads gets them (claimSubtitles).
 * - `from` names where they came from in the message.
 * - `cues` are the cues of the text, when the caller parsed them already.
 * - `save` keeps them in the meta data of `book`. The default is true:
 *   each file and each SubRead result is kept.
 */
function loadSubtitles(
  subtitles: BookSubtitles,
  opts: { book: string | null; from?: string; cues?: Cue[]; save?: boolean },
): void {
  const cues = opts.cues ?? parseSubtitles(subtitles.text);
  state.cues = cues;
  state.aligner = createAligner(cues.map((c) => c.text));
  state.subtitles = subtitles;
  state.subtitlesBook = opts.book;
  state.subtitlesSeq++;
  if (opts.save !== false && opts.book !== null) void putMeta(opts.book, { subtitles });
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

/**
 * Gives subtitles of no book to the book that shows, and keeps them in its
 * meta data. While an open loads that can replace that book, the subtitles
 * wait (subtitlesOwner). Each end of an open, and the meta data of the new
 * book, call this again.
 */
function claimSubtitles(): void {
  const book = subtitlesOwner(opens, state.book);
  if (!state.subtitles || state.subtitlesBook !== null || book === null) return;
  state.subtitlesBook = book;
  void putMeta(book, { subtitles: state.subtitles });
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
  // During the open of another book, the file is for the book that shows next.
  const book = subtitlesOwner(opens, state.book);
  loadSubtitles({ name: file.name, text, source: 'file' }, { book, cues });
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

// SubRead makes the subtitles from the audio and the text of the book. It
// starts when all pages are read: with part of the text, the subtitles
// cover only part of the book.
ui.makeSubs.addEventListener('click', async () => {
  const book = state.book;
  if (book === null) return;
  let audio: { uri: string; name: string };
  try {
    audio = await SubRead.pickAudio();
  } catch {
    return;
  }
  if (state.book !== book) return;
  state.makeWait = { audio, book };
  startMakeWhenRead();
});

/**
 * Starts the SubRead job that waits, when all pages of its book are read.
 * Else tells how far the reading is. readBook calls this after each page.
 */
function startMakeWhenRead(): void {
  const wait = state.makeWait;
  const pdf = state.pdf;
  if (!wait || !pdf || wait.book !== state.book) return;
  if (!allPagesRead()) {
    ui.makeStatus.textContent = waitPagesText(state.pages.filter((p) => p).length, pdf.numPages);
    return;
  }
  state.makeWait = null;
  void makeSubtitles(wait.audio, wait.book);
}

/** Asks SubRead for the subtitles of the book `book`, and loads them after the checks. */
async function makeSubtitles(audio: { uri: string; name: string }, book: string): Promise<void> {
  const name = resultName(book);
  state.making = book;
  ui.makeSubs.disabled = true;
  ui.makeStatus.textContent = `SubRead makes the subtitles for ${audio.name}...`;
  let result: SubtitlesResult;
  try {
    result = await SubRead.makeSubtitles({
      audio: audio.uri,
      bookText: bookText(state.tokens),
      language: ui.subLang.value,
      resultName: name,
    });
  } catch (err) {
    result = { error: String(err) };
  } finally {
    state.making = null;
    ui.makeSubs.disabled = state.book === null;
  }
  // The result file waits for its book: pendingSubtitles loads it when the book opens.
  if (state.book !== book) {
    ui.makeStatus.textContent = 'SubRead finished, but another book is open now.';
    return;
  }
  if (result.error === 'not_installed') {
    fill(ui.makeStatus, SUBREAD_NOT_INSTALLED);
    return;
  }
  // SubRead 0.10 and later also write the .srt into the result file. Read
  // it now, so that the file goes, and use it when the answer has no .srt.
  const copy = await SubRead.pendingSubtitles({ resultName: name }).catch(() => ({}) as PendingSrt);
  const srt = result.srt ?? copy.srt;
  if (srt === undefined) {
    ui.makeStatus.textContent = subreadErrorText(result.error ?? 'no file');
    return;
  }
  if (state.book !== book) {
    void putMeta(book, { subtitles: subreadSubtitles(book, srt) });
    return;
  }
  ui.makeStatus.textContent = subreadResultText(result);
  offerSubreadSubtitles(srt, result);
}

type PendingSrt = { srt?: string };

/** Subtitles that SubRead made for the book `book`. */
function subreadSubtitles(book: string, srt: string): BookSubtitles {
  return { name: srtName(bookName(book)), text: srt, source: 'subread' };
}

/**
 * Loads subtitles that SubRead made for the open book. The user confirms
 * first when they replace a file that the user loaded, or when the
 * language or the match rate of SubRead look wrong (subreadConcerns).
 */
function offerSubreadSubtitles(
  srt: string,
  info: { language?: string | null; matchRate?: number },
): boolean {
  const book = state.book;
  if (book === null) return false;
  const concerns = subreadConcerns({
    requested: ui.subLang.value,
    ocrLang: ui.lang.value,
    language: info.language,
    matchRate: info.matchRate,
    loaded: state.subtitles,
  });
  if (concerns.length > 0 && !confirm(subreadQuestion(concerns))) {
    say('The subtitles of SubRead are not loaded.');
    return false;
  }
  loadSubtitles(subreadSubtitles(book, srt), { book, from: 'SubRead' });
  return true;
}

/**
 * Loads the .srt that SubRead wrote into the result file of the open book.
 * SubRead 0.10 and later write it also when Android stopped the reader
 * during the job; then no answer comes. The reader checks when a book
 * opens and when the app is active again.
 */
async function checkPendingSubtitles(): Promise<void> {
  const book = state.book;
  // During a job the answer of makeSubtitles brings the .srt.
  if (!isAndroid || book === null || state.making !== null) return;
  let pending: PendingSrt;
  try {
    pending = await SubRead.pendingSubtitles({ resultName: resultName(book) });
  } catch {
    return;
  }
  const srt = pending.srt;
  if (srt === undefined) return;
  // The call removed the file, so the .srt goes to the meta data of its book.
  if (state.book !== book) {
    void putMeta(book, { subtitles: subreadSubtitles(book, srt) });
    return;
  }
  if (offerSubreadSubtitles(srt, {})) {
    ui.makeStatus.textContent = 'SubRead finished while the reader was closed.';
  }
}

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
  ui.play.disabled = playerCommandsOff(s.error, isAndroid);
  ui.play.classList.toggle('playing', s.playing);
  const action = s.playing ? 'Pause' : 'Play';
  if (ui.play.title !== action) {
    ui.play.title = action;
    ui.play.setAttribute('aria-label', action);
  }
  // Before a PDF is open, the start card tells what to do first.
  showPlayer(state.pdf ? playerMessage(s, isAndroid, overlayInstalled()) : null);
  updateSyncPage();
  updateAwake();
  // The checklist shows the notification access of the last player state.
  if (s.error !== state.suiteError) renderSuite();
}

/** True when SubRead Overlay, the release or the debug build, is on the device. */
function overlayInstalled(): boolean {
  return state.suite !== null && (state.suite.overlay || state.suite.overlayDebug);
}

/**
 * "Move the audio to this page" needs cues and a player with a position.
 * A player with a problem has no position that counts.
 */
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

// --- The screen and the app state ---

/** Keeps the screen on during read-along (keepScreenOn). Calls the plugin only on a change. */
function updateAwake(): void {
  const on = keepScreenOn({
    active: state.active,
    book: state.pdf !== null,
    playing: state.clock?.playing === true,
    mode: followMode(),
  });
  if (on === state.awake) return;
  state.awake = on;
  SubRead.keepAwake({ on }).catch(() => undefined);
}

/**
 * The app goes to the background or comes back. In the background the
 * clock stops, so no poll of the overlay runs, and the screen may turn
 * off. Back in front, the clock reads the player at once.
 */
function setActive(active: boolean): void {
  if (active === state.active) return;
  state.active = active;
  if (active) {
    clock.start(applyClock);
    if (isAndroid) {
      void checkPendingSubtitles();
      void refreshSuite();
    }
  } else {
    clock.stop();
    // Android can stop the reader in the background.
    flushPageSave();
  }
  updateAwake();
}

void App.addListener('appStateChange', ({ isActive }) => setActive(isActive));

// Back never finishes the activity: that destroyed the WebView and the
// reader lost the book. On the web the browser handles Back.
if (isAndroid) {
  void App.addListener('backButton', () => {
    switch (backStep({ jump: nav.jumpOpen(), drawer: drawer.covers() })) {
      case 'close-jump':
        nav.closeJump();
        break;
      case 'close-drawer':
        drawer.set(false);
        break;
      case 'minimize':
        void App.minimizeApp();
        break;
    }
  });
}

/** Asks which apps of the SubRead suite are installed, and shows the checklist. */
async function refreshSuite(): Promise<void> {
  try {
    state.suite = await SubRead.suite();
  } catch {
    return;
  }
  renderSuite();
  if (state.clock) showPlayerStatus(state.clock);
}

/**
 * Shows the checklist of the SubRead suite on the start card and in the
 * menu (Android only). The notification access of SubRead Overlay comes
 * from the last player state.
 */
function renderSuite(): void {
  const apps = state.suite;
  if (!isAndroid || !apps) return;
  state.suiteError = state.clock?.error;
  const items = suiteChecklist(apps, state.suiteError);
  const list = (): HTMLLIElement[] =>
    items.map((item) => {
      const li = document.createElement('li');
      li.className = item.ok ? 'ok' : 'missing';
      fill(li, item);
      return li;
    });
  ui.suiteList.replaceChildren(...list());
  const title = document.createElement('h3');
  title.textContent = 'SubRead suite';
  const card = document.createElement('ul');
  card.className = 'suite';
  card.append(...list());
  ui.suiteChecklist.replaceChildren(title, card);
  ui.suite.hidden = false;
}

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

/**
 * The token under a point of the screen, in client pixels: an index of
 * state.tokens, or -1 when no token is near. Null when the point is not on
 * the page, or the page is not read yet: then the strip tells how many
 * pages are read.
 */
function tokenAtPoint(clientX: number, clientY: number): number | null {
  const canvas = ui.page.querySelector('canvas');
  const pdf = state.pdf;
  if (!canvas || !pdf || ui.page.hidden) return null;
  const rect = canvas.getBoundingClientRect();
  const inside =
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  if (!inside) return null;
  const size = state.pages[state.currentPage];
  if (!size) {
    say(notReadText(state.pages.filter((p) => p).length, pdf.numPages));
    return null;
  }
  const x = ((clientX - rect.left) / rect.width) * size.width;
  const y = ((clientY - rect.top) / rect.height) * size.height;
  const zoom = window.visualViewport?.scale ?? 1;
  return tokenAt(state.tokens, state.currentPage, x, y, tapTolerance(size.width, rect.width, zoom));
}

/** Tap on the page: send the text under the tap to the dictionary. */
ui.page.addEventListener('click', (e) => {
  const t = tokenAtPoint(e.clientX, e.clientY);
  if (t === null || t < 0) return;
  const text = lookupText(state.tokens, t);
  // A tap on punctuation only gives no text.
  if (text === '') return;
  void (isAndroid ? lookUp(text) : copy(text));
});

/**
 * Long press on the page: a card in SubRead Anki for the word and its
 * sentence (ankiCard). Gives true when the press was on a word, so that
 * the click after it does no lookup.
 */
function longPress(clientX: number, clientY: number): boolean {
  const index = tokenAtPoint(clientX, clientY);
  const file = state.file;
  if (index === null || index < 0 || !file) return false;
  if (!isAndroid) {
    say(ANKI_WEB_TEXT);
    return true;
  }
  const card = ankiCard({
    tokens: state.tokens,
    index,
    spans: state.spans,
    markedCue: state.markedCue,
    cues: state.cues,
    source: cardSource(file.name, state.tokens[index]!.page),
  });
  if (card) void addCard(card);
  return true;
}

/** Sends the card to SubRead Anki. "Pause on lookup" pauses the player while the card shows. */
async function addCard(card: AnkiCard): Promise<void> {
  await withPause(async () => {
    try {
      const m = ankiText(await SubRead.ankiAdd(card));
      if (m) say(m);
    } catch (err) {
      say(`Anki card failed: ${String(err)}`);
    }
    return true;
  });
}

/** The web has no dictionary app: the text goes to the clipboard. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied: "${text}"`);
  } catch {
    say(`Copy failed: "${text}"`);
  }
}

/** Sends the text to the dictionary app, with "Pause on lookup". */
async function lookUp(text: string): Promise<void> {
  say(`Lookup: "${text}"`);
  await withPause(async () => {
    // Play again when the dictionary closed, or when it did not open.
    try {
      return (await SubRead.lookup({ text })).closed;
    } catch (err) {
      say(`Lookup failed: ${String(err)}`);
      return true;
    }
  });
}

/**
 * Runs `open`, an app over the reader: the dictionary or SubRead Anki.
 * With "Pause on lookup", the player pauses first, and plays again when
 * `open` gives true: the app closed. When the pause fails, `open` still
 * runs.
 */
async function withPause(open: () => Promise<boolean>): Promise<void> {
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
  const resume = await open();
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

// --- The buttons in the strip ---

onAction((id) => {
  switch (id) {
    case 'retry-reading':
      void readBook(true);
      break;
    case 'open-overlay':
      SubRead.openOverlay().catch(sayError);
      break;
  }
});

// --- Start ---

loadSettings();
// Force OCR and the pages of one book need an open book.
ui.forceOcr.disabled = true;
ui.clearBook.disabled = true;
ui.make.hidden = !isAndroid;
ui.audioRow.hidden = isAndroid;
// The web copies a lookup at once: there is no dictionary app to choose or to wait for.
ui.dictRow.hidden = !isAndroid;
ui.pauseRow.hidden = !isAndroid;
if (isAndroid) {
  void loadDictionaries().catch(sayError);
  void refreshSuite();
}
watchDb();
void restoreLastBook();
