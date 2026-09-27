// tesseract.js wrapper for the browser.
//
// The app serves the worker script of tesseract.js and its WebAssembly core
// from its own files, so the code of OCR needs no network. The language data
// comes from jsDelivr at the first OCR run of each language. tesseract.js
// keeps it in IndexedDB after that.

import { createWorker, PSM, type Worker as TesseractWorker } from 'tesseract.js';
// Vite copies the two files into the build and gives their URLs.
import workerPath from 'tesseract.js/dist/worker.min.js?url';
// One core file that holds the WebAssembly, so the worker makes one request.
// The app uses OEM 1 (LSTM only). Android WebView 91 and later and all
// current browsers have WebAssembly SIMD.
import corePath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import type { OcrToken } from './align';
import { OcrStartError } from './ocr-job';
import { pageToTokens } from './ocr-tokens';

export { OcrStartError };

export interface Ocr {
  /** Rejects when the OCR stops before the page is read. */
  recognize(image: HTMLCanvasElement, pageIndex: number): Promise<OcrToken[]>;
  terminate(): Promise<void>;
}

/**
 * Start an OCR worker for `lang` ("eng", "jpn", "jpn_vert", "jpn+eng", ...).
 * `onProgress` gets values in [0, 1] while a page is recognized. Rejects with
 * OcrStartError when the worker cannot start.
 */
export async function createOcr(lang: string, onProgress: (p: number) => void): Promise<Ocr> {
  let worker: TesseractWorker;
  try {
    worker = await startWorker(lang, onProgress);
  } catch (err) {
    throw new OcrStartError(err);
  }
  if (lang.includes('vert')) {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT });
    } catch (err) {
      await worker.terminate().catch(() => undefined);
      throw new OcrStartError(err);
    }
  }
  // tesseract.js does not settle a job that runs when its worker stops. So
  // each page also waits for the stop, and the reading does not wait for
  // ever for a page of a stopped worker.
  let stop: (reason: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  // A stop while no page runs is no error.
  stopped.catch(() => undefined);
  return {
    recognize(image, pageIndex) {
      const page = worker
        .recognize(image, {}, { blocks: true, text: false })
        .then(({ data }) => pageToTokens(data, pageIndex));
      return Promise.race([page, stopped]);
    },
    async terminate() {
      stop(new Error('OCR stopped.'));
      await worker.terminate();
    },
  };
}

/**
 * Starts the worker of tesseract.js. When the language data does not load,
 * tesseract.js gives the error to errorHandler, and the promise of
 * createWorker does not settle. So the first error rejects the start. That
 * worker cannot be stopped: tesseract.js gives no handle to it.
 */
function startWorker(lang: string, onProgress: (p: number) => void): Promise<TesseractWorker> {
  return new Promise((resolve, reject) => {
    createWorker(lang, 1, {
      workerPath,
      corePath,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress(m.progress);
      },
      // Also after the start: without an errorHandler, tesseract.js throws
      // each error of a job in the message handler of the worker.
      errorHandler: reject,
    }).then(resolve, reject);
  });
}
