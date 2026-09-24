// End-to-end check without a browser: real tesseract.js OCR on the
// synthetic page images, then alignment against the fixture cues.
// Needs network on the first run to fetch language data into .tessdata/.
// Run: npm run test:e2e

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alignCuesToTokens, type OcrToken } from '../../src/align';
import { pageToTokens } from '../../src/ocr-tokens';
import { parseSubtitles } from '../../src/subtitles';
import { FIXTURES, lineBand, type Fixture } from '../../fixtures/sample-text';

const TIMEOUT = 180_000;
const CACHE = '.tessdata';

async function ocrFixture(fixture: Fixture): Promise<OcrToken[]> {
  // tesseract.js writes the cache file only when the directory exists.
  await mkdir(CACHE, { recursive: true });
  const worker = await createWorker(fixture.lang, 1, { cachePath: CACHE });
  try {
    const image = await readFile(path.resolve('fixtures', `${fixture.name}.png`));
    const { data } = await worker.recognize(image, {}, { blocks: true });
    return pageToTokens(data, 0);
  } finally {
    await worker.terminate();
  }
}

describe.each(FIXTURES)('OCR + alignment on $name', (fixture) => {
  let tokens: OcrToken[] = [];

  beforeAll(async () => {
    tokens = await ocrFixture(fixture);
  }, TIMEOUT);

  afterAll(() => {
    const text = tokens.map((t) => t.text).join('');
    console.log(`[${fixture.name}] OCR read ${tokens.length} symbols: ${text.slice(0, 120)}...`);
  });

  it('highlights the line of each cue', async () => {
    const srt = await readFile(path.resolve('fixtures', `${fixture.name}.srt`), 'utf8');
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(fixture.lines.length);
    expect(tokens.length).toBeGreaterThan(0);

    const spans = alignCuesToTokens(
      cues.map((c) => c.text),
      tokens,
    );

    spans.forEach((span, i) => {
      expect(span.matched, `cue ${i} matched`).toBe(true);
      expect(
        span.end - span.start,
        `cue ${i} covers most of its characters`,
      ).toBeGreaterThanOrEqual(Math.floor(0.6 * fixture.lines[i]!.length));
      const band = lineBand(i);
      for (let t = span.start; t < span.end; t++) {
        const box = tokens[t]!.bbox;
        const yMid = (box.y0 + box.y1) / 2;
        expect(
          yMid,
          `cue ${i} token ${t} "${tokens[t]!.text}" on line ${i}`,
        ).toBeGreaterThanOrEqual(band.top);
        expect(yMid).toBeLessThanOrEqual(band.bottom);
      }
    });
  });
});
