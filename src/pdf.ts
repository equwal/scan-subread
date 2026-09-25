// pdf.js wrapper: open a PDF, render one page to a canvas, read its text layer.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OcrToken } from './align';
import { MIN_TEXT_CHARS, textChars, textItems, textItemsToTokens } from './text-layer';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageText {
  /** Null when the page has no useful text layer. */
  tokens: OcrToken[] | null;
  /** Size of the page in pixels at `targetWidth`. */
  width: number;
  height: number;
}

export interface PdfDoc {
  numPages: number;
  /** Render page `index` (0-based) so that its width is `targetWidth` pixels. */
  renderPage(index: number, targetWidth: number): Promise<HTMLCanvasElement>;
  /** The text layer of page `index` as tokens in the pixel space of `targetWidth`. */
  pageText(index: number, targetWidth: number): Promise<PageText>;
  destroy(): Promise<void>;
}

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const viewportOf = async (index: number, targetWidth: number) => {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    return { page, viewport: page.getViewport({ scale: targetWidth / base.width }) };
  };
  return {
    numPages: doc.numPages,
    async renderPage(index, targetWidth) {
      const { page, viewport } = await viewportOf(index, targetWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // The "display" intent paces rendering with requestAnimationFrame,
      // which stops in a hidden tab. OCR runs for a long time, so use the
      // "print" intent, which renders without it.
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      return canvas;
    },
    async pageText(index, targetWidth) {
      const { page, viewport } = await viewportOf(index, targetWidth);
      const content = await page.getTextContent();
      const items = textItems(content.items);
      const size = { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
      if (textChars(items) < MIN_TEXT_CHARS) return { tokens: null, ...size };
      const toPixel = (x: number, y: number) =>
        viewport.convertToViewportPoint(x, y) as [number, number];
      return { tokens: textItemsToTokens(items, index, toPixel), ...size };
    },
    destroy: () => task.destroy(),
  };
}
