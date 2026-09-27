import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOcr, OcrStartError } from '../src/ocr';

const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker, PSM: { SINGLE_BLOCK_VERT_TEXT: '5' } }));

/** The options that createOcr gave to createWorker. */
interface Options {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
  logger?: (m: { status: string; progress: number }) => void;
  errorHandler?: (error: unknown) => void;
}

function options(): Options {
  return createWorker.mock.calls[0]?.[2] as Options;
}

function fakeWorker() {
  return {
    setParameters: vi.fn(() => Promise.resolve({})),
    recognize: vi.fn(() => Promise.reject(new Error('The image is empty.'))),
    terminate: vi.fn(() => Promise.resolve({})),
  };
}

/** A path on the origin of the app, for example "/assets/worker.min-abc.js". */
const LOCAL = /^\/(?!\/)/;

describe('createOcr', () => {
  afterEach(() => {
    createWorker.mockReset();
  });

  it('loads the worker script and the core from the app, not from jsDelivr', async () => {
    createWorker.mockResolvedValue(fakeWorker());
    const progress: number[] = [];
    await createOcr('jpn', (p) => progress.push(p));

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker.mock.calls[0]?.slice(0, 2)).toEqual(['jpn', 1]);
    const { workerPath, corePath, langPath, logger } = options();
    expect(workerPath).toMatch(LOCAL);
    expect(workerPath).toMatch(/\/worker\.min\.js$/);
    expect(corePath).toMatch(LOCAL);
    expect(corePath).toMatch(/\/tesseract-core-simd-lstm\.wasm\.js$/);
    expect(`${workerPath} ${corePath}`).not.toContain('jsdelivr');
    // The language data still comes from the default place of tesseract.js.
    expect(langPath).toBeUndefined();

    logger?.({ status: 'loading language traineddata', progress: 0.5 });
    logger?.({ status: 'recognizing text', progress: 0.25 });
    expect(progress).toEqual([0.25]);
  });

  it('sets the page mode of a vertical language', async () => {
    const worker = fakeWorker();
    createWorker.mockResolvedValue(worker);
    await createOcr('jpn_vert', () => undefined);
    expect(worker.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '5' });
  });

  it('gives OcrStartError when the worker script does not load', async () => {
    const cause =
      "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': failed to load.";
    createWorker.mockRejectedValue(cause);
    const error = await createOcr('eng', () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrStartError);
    expect((error as OcrStartError).cause).toBe(cause);
    expect((error as OcrStartError).message).toContain(cause);
  });

  it('gives OcrStartError when the language data does not load', async () => {
    // tesseract.js gives the error to errorHandler, and its promise does not settle.
    createWorker.mockImplementation((_lang: string, _oem: number, opts: Options) => {
      opts.errorHandler?.('TypeError: Failed to fetch');
      return new Promise(() => undefined);
    });
    const error = await createOcr('jpn', () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrStartError);
    expect((error as OcrStartError).cause).toBe('TypeError: Failed to fetch');
  });

  it('gives OcrStartError and stops the worker when the page mode cannot be set', async () => {
    const worker = fakeWorker();
    worker.setParameters.mockRejectedValue('The worker stopped.');
    createWorker.mockResolvedValue(worker);
    await expect(createOcr('jpn_vert', () => undefined)).rejects.toBeInstanceOf(OcrStartError);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects the page that runs when the OCR stops', async () => {
    // tesseract.js does not settle a job when its worker stops. The web
    // finding: a new reading started while the old job still read its page.
    const worker = fakeWorker();
    worker.recognize.mockImplementation(() => new Promise(() => undefined));
    createWorker.mockResolvedValue(worker);
    const ocr = await createOcr('eng', () => undefined);
    const page = ocr.recognize({} as HTMLCanvasElement, 0);
    await ocr.terminate();
    await expect(page).rejects.toThrow('OCR stopped.');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  }, 1000);

  it('gives the error of a page as it is, not as OcrStartError', async () => {
    createWorker.mockResolvedValue(fakeWorker());
    const ocr = await createOcr('eng', () => undefined);
    const error = await ocr.recognize({} as HTMLCanvasElement, 0).catch((e: unknown) => e);
    expect(error).toEqual(new Error('The image is empty.'));
    expect(error).not.toBeInstanceOf(OcrStartError);
  });
});
