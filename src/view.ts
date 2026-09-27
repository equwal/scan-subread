// The page view. It renders a page to fit the width of the viewer, draws
// the boxes of the mark, keeps the mark in view, and renders the page
// again when the width of the viewer or the pinch zoom changes.

import type { Box } from './line-boxes';
import type { PdfDoc } from './pdf';
import { renderWidth } from './render-size';
import { scrollTarget, type Extent } from './scroll';

/** The height of a page divided by its width before the first render: A4. */
const DEFAULT_ASPECT = 842 / 595;

/** Milliseconds after the last change of the pinch zoom before the page renders again. */
const ZOOM_MS = 300;

/** The least space around a box of the mark, in CSS pixels. See padBox in line-boxes.ts. */
const BOX_PAD = 2;

/** After the user scrolls the viewer, the view does not scroll by itself for this many milliseconds. */
export const USER_SCROLL_MS = 3000;

/** Milliseconds after the last resize before the page renders again. */
const RESIZE_MS = 200;

/** Scroll events for this many milliseconds after a scroll by the view come from the view. */
const AUTO_SCROLL_MS = 1000;

/** The mark of a page: the size of the page, and its boxes, in page pixels. */
export interface Marks {
  width: number;
  height: number;
  /** The boxes, with at least `pad` page pixels of padding. */
  boxes(pad: number): Box[];
}

export interface PageViewElements {
  viewer: HTMLElement;
  page: HTMLElement;
  overlay: HTMLElement;
}

export interface PageView {
  /** Renders page `index`, draws its mark, and scrolls to the mark, else to the top. */
  show(pdf: PdfDoc, index: number): Promise<void>;
  /**
   * Draws the mark of the page again. When the mark left the view, and the
   * user did not scroll lately, the viewer scrolls to it.
   */
  mark(): void;
  /** The canvas of the page, or null before the first render. */
  canvas(): HTMLCanvasElement | null;
}

/** `marks(index)` gives the mark of page `index`, or null when it has none. */
export function createPageView(
  ui: PageViewElements,
  marks: (index: number) => Marks | null,
): PageView {
  let pdf: PdfDoc | null = null;
  /** The page to show. */
  let index = -1;
  /** The page on the canvas, and the width of the canvas in device pixels. */
  let shown = { pdf: null as PdfDoc | null, index: -1, width: 0 };
  let seq = 0;
  let autoUntil = 0;
  let userAt = -Infinity;

  const canvas = (): HTMLCanvasElement | null => ui.page.querySelector('canvas');

  /**
   * The width of the canvas for the page now: sharp for the screen and the
   * pinch zoom, within the limits of renderWidth. The shape of the page on
   * the canvas stands for the shape of the next page.
   */
  function targetWidth(): number {
    const c = canvas();
    return renderWidth({
      cssWidth: ui.page.clientWidth,
      dpr: window.devicePixelRatio || 1,
      zoom: window.visualViewport?.scale ?? 1,
      aspect: c && c.width > 0 ? c.height / c.width : DEFAULT_ASPECT,
    });
  }

  /** Draws the boxes of the mark. Gives their extent in the scroll space of the viewer, or null. */
  function draw(): Extent | null {
    ui.overlay.replaceChildren();
    const c = canvas();
    const m = shown.index === index ? marks(index) : null;
    if (!c || !m) return null;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0) return null;
    const boxes = m.boxes((BOX_PAD * m.width) / rect.width);
    if (boxes.length === 0) return null;
    for (const box of boxes) {
      const div = document.createElement('div');
      div.className = 'box';
      div.style.left = `${(100 * box.x0) / m.width}%`;
      div.style.top = `${(100 * box.y0) / m.height}%`;
      div.style.width = `${(100 * (box.x1 - box.x0)) / m.width}%`;
      div.style.height = `${(100 * (box.y1 - box.y0)) / m.height}%`;
      ui.overlay.append(div);
    }
    const top = Math.min(...boxes.map((b) => b.y0));
    const bottom = Math.max(...boxes.map((b) => b.y1));
    const offset = rect.top - ui.viewer.getBoundingClientRect().top + ui.viewer.scrollTop;
    const scale = rect.height / m.height;
    return { top: offset + top * scale, bottom: offset + bottom * scale };
  }

  function scrollTo(top: number | null, smooth: boolean): void {
    const v = ui.viewer;
    if (top === null || Math.abs(v.scrollTop - top) < 1) return;
    autoUntil = performance.now() + AUTO_SCROLL_MS;
    v.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Scrolls to the mark when it is out of view, unless the user scrolled lately. */
  function keepInView(extent: Extent | null, smooth: boolean): void {
    if (!extent || performance.now() - userAt < USER_SCROLL_MS) return;
    const v = ui.viewer;
    const view = { top: v.scrollTop, height: v.clientHeight };
    scrollTo(scrollTarget(extent, view, v.scrollHeight - v.clientHeight), smooth);
  }

  /**
   * Renders the page to show. When it is another page than the page on
   * the canvas, the viewer scrolls to its mark, else to its top. Else the
   * mark stays in view.
   */
  async function render(): Promise<void> {
    const doc = pdf;
    if (!doc || index < 0) return;
    const my = ++seq;
    const at = index;
    const width = targetWidth();
    const c = await doc.renderPage(at, width);
    if (my !== seq) return; // A newer render replaced this one.
    const turn = doc !== shown.pdf || at !== shown.index;
    // A new canvas can change the height of the content, and the browser
    // then moves the scroll position. That scroll does not come from the user.
    autoUntil = performance.now() + AUTO_SCROLL_MS;
    canvas()?.remove();
    ui.page.prepend(c);
    shown = { pdf: doc, index: at, width };
    const extent = draw();
    const v = ui.viewer;
    if (turn) {
      const view = { top: v.scrollTop, height: v.clientHeight };
      const max = v.scrollHeight - v.clientHeight;
      scrollTo(extent ? scrollTarget(extent, view, max, true) : 0, false);
    } else {
      keepInView(extent, false);
    }
  }

  // A scroll event that the view did not cause comes from the user.
  ui.viewer.addEventListener(
    'scroll',
    () => {
      if (performance.now() > autoUntil) userAt = performance.now();
    },
    { passive: true },
  );
  ui.viewer.addEventListener('scrollend', () => {
    autoUntil = 0;
  });
  for (const type of ['wheel', 'touchmove']) {
    ui.viewer.addEventListener(
      type,
      () => {
        userAt = performance.now();
        autoUntil = 0;
      },
      { passive: true },
    );
  }

  // Render again when the canvas needs another width: after a rotation, or
  // when a pinch zoom settles. The canvas stretches at once. The new render
  // makes it sharp. The marks are in page pixels, so they stay correct.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  function renderAgainSoon(ms: number): void {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (shown.index < 0 || ui.page.clientWidth === 0 || targetWidth() === shown.width) return;
      // A render of a closed document fails. The stretched canvas stays.
      render().catch(() => undefined);
    }, ms);
  }
  new ResizeObserver(() => renderAgainSoon(RESIZE_MS)).observe(ui.viewer);
  window.visualViewport?.addEventListener('resize', () => renderAgainSoon(ZOOM_MS));

  return {
    show(doc, i) {
      pdf = doc;
      index = i;
      return render();
    },
    mark() {
      keepInView(draw(), true);
    },
    canvas,
  };
}
