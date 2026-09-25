// The text layer of a PDF page as tokens, the same shape as OCR. Pure.
//
// pdf.js `getTextContent()` gives one item per run of text: the string,
// the transform of its origin, its length along the run and its font
// size. Each character gets an even share of the run. The boxes go
// through `toPixel`, so they land in the pixel space of the rendered page
// like the OCR boxes do.

import type { OcrToken } from './align';
import { LINES_PER_PAGE } from './ocr-tokens';

/** The fields of a pdf.js TextItem that the conversion uses. */
export interface TextItemLike {
  str: string;
  /** 'ltr', 'rtl' or 'ttb'. 'ttb' is a vertical font: the run goes down. */
  dir: string;
  /** [a, b, c, d, e, f]: the x axis (a, b), the y axis (c, d), the origin (e, f). */
  transform: readonly number[];
  /** Length of the run along the x axis of the font, or the font size for 'ttb'. */
  width: number;
  /** The font size, or the length of the run down the page for 'ttb'. */
  height: number;
  /** True when a line break follows the item. */
  hasEOL: boolean;
}

/** From PDF user space to page pixels. */
export type ToPixel = (x: number, y: number) => readonly [number, number];

/** Part of the font size above the baseline, and below it. */
const ASCENT = 0.8;
const DESCENT = 0.25;

/** Fewer non-space characters than this means the page has no useful text layer. */
export const MIN_TEXT_CHARS = 10;

interface Vec {
  x: number;
  y: number;
}

function unit(x: number, y: number): Vec {
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
}

/** The geometry of one run: where it starts, which way it goes, how big the glyphs are. */
interface Run {
  origin: Vec;
  /** Unit vector along the run. */
  along: Vec;
  /** Unit vector across the run, toward the top of the glyphs. */
  up: Vec;
  /** Length of the run. */
  length: number;
  /** Size of the glyphs across the run. */
  size: number;
  /** True for a vertical font: the glyphs are centered on the run. */
  centered: boolean;
}

function runOf(item: TextItemLike): Run {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
  const origin = { x: e, y: f };
  if (item.dir === 'ttb') {
    // A vertical font advances down the y axis of the font.
    return {
      origin,
      along: unit(-c, -d),
      up: unit(a, b),
      length: item.height,
      size: item.width,
      centered: true,
    };
  }
  // A horizontal font advances along the x axis of the font. A rotated
  // transform (|b| > |a|) lays the run along the page's y.
  return {
    origin,
    along: unit(a, b),
    up: unit(c, d),
    length: item.width,
    size: item.height,
    centered: false,
  };
}

/** The axis-aligned pixel box of a parallelogram given by its four corners. */
function pixelBox(corners: readonly Vec[], toPixel: ToPixel): OcrToken['bbox'] {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of corners) {
    const [x, y] = toPixel(p.x, p.y);
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  return box;
}

/** Box of character `i` of `n` in the run. */
function charBox(run: Run, i: number, n: number, toPixel: ToPixel): OcrToken['bbox'] {
  const step = run.length / n;
  const from = i * step;
  const to = from + step;
  const [lo, hi] = run.centered
    ? [-run.size / 2, run.size / 2]
    : [-run.size * DESCENT, run.size * ASCENT];
  const at = (t: number, s: number): Vec => ({
    x: run.origin.x + run.along.x * t + run.up.x * s,
    y: run.origin.y + run.along.y * t + run.up.y * s,
  });
  return pixelBox([at(from, lo), at(to, lo), at(to, hi), at(from, hi)], toPixel);
}

/** True for a character that separates words and gets no token. */
function isSpace(ch: string): boolean {
  return /\s/u.test(ch);
}

/**
 * One token per character, with line and word ids, in content-stream
 * order. Runs on one baseline (within half a font size) share a line.
 * Spaces separate words and get no token.
 */
export function textItemsToTokens(
  items: readonly TextItemLike[],
  pageIndex: number,
  toPixel: ToPixel,
): OcrToken[] {
  const tokens: OcrToken[] = [];
  const lines: { key: number; tolerance: number; id: number }[] = [];
  let lineId = -1;
  let word = 0;
  let breakLine = true;
  for (const item of items) {
    const chars = [...item.str];
    if (chars.length === 0) {
      if (item.hasEOL) breakLine = true;
      continue;
    }
    const run = runOf(item);
    // The baseline: the origin projected on the "up" axis.
    const key = run.origin.x * run.up.x + run.origin.y * run.up.y;
    const tolerance = run.size / 2;
    let line = breakLine ? undefined : lines.find((l) => Math.abs(l.key - key) <= l.tolerance);
    if (!line) {
      line = { key, tolerance, id: pageIndex * LINES_PER_PAGE + lines.length };
      lines.push(line);
      word++;
    }
    if (line.id !== lineId) word++;
    lineId = line.id;
    breakLine = item.hasEOL;
    chars.forEach((ch, i) => {
      if (isSpace(ch)) {
        word++;
        return;
      }
      tokens.push({
        text: ch,
        page: pageIndex,
        line: line.id,
        word: pageIndex * LINES_PER_PAGE + word,
        bbox: charBox(run, i, chars.length, toPixel),
      });
    });
  }
  return tokens;
}

/** The text items of a pdf.js text content. Marked-content items have no `str` and are dropped. */
export function textItems(items: readonly unknown[]): TextItemLike[] {
  return items.filter((i): i is TextItemLike => typeof i === 'object' && i !== null && 'str' in i);
}

/** The number of non-space characters in the items. */
export function textChars(items: readonly TextItemLike[]): number {
  let n = 0;
  for (const item of items) for (const ch of item.str) if (!isSpace(ch)) n++;
  return n;
}
