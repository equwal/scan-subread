// tesseract.js wrapper for the browser.
//
// The app serves the worker script of tesseract.js and its WebAssembly core
// from its own files, so the code of OCR needs no network. The language data
// comes from jsDelivr at the first OCR run of each language. tesseract.js
// keeps it in IndexedDB after that.

import { createWorker, PSM, type ImageLike, type Worker as TesseractWorker } from 'tesseract.js';
// Vite copies the two files into the build and gives their URLs.
import workerPath from 'tesseract.js/dist/worker.min.js?url';
// One core file that holds the WebAssembly, so the worker makes one request.
// The app uses OEM 1 (LSTM only). Android WebView 91 and later and all
// current browsers have WebAssembly SIMD.
import corePath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import type { OcrToken } from './align';
import { OcrStartError } from './ocr-job';
import { pageToTokens } from './ocr-tokens';
import { imageToPpm } from './ppm';

export { OcrStartError };

export interface Ocr {
  /** Rejects when the OCR stops, or its worker fails, before the page is read. */
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
  // tesseract.js does not settle a job that runs when its worker stops or
  // fails. So each page also waits for the stop and for an error event of
  // the worker, and the reading does not wait for ever for such a page.
  let stop: (reason: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  // A stop while no page runs is no error.
  stopped.catch(() => undefined);
  webWorker(worker)?.addEventListener('error', (event) => {
    stop(new Error('The OCR worker failed.', { cause: event }));
  });
  return {
    async recognize(canvas, pageIndex) {
      const page = worker
        .recognize(ppmOf(canvas), {}, { blocks: true, text: false })
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
 * The Web Worker of a tesseract.js worker, for its error event. tesseract.js
 * keeps it in the property `worker`, which its types do not list.
 */
function webWorker(worker: TesseractWorker): EventTarget | undefined {
  const inner: unknown = 'worker' in worker ? worker.worker : undefined;
  return inner instanceof EventTarget ? inner : undefined;
}

/**
 * The pixels of a page canvas as a PPM file. tesseract.js makes a PNG file of
 * a canvas with canvas.toBlob, and in the Android WebView of the test phone
 * that took about 13 s for each page. The PPM file has the same pixels, so the
 * OCR gives the same tokens (test/e2e/ocr-ppm.test.ts). The ImageData is not
 * kept after the conversion.
 */
function ppmOf(canvas: HTMLCanvasElement): ImageLike {
  // pdf.js made the context with willReadFrequently (its default without
  // enableHWA), so getImageData reads memory and not the GPU.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The page canvas has no 2D context.');
  const ppm = imageToPpm(context.getImageData(0, 0, canvas.width, canvas.height));
  // tesseract.js uses the bytes of an image file as they are: its loadImage
  // returns `new Uint8Array(image)` for an input that is not a string, an
  // element, a canvas or a Blob (src/worker/browser/loadImage.js). Its type
  // ImageLike does not list Uint8Array.
  return ppm as unknown as ImageLike;
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
