// The OCR of one reading of the book: the start error and the stop. No
// tesseract.js here, so main.ts can use this module and still load
// tesseract.js only when a page needs OCR.

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

/**
 * Stops the OCR of a reading, and does not wait. A reading whose OCR did
 * not start has nothing to stop, and its start error is no new error here.
 */
export function stopOcr(started: Promise<{ terminate(): Promise<void> }> | undefined): void {
  started?.then((ocr) => ocr.terminate()).catch(() => undefined);
}
