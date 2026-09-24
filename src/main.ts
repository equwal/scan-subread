// UI wiring. All alignment logic lives in align.ts.

import { alignCuesToTokens, type OcrToken, type TokenSpan } from './align';
import { createOcr } from './ocr';
import { loadPdf, type PdfDoc } from './pdf';
import { cueIndexAt, parseSubtitles, type Cue } from './subtitles';

/** Page width in pixels for OCR. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

const ui = {
  pdfFile: el<HTMLInputElement>('pdf-file'),
  audioFile: el<HTMLInputElement>('audio-file'),
  subFile: el<HTMLInputElement>('sub-file'),
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
};

function setStatus(text: string): void {
  ui.status.textContent = text;
}

function updateRunButton(): void {
  ui.run.disabled = state.busy || !state.pdf || state.cues.length === 0;
}

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
    setStatus(`PDF loaded: ${state.pdf.numPages} pages.`);
    await showPage(0);
  } catch (err) {
    setStatus(`Cannot open PDF: ${String(err)}`);
  }
  updateRunButton();
});

ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  if (!file) return;
  state.cues = parseSubtitles(await file.text());
  state.spans = [];
  state.activeCue = -1;
  renderCueList();
  setStatus(`${state.cues.length} cues loaded.`);
  updateRunButton();
});

ui.audioFile.addEventListener('change', () => {
  const file = ui.audioFile.files?.[0];
  if (!file) return;
  ui.audio.src = URL.createObjectURL(file);
});

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
    state.spans = alignCuesToTokens(
      state.cues.map((c) => c.text),
      state.tokens,
    );
    const matched = state.spans.filter((s) => s.matched).length;
    setStatus(
      `Done. ${state.tokens.length} characters read. ${matched}/${state.cues.length} cues matched.`,
    );
    renderCueList();
    state.activeCue = -1;
    await setActiveCue(0);
  } catch (err) {
    setStatus(`OCR failed: ${String(err)}`);
  } finally {
    state.busy = false;
    ui.progress.hidden = true;
    updateRunButton();
  }
});

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
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(Math.min(OCR_WIDTH, Math.max(300, ui.viewer.clientWidth - 32) * dpr));
  const canvas = await pdf.renderPage(index, width);
  if (seq !== state.renderSeq) return; // A newer render replaced this one.
  ui.page.querySelector('canvas')?.remove();
  canvas.addEventListener('click', onPageClick);
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

/** Click on the page: seek to the cue that covers the clicked character. */
function onPageClick(e: MouseEvent): void {
  const canvas = e.currentTarget as HTMLCanvasElement;
  const size = state.pageSizes[state.currentPage];
  if (!size) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * size.width;
  const y = ((e.clientY - rect.top) / rect.height) * size.height;
  const t = state.tokens.findIndex(
    (tok) =>
      tok.page === state.currentPage &&
      x >= tok.bbox.x0 &&
      x <= tok.bbox.x1 &&
      y >= tok.bbox.y0 &&
      y <= tok.bbox.y1,
  );
  if (t < 0) return;
  const i = state.spans.findIndex((s) => t >= s.start && t < s.end);
  const cue = state.cues[i];
  if (!cue) return;
  ui.audio.currentTime = cue.start;
  void setActiveCue(i);
}

ui.prev.addEventListener('click', () => void showPage(state.currentPage - 1));
ui.next.addEventListener('click', () => void showPage(state.currentPage + 1));

// --- Playback sync ---

ui.audio.addEventListener('timeupdate', () => {
  const i = cueIndexAt(state.cues, ui.audio.currentTime);
  // Keep the last cue lit during a pause between cues.
  if (i >= 0) void setActiveCue(i);
});

updateRunButton();
