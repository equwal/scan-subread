// End-to-end check without a browser: tesseract.js reads the same symbols
// from the PNG file of a page and from a PPM file of the same pixels. The app
// gives tesseract.js a PPM file (src/ppm.ts), because the PNG encoding of the
// page canvas took about 13 s for each page in the Android WebView.
// Needs network on the first run to fetch language data into .tessdata/.
// Run: npm run test:e2e

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { describe, expect, it } from 'vitest';
import type { OcrToken } from '../../src/align';
import { pageToTokens } from '../../src/ocr-tokens';
import { imageToPpm } from '../../src/ppm';

const TIMEOUT = 300_000;
const CACHE = '.tessdata';

/** A PPM file of the pixels of a PNG file: RGBA pixels, as getImageData gives them in the app. */
async function ppmOf(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  const ppm = imageToPpm({
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  });
  return Buffer.from(ppm.buffer, ppm.byteOffset, ppm.byteLength);
}

/** How far apart two readings of one page are. */
function difference(a: OcrToken[], b: OcrToken[]): string {
  const text = (tokens: OcrToken[]) => tokens.map((t) => t.text).join('');
  let box = 0;
  let unequal = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const p = a[i]!;
    const q = b[i]!;
    const d = Math.max(
      Math.abs(p.bbox.x0 - q.bbox.x0),
      Math.abs(p.bbox.y0 - q.bbox.y0),
      Math.abs(p.bbox.x1 - q.bbox.x1),
      Math.abs(p.bbox.y1 - q.bbox.y1),
    );
    box = Math.max(box, d);
    if (d > 0 || p.text !== q.text || p.line !== q.line || p.word !== q.word) unequal++;
  }
  return (
    `${a.length} and ${b.length} symbols, text ${text(a) === text(b) ? 'equal' : 'not equal'}, ` +
    `${unequal} unequal symbols, largest box difference ${box} px`
  );
}

describe.each([
  { file: 'sample-eng-2p-1.png', lang: 'eng' },
  { file: 'sample-jpn.png', lang: 'jpn' },
])('OCR of $file', ({ file, lang }) => {
  it(
    'reads the same symbols from the PNG file and from a PPM file of its pixels',
    async () => {
      const png = await readFile(path.resolve('fixtures', file));
      const ppm = await ppmOf(png);
      // tesseract.js writes the cache file only when the directory exists.
      await mkdir(CACHE, { recursive: true });
      const worker = await createWorker(lang, 1, { cachePath: CACHE });
      try {
        const read = async (image: Buffer): Promise<OcrToken[]> => {
          const start = performance.now();
          const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
          console.log(
            `[${file}] ${image.length} bytes read in ${Math.round(performance.now() - start)} ms`,
          );
          return pageToTokens(data, 0);
        };
        const fromPng = await read(png);
        const fromPpm = await read(ppm);
        console.log(`[${file}] PNG and PPM: ${difference(fromPng, fromPpm)}`);
        expect(fromPng.length).toBeGreaterThan(0);
        expect(fromPpm).toEqual(fromPng);
      } finally {
        await worker.terminate();
      }
    },
    TIMEOUT,
  );
});
