import type Tesseract from 'tesseract.js';
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
    recognize: vi.fn((_image: unknown): Promise<{ data: Pick<Tesseract.Page, 'blocks'> }> =>
      Promise.reject(new Error('The image is empty.')),
    ),
    terminate: vi.fn(() => Promise.resolve({})),
  };
}

/** A page canvas of 2 x 1 pixels: red, then blue with half alpha. */
function fakeCanvas(): HTMLCanvasElement {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]);
  const context = { getImageData: () => ({ width: 2, height: 1, data }) };
  return { width: 2, height: 1, getContext: () => context } as unknown as HTMLCanvasElement;
}

/** A path on the origin of the app, for example "/assets/worker.min-abc.js". */
const LOCAL = /^\/(?!\/)/;

/** The Web Worker of the browser, for the tests. It keeps each worker that it makes. */
class FakeWebWorker extends EventTarget {
  static made: FakeWebWorker[] = [];
  terminate = vi.fn();
  constructor(readonly url: string | URL) {
    super();
    FakeWebWorker.made.push(this);
  }
}

/**
 * createWorker as tesseract.js makes it in the browser: it makes its Web
 * Worker at once (src/worker/browser/spawnWorker.js). `start` gives the
 * promise of the start.
 */
function spawningCreateWorker(start: (opts: Options) => Promise<unknown>) {
  return (_lang: string, _oem: number, opts: Options): Promise<unknown> => {
    new Worker('blob:tesseract-worker');
    return start(opts);
  };
}

describe('createOcr', () => {
  afterEach(() => {
    createWorker.mockReset();
    vi.unstubAllGlobals();
    FakeWebWorker.made = [];
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

  it('stops the Web Worker when the language data does not load', async () => {
    // The finding: tesseract.js gives no handle to this worker, and it does
    // not stop it. Each Retry, book or setting left one more worker.
    vi.stubGlobal('Worker', FakeWebWorker);
    createWorker.mockImplementation(
      spawningCreateWorker((opts) => {
        setTimeout(() => opts.errorHandler?.('TypeError: Failed to fetch'), 0);
        return new Promise(() => undefined);
      }),
    );
    const error = await createOcr('jpn', () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrStartError);
    expect(FakeWebWorker.made).toHaveLength(1);
    expect(FakeWebWorker.made[0]!.terminate).toHaveBeenCalledTimes(1);
    // The browser gets its own Worker constructor back.
    expect(globalThis.Worker).toBe(FakeWebWorker);
  });

  it('stops the Web Worker when the start fails', async () => {
    // tesseract.js rejects the start when its worker script does not load,
    // and it does not stop the Web Worker.
    vi.stubGlobal('Worker', FakeWebWorker);
    createWorker.mockImplementation(
      spawningCreateWorker(() => Promise.reject('Uncaught NetworkError: failed to load.')),
    );
    await expect(createOcr('eng', () => undefined)).rejects.toBeInstanceOf(OcrStartError);
    expect(FakeWebWorker.made[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('stops the Web Worker when the start is cut off', async () => {
    // OcrJob cuts off a start that takes too long, for example a download
    // of the language data that stalls.
    vi.stubGlobal('Worker', FakeWebWorker);
    createWorker.mockImplementation(spawningCreateWorker(() => new Promise(() => undefined)));
    const controller = new AbortController();
    const start = createOcr('jpn', () => undefined, controller.signal);
    const reason = new OcrStartError(new Error('The start took more than 120 s.'));
    controller.abort(reason);
    await expect(start).rejects.toBe(reason);
    expect(FakeWebWorker.made[0]!.terminate).toHaveBeenCalledTimes(1);
  }, 1000);

  it('starts no worker when the start is cut off before it begins', async () => {
    const controller = new AbortController();
    controller.abort(new Error('OCR stopped.'));
    const error = await createOcr('eng', () => undefined, controller.signal).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OcrStartError);
    expect((error as OcrStartError).cause).toEqual(new Error('OCR stopped.'));
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('does not stop the Web Worker for an error after the start', async () => {
    // After the start, an error belongs to a page. OcrJob stops the worker then.
    vi.stubGlobal('Worker', FakeWebWorker);
    let handler: ((error: unknown) => void) | undefined;
    createWorker.mockImplementation(
      spawningCreateWorker((opts) => {
        handler = opts.errorHandler;
        return Promise.resolve(fakeWorker());
      }),
    );
    await createOcr('eng', () => undefined);
    handler?.('The image is empty.');
    expect(FakeWebWorker.made[0]!.terminate).not.toHaveBeenCalled();
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
    const page = ocr.recognize(fakeCanvas(), 0);
    await ocr.terminate();
    await expect(page).rejects.toThrow('OCR stopped.');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  }, 1000);

  it('rejects the page that runs when the worker fails', async () => {
    // tesseract.js does not settle a job when its Web Worker fails. The
    // finding: after a crash of the worker, the reading waited for ever.
    const worker = { ...fakeWorker(), worker: new EventTarget() };
    worker.recognize.mockImplementation(() => new Promise(() => undefined));
    createWorker.mockResolvedValue(worker);
    const ocr = await createOcr('eng', () => undefined);
    const page = ocr.recognize(fakeCanvas(), 0);
    const event = new Event('error');
    worker.worker.dispatchEvent(event);
    await expect(page).rejects.toThrow('The OCR worker failed.');
    await expect(page).rejects.toHaveProperty('cause', event);
  }, 1000);

  it('gives the error of a page as it is, not as OcrStartError', async () => {
    createWorker.mockResolvedValue(fakeWorker());
    const ocr = await createOcr('eng', () => undefined);
    const error = await ocr.recognize(fakeCanvas(), 0).catch((e: unknown) => e);
    expect(error).toEqual(new Error('The image is empty.'));
    expect(error).not.toBeInstanceOf(OcrStartError);
  });

  it('gives tesseract.js a PPM file of the canvas pixels, not the canvas', async () => {
    // tesseract.js makes a PNG file of a canvas with canvas.toBlob. The phone
    // finding: that took about 13 s for each page in the Android WebView.
    const worker = fakeWorker();
    worker.recognize.mockResolvedValue({ data: { blocks: [] } });
    createWorker.mockResolvedValue(worker);
    const ocr = await createOcr('eng', () => undefined);
    await expect(ocr.recognize(fakeCanvas(), 0)).resolves.toEqual([]);
    const image = worker.recognize.mock.calls[0]?.[0];
    expect(image).toBeInstanceOf(Uint8Array);
    // The header, then red and blue. The alpha is dropped.
    const header = [...Buffer.from('P6\n2 1\n255\n', 'latin1')];
    expect(Array.from(image as Uint8Array)).toEqual([...header, 255, 0, 0, 0, 0, 255]);
  });
});
