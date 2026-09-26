// UI wiring: the state of the book, the subtitles and the follow. The
// logic lives in the pure modules (align.ts, cue-pages.ts, follower.ts,
// hit-test.ts, line-boxes.ts, messages.ts, paging.ts, read-order.ts,
// scroll.ts, text-layer.ts, player-state.ts, play-clock.ts). The UI parts
// are in drawer.ts (the menu), nav.ts (page turns by the user), status.ts
// (the strip) and view.ts (the page).

import { createAligner, type Aligner, type OcrToken, type TokenSpan } from './align';
import { bookText } from './book-text';
import { LocalAudioClock, OverlayClock, type ClockSource, type ClockState } from './clock-source';
import { audioPage, cueParts, cueProgress, pageStartTime, type CueParts } from './cue-pages';
import { setupDrawer } from './drawer';
import { follow, type FollowEvent, type FollowMode } from './follower';
import { lookupText, tapTolerance, tokenAt } from './hit-test';
import { lineBoxes } from './line-boxes';
import {
  clockText,
  errorMessage,
  notReadText,
  pagesReadText,
  pdfLoadedText,
  playerMessage,
  readingText,
} from './messages';
import { setupNav } from './nav';
import { createOcr, type Ocr } from './ocr';
import { defaultRtl } from './paging';
import { loadPdf, type PdfDoc } from './pdf';
import { nextPage } from './read-order';
import { scrollTarget } from './scroll';
import { say, showPlayer, showReading } from './status';
import { isAndroid, SubRead } from './subread';
import { lastCueAt, parseSubtitles, type Cue } from './subtitles';
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
import { createPageView, type Marks } from './view';

/** Page width in pixels for OCR and the text layer. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

/** Milliseconds to wait after a page is read before the cues are aligned again. */
const ALIGN_DEBOUNCE = 300;

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
  srt: null as string | null,
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

ui.pdfFile.addEventListener('change', async () => {
  const file = ui.pdfFile.files?.[0];
  if (!file) return;
  drawer.closeOnPhone();
  try {
    state.readSeq++;
    await state.pdf?.destroy();
    state.pdf = await loadPdf(await file.arrayBuffer());
    state.file = file;
    state.pages = [];
    state.tokens = [];
    state.spans = [];
    state.cueParts = [];
    state.activeCue = -1;
    state.markedCue = -1;
    state.held = false;
    ui.makeSubs.disabled = false;
    ui.empty.hidden = true;
    ui.page.hidden = false;
    if (state.clock) showPlayerStatus(state.clock);
    say(pdfLoadedText(state.pdf.numPages));
    await showPage(0);
    const saved = await getSrt(bookKey(file));
    if (saved) loadSubtitles(saved, 'the last SubRead run');
    void readBook();
  } catch (err) {
    say(`Cannot open PDF: ${String(err)}`);
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
  state.cueParts = [];
  state.markedCue = -1;
  const total = pdf.numPages;
  const pending = new Set(Array.from({ length: total }, (_, i) => i));
  const counts = { text: 0, ocr: 0 };
  const read = (): number => counts.text + counts.ocr;
  /** The page that is read now. */
  let page = -1;
  // The OCR worker starts on the first page that needs it.
  const ocr: { started?: Promise<Ocr> } = {};
  const getOcr = (): Promise<Ocr> => {
    ocr.started ??= createOcr(ui.lang.value, (p) => {
      if (seq === state.readSeq) {
        showReading(readingText(read(), total, `page ${page + 1}: OCR ${Math.round(p * 100)}%`));
      }
    });
    return ocr.started;
  };
  try {
    while (pending.size > 0) {
      page = nextPage(pending, state.currentPage);
      pending.delete(page);
      showReading(readingText(read(), total, `page ${page + 1}`));
      const entry = await readPage(pdf, file, page, getOcr);
      if (seq !== state.readSeq) return; // Another book or another setting took over.
      counts[entry.source]++;
      state.pages[page] = entry;
      // Put the tokens of the page at their place in page order.
      const at = state.pages.slice(0, page).reduce((n, p) => n + (p?.tokens.length ?? 0), 0);
      state.tokens.splice(at, 0, ...entry.tokens);
      const how = entry.source === 'text' ? 'text layer' : 'OCR';
      showReading(readingText(read(), total, `page ${page + 1}: ${how}`));
      if (page === state.currentPage) view.mark();
      scheduleAlign();
    }
    const matched = align();
    say(
      pagesReadText(counts) +
        (matched === null ? '' : ` ${matched}/${state.cues.length} cues matched.`),
    );
  } catch (err) {
    if (seq === state.readSeq) say(`Cannot read the pages: ${String(err)}`);
  } finally {
    if (ocr.started) await (await ocr.started).terminate().catch(() => undefined);
    if (seq === state.readSeq) showReading(null);
  }
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

/** Load subtitles from a file or from SubRead. `source` names where they came from. */
function loadSubtitles(text: string, source: string): void {
  state.cues = parseSubtitles(text);
  state.aligner = createAligner(state.cues.map((c) => c.text));
  state.srt = text;
  state.spans = [];
  state.cueParts = [];
  state.activeCue = -1;
  state.markedCue = -1;
  updateSyncPage();
  renderCueList();
  const matched = align();
  say(
    `${state.cues.length} cues loaded from ${source}.` +
      (matched === null ? '' : ` ${matched} matched to the pages read so far.`),
  );
  offerSrt(text);
}

ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  if (!file) return;
  drawer.closeOnPhone();
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
    boxes: (pad) => lineBoxes(state.tokens, span, index, pad),
  };
}

async function showPage(index: number): Promise<void> {
  const pdf = state.pdf;
  if (!pdf || index < 0 || index >= pdf.numPages) return;
  state.currentPage = index;
  nav.update();
  await view.show(pdf, index);
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
