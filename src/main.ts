// UI wiring. Alignment logic lives in align.ts, lookup logic in lookup.ts.

import { alignCuesToTokens, type OcrToken, type TokenSpan } from './align';
import { setupAudiobook } from './audiobook';
import {
  deleteDictionary,
  importDictionary,
  listDictionaries,
  storedFinder,
  type FoundTerm,
} from './dictdb';
import {
  choices,
  dataUrl,
  isAndroid,
  LocalAudio,
  uniqueWords,
  type LocalAudioStatus,
  type Word,
} from './local-audio';
import { lookup, scanText, tokenAt, type LookupResult, type TermFinder } from './lookup';
import { createOcr } from './ocr';
import { loadPdf, type PdfDoc } from './pdf';
import { cueIndexAt, parseSubtitles, type Cue } from './subtitles';

/** Page width in pixels for OCR. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

/** How far from a character a tap may land, as a share of the page width. */
const TAP_TOLERANCE = 0.015;

const DESKTOP = window.matchMedia('(min-width: 900px)');

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
  dictFile: el<HTMLInputElement>('dict-file'),
  dicts: el<HTMLUListElement>('dicts'),
  laStatus: el<HTMLDivElement>('la-status'),
  laImport: el<HTMLButtonElement>('la-import'),
  laRemove: el<HTMLButtonElement>('la-remove'),
  laProgress: el<HTMLProgressElement>('la-progress'),
  lang: el<HTMLSelectElement>('lang'),
  maxPages: el<HTMLInputElement>('max-pages'),
  run: el<HTMLButtonElement>('run'),
  status: el<HTMLDivElement>('status'),
  progress: el<HTMLProgressElement>('progress'),
  audio: el<HTMLAudioElement>('audio'),
  cues: el<HTMLOListElement>('cues'),
  prev: el<HTMLButtonElement>('prev'),
  next: el<HTMLButtonElement>('next'),
  pageLabel: el<HTMLSpanElement>('page-label'),
  viewer: el<HTMLDivElement>('viewer'),
  page: el<HTMLDivElement>('page'),
  overlay: el<HTMLDivElement>('overlay'),
  popup: el<HTMLDivElement>('popup'),
};

interface PageSize {
  width: number;
  height: number;
}

const state = {
  pdf: null as PdfDoc | null,
  /** Size of each OCR'd page at OCR scale. Index = page. */
  pageSizes: [] as (PageSize | undefined)[],
  tokens: [] as OcrToken[],
  cues: [] as Cue[],
  spans: [] as TokenSpan[],
  currentPage: -1,
  activeCue: -1,
  busy: false,
  renderSeq: 0,
  /** Term finder over the stored dictionaries. Null when none is imported. */
  finder: null as TermFinder<FoundTerm> | null,
  /** True when a local-audio android.db is in place. */
  localAudio: false,
  /** Counts popups, so audio buttons from a stale lookup are dropped. */
  popupSeq: 0,
};

function setStatus(text: string): void {
  ui.status.textContent = text;
}

function updateRunButton(): void {
  ui.run.disabled = state.busy || !state.pdf;
}

// --- Drawer ---

function setMenu(open: boolean): void {
  document.body.classList.toggle('menu-open', open);
  ui.menu.setAttribute('aria-expanded', String(open));
}

ui.menu.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));

// --- Loading inputs ---

ui.pdfFile.addEventListener('change', async () => {
  const file = ui.pdfFile.files?.[0];
  if (!file) return;
  try {
    await state.pdf?.destroy();
    state.pdf = await loadPdf(await file.arrayBuffer());
    state.tokens = [];
    state.spans = [];
    state.pageSizes = [];
    state.activeCue = -1;
    setStatus(`PDF loaded: ${state.pdf.numPages} pages. Run OCR, then tap words on the page.`);
    await showPage(0);
  } catch (err) {
    setStatus(`Cannot open PDF: ${String(err)}`);
  }
  updateRunButton();
});

/** Load subtitles from a file or from a finished job. `source` names where they came from. */
function loadSubtitles(text: string, source: string): void {
  state.cues = parseSubtitles(text);
  state.spans = [];
  state.activeCue = -1;
  setStatus(`${state.cues.length} cues loaded from ${source}.`);
  alignIfReady();
  renderCueList();
}

ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  if (!file) return;
  loadSubtitles(await file.text(), file.name);
});

const audiobook = setupAudiobook({
  tokens: () => state.tokens,
  ocrLang: () => ui.lang.value,
  loadSrt: loadSubtitles,
});

// --- Dictionaries ---

async function refreshDictionaries(): Promise<void> {
  const rows = await listDictionaries();
  state.finder = rows.length > 0 ? await storedFinder() : null;
  ui.dicts.replaceChildren(
    ...rows.map((row) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${row.title} (${row.termCount} terms)`;
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        del.disabled = true;
        setStatus(`Deleting ${row.title}...`);
        await deleteDictionary(row.id);
        setStatus(`Deleted ${row.title}.`);
        await refreshDictionaries();
      });
      li.append(name, del);
      return li;
    }),
  );
}

ui.dictFile.addEventListener('change', async () => {
  const files = [...(ui.dictFile.files ?? [])];
  ui.dictFile.value = '';
  for (const file of files) {
    try {
      setStatus(`Reading ${file.name}...`);
      const zip = new Uint8Array(await file.arrayBuffer());
      const row = await importDictionary(zip, setStatus);
      setStatus(`Imported ${row.title}: ${row.termCount} terms.`);
    } catch (err) {
      setStatus(`Import of ${file.name} failed: ${String(err)}`);
    }
  }
  await refreshDictionaries();
});

// --- Local audio (android.db) ---

function showLocalAudioStatus(status: LocalAudioStatus): void {
  state.localAudio = status.available;
  ui.laImport.disabled = !isAndroid;
  ui.laRemove.disabled = !status.available;
  if (!isAndroid) {
    ui.laStatus.textContent = 'Local audio: Android only.';
  } else if (status.available) {
    const mb = (status.sizeBytes / (1024 * 1024)).toFixed(1);
    ui.laStatus.textContent = `Local audio: ${status.path} (${mb} MB)`;
  } else {
    ui.laStatus.textContent = 'Local audio: not set up.';
  }
}

async function refreshLocalAudio(): Promise<void> {
  const status = await LocalAudio.status();
  console.log('LocalAudio status', JSON.stringify(status));
  showLocalAudioStatus(status);
}

ui.laImport.addEventListener('click', async () => {
  ui.laImport.disabled = true;
  ui.laProgress.hidden = false;
  ui.laProgress.value = 0;
  try {
    ui.laStatus.textContent = 'Local audio: importing...';
    showLocalAudioStatus(await LocalAudio.importDb());
  } catch (err) {
    ui.laStatus.textContent = `Local audio: ${(err as Error).message ?? String(err)}`;
    ui.laRemove.disabled = !state.localAudio;
  } finally {
    ui.laProgress.hidden = true;
    ui.laImport.disabled = false;
  }
});

ui.laRemove.addEventListener('click', async () => {
  ui.laRemove.disabled = true;
  try {
    showLocalAudioStatus(await LocalAudio.remove());
  } catch (err) {
    ui.laStatus.textContent = `Local audio: ${(err as Error).message ?? String(err)}`;
  }
});

if (isAndroid) {
  void LocalAudio.addListener('importProgress', ({ copied, total }) => {
    ui.laProgress.value = total > 0 ? copied / total : 0;
    const mb = (copied / (1024 * 1024)).toFixed(0);
    ui.laStatus.textContent = `Local audio: importing, ${mb} MB copied...`;
  });
}

/** Play one pronunciation clip. The plugin returns it as base64. */
async function playClip(file: string, source: string): Promise<void> {
  const { data } = await LocalAudio.audio({ file, source });
  await new Audio(dataUrl(file, data)).play();
}

/** Key of the audio slot map: one per expression and reading. */
function wordKey(word: Word): string {
  return `${word.expression}\t${word.reading}`;
}

/**
 * Add a play button per audio source under each entry. Runs after the
 * popup is on screen. `slots` maps a word key to the entry containers.
 */
async function addAudioButtons(
  seq: number,
  words: readonly Word[],
  slots: Map<string, HTMLElement[]>,
): Promise<void> {
  for (const word of uniqueWords(words)) {
    let entries;
    try {
      ({ entries } = await LocalAudio.lookup({
        expression: word.expression,
        ...(word.reading ? { reading: word.reading } : {}),
      }));
    } catch (err) {
      console.warn('LocalAudio lookup failed', err);
      return;
    }
    if (seq !== state.popupSeq) return; // A newer popup replaced this one.
    for (const slot of slots.get(wordKey(word)) ?? []) {
      for (const choice of choices(entries)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = `▶ ${choice.label}`;
        btn.addEventListener('click', () => {
          playClip(choice.file, choice.source).catch((err) => setStatus(String(err)));
        });
        slot.append(btn);
      }
    }
  }
}

// --- OCR and alignment ---

ui.run.addEventListener('click', async () => {
  const pdf = state.pdf;
  if (!pdf || state.busy) return;
  state.busy = true;
  updateRunButton();
  ui.progress.hidden = false;
  const pageCount = Math.min(pdf.numPages, Math.max(1, Number(ui.maxPages.value) || 1));
  try {
    setStatus(`Loading OCR language "${ui.lang.value}"...`);
    const ocr = await createOcr(ui.lang.value, (p) => {
      ui.progress.value = p;
    });
    try {
      state.tokens = [];
      state.pageSizes = [];
      for (let p = 0; p < pageCount; p++) {
        setStatus(`OCR page ${p + 1} of ${pageCount}...`);
        ui.progress.value = 0;
        const canvas = await pdf.renderPage(p, OCR_WIDTH);
        state.pageSizes[p] = { width: canvas.width, height: canvas.height };
        state.tokens.push(...(await ocr.recognize(canvas, p)));
      }
    } finally {
      await ocr.terminate();
    }
    setStatus(`Done. ${state.tokens.length} characters read. Tap a word to look it up.`);
    audiobook.onTokens();
    alignIfReady();
    renderCueList();
    state.activeCue = -1;
    if (state.spans.length > 0) await setActiveCue(0);
  } catch (err) {
    setStatus(`OCR failed: ${String(err)}`);
  } finally {
    state.busy = false;
    ui.progress.hidden = true;
    updateRunButton();
  }
});

/** Align the cues to the OCR text when both are present. */
function alignIfReady(): void {
  if (state.cues.length === 0 || state.tokens.length === 0) return;
  state.spans = alignCuesToTokens(
    state.cues.map((c) => c.text),
    state.tokens,
  );
  const matched = state.spans.filter((s) => s.matched).length;
  setStatus(`${matched}/${state.cues.length} cues matched to the page text.`);
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
      li.addEventListener('click', () => {
        ui.audio.currentTime = cue.start;
        void setActiveCue(i);
      });
      return li;
    }),
  );
}

async function setActiveCue(i: number): Promise<void> {
  if (i === state.activeCue) return;
  const items = ui.cues.children;
  items[state.activeCue]?.classList.remove('active');
  state.activeCue = i;
  const item = items[i];
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ block: 'nearest' });
  }
  const span = state.spans[i];
  if (!span) {
    drawBoxes();
    return;
  }
  const first = state.tokens[Math.min(span.start, state.tokens.length - 1)];
  if (first && first.page !== state.currentPage) await showPage(first.page);
  else drawBoxes();
}

// --- Page view ---

async function showPage(index: number): Promise<void> {
  const pdf = state.pdf;
  if (!pdf || index < 0 || index >= pdf.numPages) return;
  const seq = ++state.renderSeq;
  state.currentPage = index;
  ui.pageLabel.textContent = `Page ${index + 1} / ${pdf.numPages}`;
  hidePopup();
  // Render at device resolution, up to the OCR width, so zoom stays sharp.
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(Math.min(OCR_WIDTH, Math.max(300, ui.viewer.clientWidth - 16) * dpr));
  const canvas = await pdf.renderPage(index, width);
  if (seq !== state.renderSeq) return; // A newer render replaced this one.
  ui.page.querySelector('canvas')?.remove();
  ui.page.prepend(canvas);
  drawBoxes();
}

/** Draw one box per text line for the active cue on the current page. */
function drawBoxes(): void {
  ui.overlay.replaceChildren();
  const span = state.spans[state.activeCue];
  const size = state.pageSizes[state.currentPage];
  if (!span || !size) return;

  const lines = new Map<number, OcrToken['bbox']>();
  for (let t = span.start; t < span.end; t++) {
    const token = state.tokens[t]!;
    if (token.page !== state.currentPage) continue;
    const box = lines.get(token.line);
    if (!box) lines.set(token.line, { ...token.bbox });
    else {
      box.x0 = Math.min(box.x0, token.bbox.x0);
      box.y0 = Math.min(box.y0, token.bbox.y0);
      box.x1 = Math.max(box.x1, token.bbox.x1);
      box.y1 = Math.max(box.y1, token.bbox.y1);
    }
  }
  for (const box of lines.values()) {
    const div = document.createElement('div');
    div.className = span.matched ? 'box' : 'box unmatched';
    div.style.left = `${(100 * box.x0) / size.width}%`;
    div.style.top = `${(100 * box.y0) / size.height}%`;
    div.style.width = `${(100 * (box.x1 - box.x0)) / size.width}%`;
    div.style.height = `${(100 * (box.y1 - box.y0)) / size.height}%`;
    ui.overlay.append(div);
  }
}

ui.prev.addEventListener('click', () => void showPage(state.currentPage - 1));
ui.next.addEventListener('click', () => void showPage(state.currentPage + 1));

// --- Tap to look up ---

/** Tap on the page: look up the word under the tap. */
ui.page.addEventListener('click', async (e) => {
  const canvas = ui.page.querySelector('canvas');
  const size = state.pageSizes[state.currentPage];
  if (!canvas || !size) {
    hidePopup();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * size.width;
  const y = ((e.clientY - rect.top) / rect.height) * size.height;
  const t = tokenAt(state.tokens, state.currentPage, x, y, TAP_TOLERANCE * size.width);
  if (t < 0) {
    hidePopup();
    return;
  }
  const text = scanText(state.tokens, t);
  if (!state.finder) {
    showPopup(e, text, []);
    return;
  }
  showPopup(e, text, await lookup(text, state.finder));
});

function showPopup(e: MouseEvent, text: string, results: LookupResult<FoundTerm>[]): void {
  const seq = ++state.popupSeq;
  const slots = new Map<string, HTMLElement[]>();
  const entries = results.map((r) => {
    const term = r.term;
    const div = document.createElement('div');
    div.className = 'entry';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = term.expression;
    const reading = document.createElement('div');
    reading.className = 'reading';
    reading.textContent = term.reading && term.reading !== term.expression ? term.reading : '';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const via = r.rules.length > 0 ? ` (${r.surface}: ${r.rules.join(' < ')})` : '';
    meta.textContent = `${term.dictTitle}${via}`;
    const list = document.createElement('ul');
    for (const line of term.glossary) {
      const li = document.createElement('li');
      li.textContent = line;
      list.append(li);
    }
    const audio = document.createElement('div');
    audio.className = 'audio';
    div.append(head, reading, meta, audio, list);
    const key = wordKey(term);
    slots.set(key, [...(slots.get(key) ?? []), audio]);
    return div;
  });
  if (entries.length === 0) {
    const p = document.createElement('div');
    p.className = 'meta';
    p.textContent = state.finder
      ? `No entry for "${text}".`
      : 'Import a dictionary to look up words.';
    entries.push(p);
  }
  ui.popup.replaceChildren(...entries);
  ui.popup.hidden = false;
  if (DESKTOP.matches) {
    const width = ui.popup.offsetWidth;
    ui.popup.style.left = `${Math.min(e.clientX + 12, window.innerWidth - width - 8)}px`;
    ui.popup.style.top = `${Math.min(e.clientY + 12, window.innerHeight - ui.popup.offsetHeight - 8)}px`;
  } else {
    ui.popup.style.left = '';
    ui.popup.style.top = '';
  }
  // The audio lookup runs after the popup is on screen, so the popup stays quick.
  if (state.localAudio && results.length > 0) {
    void addAudioButtons(
      seq,
      results.map((r) => r.term),
      slots,
    );
  }
}

function hidePopup(): void {
  ui.popup.hidden = true;
}

// A tap outside the popup closes it. A tap outside the drawer closes the drawer.
document.addEventListener('click', (e) => {
  const target = e.target as Node;
  if (!ui.popup.contains(target) && !ui.page.contains(target)) hidePopup();
  if (
    document.body.classList.contains('menu-open') &&
    !ui.panel.contains(target) &&
    !ui.menu.contains(target)
  ) {
    setMenu(false);
  }
});

// --- Playback sync ---

ui.audio.addEventListener('timeupdate', () => {
  const i = cueIndexAt(state.cues, ui.audio.currentTime);
  // Keep the last cue lit during a pause between cues.
  if (i >= 0) void setActiveCue(i);
});

updateRunButton();
void refreshDictionaries().catch((err) =>
  setStatus(`Cannot open dictionary store: ${String(err)}`),
);
void refreshLocalAudio().catch((err) => {
  ui.laStatus.textContent = `Local audio: ${String(err)}`;
});
