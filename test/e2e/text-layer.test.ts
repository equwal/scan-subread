// End-to-end check of the text layer: pdf.js in Node (the legacy build)
// reads the text-layer fixture PDFs, and text-layer.ts must give one
// token per character, in order, with the lines of the fixture.
// Run: npm run test:e2e

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { alignCuesToTokens, normalizeText, type OcrToken } from '../../src/align';
import { bookText } from '../../src/book-text';
import { parseSubtitles } from '../../src/subtitles';
import { textItems, textItemsToTokens } from '../../src/text-layer';
import { FIXTURES, type Fixture } from '../../fixtures/sample-text';

const WIDTH = 1600;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function textTokens(file: string): Promise<{ tokens: OcrToken[]; height: number }> {
  const data = new Uint8Array(await readFile(file));
  const task = getDocument({ data });
  const doc = await task.promise;
  const tokens: OcrToken[] = [];
  let height = 0;
  for (let p = 0; p < doc.numPages; p++) {
    const page = await doc.getPage(p + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / base.width });
    height = viewport.height;
    const content = await page.getTextContent();
    const items = textItems(content.items);
    const toPixel = (x: number, y: number) =>
      viewport.convertToViewportPoint(x, y) as [number, number];
    tokens.push(...textItemsToTokens(items, p, toPixel));
  }
  await task.destroy();
  return { tokens, height };
}

const withText: Fixture[] = [];
for (const fixture of FIXTURES) {
  if (await exists(path.resolve('fixtures', `${fixture.name}-text.pdf`))) withText.push(fixture);
}

describe.each(withText)('text layer of $name-text.pdf', (fixture) => {
  it('carries every character in order, line by line', async () => {
    const { tokens, height } = await textTokens(
      path.resolve('fixtures', `${fixture.name}-text.pdf`),
    );
    const expected = fixture.pages.map((lines) => lines.join('\n')).join('\n\n') + '\n';
    expect(bookText(tokens)).toBe(expected);
    expect(tokens.map((t) => t.text).join('')).toBe(expected.replace(/\s/g, ''));
    // Each page: every box inside the page, lines from top to bottom.
    let lastLine = -1;
    let lastY = -Infinity;
    for (const t of tokens) {
      expect(t.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(t.bbox.x1).toBeLessThanOrEqual(WIDTH);
      expect(t.bbox.y0).toBeGreaterThanOrEqual(0);
      expect(t.bbox.y1).toBeLessThanOrEqual(height);
      if (t.line !== lastLine) {
        if (t.line % 100000 !== 0) expect(t.bbox.y0).toBeGreaterThan(lastY);
        lastLine = t.line;
        lastY = t.bbox.y0;
      }
    }
  });

  it('aligns every cue to the text layer', async () => {
    const { tokens } = await textTokens(path.resolve('fixtures', `${fixture.name}-text.pdf`));
    const srt = await readFile(path.resolve('fixtures', `${fixture.name}.srt`), 'utf8');
    const spans = alignCuesToTokens(
      parseSubtitles(srt).map((c) => c.text),
      tokens,
    );
    expect(spans).toHaveLength(fixture.cues.length);
    spans.forEach((span, i) => {
      expect(span.matched, `cue ${i} matched`).toBe(true);
      const text = tokens
        .slice(span.start, span.end)
        .map((t) => t.text)
        .join('');
      // The alignment drops punctuation, so a span can leave out a comma at its edge.
      expect(normalizeText(text)).toBe(normalizeText(fixture.cues[i]!));
    });
  });
});

it('has at least the English text-layer fixture', () => {
  expect(withText.map((f) => f.name)).toContain('sample-eng-2p');
});
