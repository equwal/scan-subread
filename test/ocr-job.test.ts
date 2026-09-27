import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcrToken } from '../src/align';
import {
  createOcrJob,
  OcrStartError,
  OcrTimeoutError,
  pageTimeLimit,
  START_LIMIT_MS,
  stopOcr,
  type OcrWorker,
} from '../src/ocr-job';

/** The reasons of the unhandled rejections while `run` runs, and 20 ms after it. */
async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const record = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', record);
  try {
    run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', record);
  }
  return reasons;
}

describe('stopOcr', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stops the OCR that started', async () => {
    const terminate = vi.fn(() => Promise.resolve());
    stopOcr(Promise.resolve({ terminate }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no OCR started', () => {
    expect(() => stopOcr(undefined)).not.toThrow();
  });

  it('gives no unhandled rejection when the OCR could not start', async () => {
    // The web finding: the reading ended with an unhandled rejection, and the
    // progress stayed in the strip.
    const failed = Promise.reject(new OcrStartError('TypeError: Failed to fetch'));
    expect(await unhandledDuring(() => void stopOcr(failed))).toEqual([]);
  });

  it('gives no unhandled rejection when the stop fails', async () => {
    const terminate = vi.fn(() => Promise.reject(new Error('The worker is gone.')));
    expect(await unhandledDuring(() => void stopOcr(Promise.resolve({ terminate })))).toEqual([]);
  });
});

describe('pageTimeLimit', () => {
  it('gives a page of the app 120 s', () => {
    expect(pageTimeLimit(1600 * 2263)).toBe(120_000);
    expect(pageTimeLimit(1)).toBe(120_000);
  });

  it('gives a larger page more time, in proportion to its area', () => {
    expect(pageTimeLimit(8_000_000)).toBe(240_000);
    expect(pageTimeLimit(1600 * 10_000)).toBe(480_000);
  });
});

/** A token of page `page`, so that a result shows its page. */
function token(page: number): OcrToken {
  return { text: 'a', page, line: 0, word: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } };
}

/** A fake OCR worker. `read` gives the result of each page. */
function fakeWorker(read: (page: number) => Promise<OcrToken[]>) {
  return {
    recognize: vi.fn((_image: string, page: number) => read(page)),
    terminate: vi.fn(() => Promise.resolve()),
  } satisfies OcrWorker<string>;
}

/** A page that never ends: tesseract.js after a crash of its worker. */
const never = (): Promise<OcrToken[]> => new Promise(() => undefined);

const readPage = (page: number): Promise<OcrToken[]> => Promise.resolve([token(page)]);

/** A fake worker whose page rejects when the worker stops, as in src/ocr.ts. */
function stoppableWorker() {
  let stop: (reason: Error) => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = reject;
  });
  stopped.catch(() => undefined);
  const worker = fakeWorker(() => stopped);
  worker.terminate.mockImplementation(() => {
    stop(new Error('OCR stopped.'));
    return Promise.resolve();
  });
  return worker;
}

describe('createOcrJob', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops a worker whose page runs too long, and reads the next page with a new worker', async () => {
    // The finding: a crashed tesseract worker does not settle its page, and
    // the reading waited for ever.
    const hung = fakeWorker(never);
    const next = fakeWorker(readPage);
    const start = vi
      .fn<() => Promise<OcrWorker<string>>>()
      .mockResolvedValueOnce(hung)
      .mockResolvedValueOnce(next);
    const job = createOcrJob(start);
    let settled = false;
    const page = job
      .recognize('page 1', 0, 1000)
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    expect(hung.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await page;
    expect(error).toBeInstanceOf(OcrTimeoutError);
    expect((error as Error).message).toBe('The OCR of page 1 took more than 1 s.');
    expect(hung.terminate).toHaveBeenCalledTimes(1);
    await expect(job.recognize('page 2', 1, 1000)).resolves.toEqual([token(1)]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a worker whose page fails, and reads the next page with a new worker', async () => {
    // An error event of the worker, or an abort of its WebAssembly, rejects the page.
    const failed = fakeWorker(() => Promise.reject(new Error('The OCR worker failed.')));
    const next = fakeWorker(readPage);
    const start = vi
      .fn<() => Promise<OcrWorker<string>>>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(next);
    const job = createOcrJob(start);
    await expect(job.recognize('page 1', 0, 1000)).rejects.toThrow('The OCR worker failed.');
    expect(failed.terminate).toHaveBeenCalledTimes(1);
    await expect(job.recognize('page 2', 1, 1000)).resolves.toEqual([token(1)]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the worker for the next page when a page is read in time', async () => {
    const worker = fakeWorker(readPage);
    const start = vi.fn(() => Promise.resolve(worker));
    const job = createOcrJob(start);
    await job.start();
    await expect(job.recognize('page 1', 0, 1000)).resolves.toEqual([token(0)]);
    await expect(job.recognize('page 2', 1, 1000)).resolves.toEqual([token(1)]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives each page the start error, and does not start again', async () => {
    const error = new OcrStartError('TypeError: Failed to fetch');
    const start = vi.fn(() => Promise.reject(error));
    const job = createOcrJob(start);
    await expect(job.start()).rejects.toBe(error);
    await expect(job.recognize('page 1', 0, 1000)).rejects.toBe(error);
    expect(start).toHaveBeenCalledTimes(1);
  });

  /** A start that never ends, as a stalled download. It keeps the signal of each start. */
  function stalledStart() {
    const signals: AbortSignal[] = [];
    const start = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<OcrWorker<string>>(() => undefined);
    });
    return { start, signals };
  }

  it('gives the start error when the start takes longer than its limit, and stops the start', async () => {
    // The finding: a download of the language data that stalls (a captive
    // portal) held the start, and so the reading, for ever, with no Retry.
    const { start, signals } = stalledStart();
    const job = createOcrJob(start, 1000);
    let settled = false;
    const started = job
      .start()
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    const error = await started;
    expect(error).toBeInstanceOf(OcrStartError);
    expect((error as Error).message).toBe(
      'OCR could not start: Error: The start took more than 1 s.',
    );
    // The start of the worker gets the stop, so that it can stop its worker.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toBe(error);
    // Each page gets the same start error. No new start runs.
    await expect(job.recognize('page 1', 0, 1000)).rejects.toBe(error);
    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the start error also where abort() keeps no reason (WebView before 98)', async () => {
    // abort(reason) and AbortSignal.reason came in Chrome 98. The SIMD core of
    // the app runs from WebView 91.
    const abort = AbortController.prototype.abort;
    const noReason = vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function (
      this: AbortController,
    ) {
      abort.call(this);
    });
    try {
      const { start } = stalledStart();
      const job = createOcrJob(start, 1000);
      const started = job.start().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await started).toBeInstanceOf(OcrStartError);
    } finally {
      noReason.mockRestore();
    }
  });

  it('stops a worker that starts after the start limit', async () => {
    const worker = fakeWorker(readPage);
    const start = vi.fn(
      () => new Promise<OcrWorker<string>>((resolve) => setTimeout(() => resolve(worker), 2000)),
    );
    const job = createOcrJob(start, 1000);
    const started = job.start().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await started).toBeInstanceOf(OcrStartError);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('stops a start that runs when the job stops', async () => {
    const { start, signals } = stalledStart();
    const job = createOcrJob(start, 1000);
    const started = job.start().catch((e: unknown) => e);
    job.stop();
    expect(signals[0]?.aborted).toBe(true);
    expect(await started).toEqual(new Error('OCR stopped.'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the start the limit of a page by default', () => {
    expect(START_LIMIT_MS).toBe(pageTimeLimit(0));
  });

  it('rejects the page that runs on stop, stops the worker once, and starts no new worker', async () => {
    const worker = stoppableWorker();
    const start = vi.fn(() => Promise.resolve(worker));
    const job = createOcrJob(start);
    const page = job.recognize('page 1', 0, 1000).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    job.stop();
    expect(await page).toEqual(new Error('OCR stopped.'));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(job.recognize('page 2', 1, 1000)).rejects.toThrow('OCR stopped.');
    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
