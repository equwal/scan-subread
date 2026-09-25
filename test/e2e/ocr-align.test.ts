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

const TIMEOUT = 300_000;
const CACHE = '.tessdata';

/** The image file of page `p`: `<name>.png` for one page, `<name>-<p+1>.png` for more. */
function pngName(fixture: Fixture, p: number): string {
  return fixture.pages.length === 1 ? `${fixture.name}.png` : `${fixture.name}-${p + 1}.png`;
}

async function ocrFixture(fixture: Fixture): Promise<OcrToken[]> {
  // tesseract.js writes the cache file only when the directory exists.
  await mkdir(CACHE, { recursive: true });
  const worker = await createWorker(fixture.lang, 1, { cachePath: CACHE });
  try {
    const tokens: OcrToken[] = [];
    for (let p = 0; p < fixture.pages.length; p++) {
      const image = await readFile(path.resolve('fixtures', pngName(fixture, p)));
      const { data } = await worker.recognize(image, {}, { blocks: true });
      tokens.push(...pageToTokens(data, p));
    }
    return tokens;
  } finally {
    await worker.terminate();
  }
}

/** The page and the line on that page of cue `i`, or null for a cue that crosses pages. */
function placeOf(fixture: Fixture, i: number): { page: number; line: number } | null {
  let cue = 0;
  for (const [page, lines] of fixture.pages.entries()) {
    const first = page > 0 ? 1 : 0;
    const last = page < fixture.pages.length - 1 ? lines.length - 1 : lines.length;
    for (let line = first; line < last; line++, cue++) if (cue === i) return { page, line };
    if (page < fixture.pages.length - 1) {
      if (cue === i) return null;
      cue++;
    }
  }
  throw new Error(`no cue ${i}`);
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
    expect(cues).toHaveLength(fixture.cues.length);
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
      ).toBeGreaterThanOrEqual(Math.floor(0.6 * fixture.cues[i]!.length));
      const place = placeOf(fixture, i);
      if (!place) {
        // The cue that crosses the page boundary: its tokens lie on both pages.
        const pages = new Set<number>();
        for (let t = span.start; t < span.end; t++) pages.add(tokens[t]!.page);
        expect([...pages].sort(), `cue ${i} crosses the pages`).toEqual([0, 1]);
        return;
      }
      const band = lineBand(place.line);
      for (let t = span.start; t < span.end; t++) {
        const token = tokens[t]!;
        expect(token.page, `cue ${i} token ${t} "${token.text}" on page ${place.page}`).toBe(
          place.page,
        );
        const yMid = (token.bbox.y0 + token.bbox.y1) / 2;
        expect(
          yMid,
          `cue ${i} token ${t} "${token.text}" on line ${place.line}`,
        ).toBeGreaterThanOrEqual(band.top);
        expect(yMid).toBeLessThanOrEqual(band.bottom);
      }
    });
  });
});
