// pdf.js wrapper: open a PDF and render one page to a canvas.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDoc {
  numPages: number;
  /** Render page `index` (0-based) so that its width is `targetWidth` pixels. */
  renderPage(index: number, targetWidth: number): Promise<HTMLCanvasElement>;
  destroy(): Promise<void>;
}

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    async renderPage(index, targetWidth) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return canvas;
    },
    destroy: () => task.destroy(),
  };
}
