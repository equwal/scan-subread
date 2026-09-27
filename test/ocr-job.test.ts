import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcrStartError, stopOcr } from '../src/ocr-job';

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
