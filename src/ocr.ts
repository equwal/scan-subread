// tesseract.js wrapper for the browser.
//
// tesseract.js loads its worker script, its WebAssembly core and the
// language data from jsDelivr by default, so the first OCR run needs
// network access. Language data is cached in IndexedDB after that.

import { createWorker, PSM } from 'tesseract.js';
import type { OcrToken } from './align';
import { pageToTokens } from './ocr-tokens';

export interface Ocr {
  recognize(image: HTMLCanvasElement, pageIndex: number): Promise<OcrToken[]>;
  terminate(): Promise<void>;
}

/**
 * Start an OCR worker for `lang` ("eng", "jpn", "jpn_vert", "jpn+eng", ...).
 * `onProgress` gets values in [0, 1] while a page is recognized.
 */
export async function createOcr(lang: string, onProgress: (p: number) => void): Promise<Ocr> {
  const worker = await createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  if (lang.includes('vert')) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT });
  }
  return {
    async recognize(image, pageIndex) {
      const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
      return pageToTokens(data, pageIndex);
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
