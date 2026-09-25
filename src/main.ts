// UI wiring. Alignment logic lives in align.ts, the tap in hit-test.ts.

import { alignCuesToTokens, type OcrToken, type TokenSpan } from './align';
import { lookupText, tokenAt } from './hit-test';
import { createOcr } from './ocr';
import { loadPdf, type PdfDoc } from './pdf';
import { cueIndexAt, parseSubtitles, type Cue } from './subtitles';

/** Page width in pixels for OCR. Boxes are stored in this scale. */
const OCR_WIDTH = 1600;

/** How far from a character a tap may land, as a share of the page width. */
const TAP_TOLERANCE = 0.015;

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
  audioFile: el<HTMLInputElement>('audio-file'),
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

ui.subFile.addEventListener('change', async () => {
  const file = ui.subFile.files?.[0];
  if (!file) return;
  state.cues = parseSubtitles(await file.text());
  state.spans = [];
  state.activeCue = -1;
  setStatus(`${state.cues.length} cues loaded from ${file.name}.`);
  alignIfReady();
  renderCueList();
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
    setStatus(`Done. ${state.tokens.length} characters read. Tap a word on the page.`);
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

// --- Tap on a word ---

/** Tap on the page: show the text under the tap. */
ui.page.addEventListener('click', (e) => {
  const canvas = ui.page.querySelector('canvas');
  const size = state.pageSizes[state.currentPage];
  if (!canvas || !size) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * size.width;
  const y = ((e.clientY - rect.top) / rect.height) * size.height;
  const t = tokenAt(state.tokens, state.currentPage, x, y, TAP_TOLERANCE * size.width);
  if (t < 0) return;
  setStatus(`Tapped: "${lookupText(state.tokens, t)}"`);
});

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

// --- Playback sync ---

ui.audio.addEventListener('timeupdate', () => {
  const i = cueIndexAt(state.cues, ui.audio.currentTime);
  // Keep the last cue lit during a pause between cues.
  if (i >= 0) void setActiveCue(i);
});

updateRunButton();
