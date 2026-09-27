// The OCR of one reading of the book: the start error, the time limit of a
// page and the stop. No tesseract.js here, so main.ts can use this module and
// still load tesseract.js only when a page needs OCR.

import type { OcrToken } from './align';

/**
 * OCR could not start: the OCR code, the worker script, the core or the
 * language data did not load. `cause` holds the error. The first OCR run of
 * a language needs the network to download the language data.
 */
export class OcrStartError extends Error {
  constructor(cause: unknown) {
    super(`OCR could not start: ${String(cause)}`, { cause });
    this.name = 'OcrStartError';
  }
}

/** The OCR of a page took longer than its time limit. */
export class OcrTimeoutError extends Error {
  constructor(pageIndex: number, limitMs: number) {
    super(`The OCR of page ${pageIndex + 1} took more than ${Math.round(limitMs / 1000)} s.`);
    this.name = 'OcrTimeoutError';
  }
}

/** The time limit of the OCR of a page of PAGE_LIMIT_PIXELS pixels or less. */
const PAGE_LIMIT_MS = 120_000;

/** A page with more pixels than this gets more time, in proportion to its area. */
const PAGE_LIMIT_PIXELS = 4_000_000;

/**
 * The time limit of the OCR of a page of `pixels` pixels. The test phone read
 * a page of 1600 x 2263 pixels in about 2 s, and 120 s is about 60 times that,
 * so a slow phone or a dense page is not stopped. The time of the OCR grows
 * with the area of the page, so a larger page gets more time.
 */
export function pageTimeLimit(pixels: number): number {
  return PAGE_LIMIT_MS * Math.max(1, pixels / PAGE_LIMIT_PIXELS);
}

/**
 * The time limit of the start of OCR: the worker and its core load from the
 * app, and at the first run of a language its data loads from the network
 * (a few MB). A download that stalls, for example behind the login page of a
 * public Wi-Fi, does not end by itself. The limit is the same as for a page.
 */
export const START_LIMIT_MS = PAGE_LIMIT_MS;

/** An OCR worker. In the app, it is tesseract.js (src/ocr.ts). */
export interface OcrWorker<Image> {
  /** Rejects when the worker stops or fails before the page is read. */
  recognize(image: Image, pageIndex: number): Promise<OcrToken[]>;
  terminate(): Promise<void>;
}

/** The OCR of one reading of the book. */
export interface OcrJob<Image> {
  /**
   * Starts a worker when no worker runs. Rejects with the start error, also
   * with OcrStartError when the start takes longer than its time limit.
   */
  start(): Promise<void>;
  /**
   * Reads one page. When the page fails or takes longer than `limitMs`, the
   * job stops the worker and rejects. The next page starts a new worker.
   */
  recognize(image: Image, pageIndex: number, limitMs: number): Promise<OcrToken[]>;
  /** Stops the worker, and does not wait. Each page after the stop rejects. */
  stop(): void;
}

/**
 * The OCR of one reading. The job calls `startWorker` for the first page that
 * needs OCR, and again for the page after a failed page. tesseract.js does not
 * settle the page of a worker that crashed, so the time limit ends such a page,
 * and the reading goes on. A worker that did not start is not started again:
 * each page gets the same start error.
 *
 * A start that takes longer than `startLimitMs` rejects with OcrStartError.
 * The signal that `startWorker` gets then aborts, with that error as its
 * reason, so that the start can stop its worker. A stop of the job during a
 * start aborts the signal too. A worker that starts after the limit stops.
 */
export function createOcrJob<Image>(
  startWorker: (signal: AbortSignal) => Promise<OcrWorker<Image>>,
  startLimitMs = START_LIMIT_MS,
): OcrJob<Image> {
  let running: Promise<OcrWorker<Image>> | undefined;
  /** Cuts off the start that runs now, if any. */
  let cutStart: ((reason: Error) => void) | undefined;
  let stopped = false;

  function startInTime(): Promise<OcrWorker<Image>> {
    const control = new AbortController();
    const started = startWorker(control.signal);
    // The start rejects with the reason itself: AbortSignal.reason needs
    // WebView 98, and the app runs on WebView 91 and later.
    let cutOff: (reason: Error) => void = () => undefined;
    const cut = new Promise<never>((_resolve, reject) => {
      cutOff = (reason) => {
        reject(reason);
        control.abort(reason);
      };
    });
    cutStart = cutOff;
    const s = Math.round(startLimitMs / 1000);
    const timer = setTimeout(
      () => cutOff(new OcrStartError(new Error(`The start took more than ${s} s.`))),
      startLimitMs,
    );
    const end = (): void => {
      clearTimeout(timer);
      if (cutStart === cutOff) cutStart = undefined;
    };
    return Promise.race([started, cut]).then(
      (ocr) => {
        end();
        return ocr;
      },
      (err: unknown) => {
        end();
        // A worker that starts after the cut stops at once.
        stopOcr(started);
        throw err;
      },
    );
  }

  const worker = (): Promise<OcrWorker<Image>> => {
    if (stopped) return Promise.reject(new Error('OCR stopped.'));
    running ??= startInTime();
    return running;
  };
  return {
    async start() {
      await worker();
    },
    async recognize(image, pageIndex, limitMs) {
      const started = worker();
      const ocr = await started;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new OcrTimeoutError(pageIndex, limitMs)), limitMs);
      });
      try {
        return await Promise.race([ocr.recognize(image, pageIndex), late]);
      } catch (err) {
        // The worker can be broken, or it still reads the page. The next page
        // starts a new worker. After a stop, the worker is stopped already.
        if (running === started) {
          running = undefined;
          stopOcr(started);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    stop() {
      stopped = true;
      cutStart?.(new Error('OCR stopped.'));
      stopOcr(running);
      running = undefined;
    },
  };
}

/**
 * Stops the OCR of a reading, and does not wait. A reading whose OCR did
 * not start has nothing to stop, and its start error is no new error here.
 */
export function stopOcr(started: Promise<{ terminate(): Promise<void> }> | undefined): void {
  started?.then((ocr) => ocr.terminate()).catch(() => undefined);
}
