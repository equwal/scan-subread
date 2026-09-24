// Pure text alignment. No DOM, no OCR engine.
//
// Input: subtitle cue texts and OCR tokens in reading order.
// Output: for each cue, the span of OCR tokens that shows that cue.
//
// Method: normalize both sides to a plain character stream. Run a
// character diff (Myers, via fast-diff) between the joined cue stream and
// the OCR stream. Equal runs of two or more characters are anchors. Each
// cue gets the span between its first and last anchor. A cue with no
// anchor gets a share of the gap between its matched neighbors. The diff
// is monotonic, so the spans are monotonic too.

import diff from 'fast-diff';

/** A recognized unit of text with a box on a page. */
export interface OcrToken {
  text: string;
  page: number;
  /** Line id. Tokens with the same line id lie on one visual line. */
  line: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Half-open character span [start, end) in the normalized OCR stream. */
export interface CharSpan {
  start: number;
  end: number;
  /** True when at least one anchor supports the span. */
  matched: boolean;
}

/** Half-open token span [start, end) in the token list. */
export interface TokenSpan {
  start: number;
  end: number;
  matched: boolean;
}

/** Shortest equal run that counts as an anchor. */
const MIN_ANCHOR = 2;

const KEEP = /[\p{L}\p{N}\p{M}]/u;

/**
 * Normalize text for comparison. NFKC folds full-width forms. Lowercase
 * folds case. Only letters, numbers and marks stay. Spaces and punctuation
 * go, so word boundaries do not matter. This works for CJK, where OCR and
 * subtitles rarely agree on spacing.
 */
export function normalizeText(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC').toLowerCase()) {
    if (KEEP.test(ch)) out += ch;
  }
  return out;
}

export interface Stream {
  chars: string;
  /** tokenOf[i] is the index of the token that holds chars[i]. */
  tokenOf: number[];
}

/** Join normalized token texts into one stream with a char-to-token map. */
export function buildStream(texts: readonly string[]): Stream {
  let chars = '';
  const tokenOf: number[] = [];
  texts.forEach((text, i) => {
    const norm = normalizeText(text);
    chars += norm;
    for (let k = 0; k < norm.length; k++) tokenOf.push(i);
  });
  return { chars, tokenOf };
}

/**
 * Align normalized cue texts to a normalized OCR stream.
 * Returns one CharSpan per cue. Spans are monotonic and inside [0, ocr.length].
 */
export function alignCues(cueTexts: readonly string[], ocr: string): CharSpan[] {
  const n = cueTexts.length;
  const offsets: number[] = [];
  let joined = '';
  for (const t of cueTexts) {
    offsets.push(joined.length);
    joined += t;
  }
  offsets.push(joined.length);

  // Map each anchored cue char to its OCR position.
  const mapped = new Int32Array(joined.length).fill(-1);
  const ops = diff(joined, ocr);
  let a = 0;
  let b = 0;
  ops.forEach(([op, text], i) => {
    if (op === diff.EQUAL) {
      if (text.length >= MIN_ANCHOR || isLocalNoise(ops, i)) {
        for (let k = 0; k < text.length; k++) mapped[a + k] = b + k;
      }
      a += text.length;
      b += text.length;
    } else if (op === diff.DELETE) {
      a += text.length;
    } else {
      b += text.length;
    }
  });

  // Build matched spans.
  const spans: CharSpan[] = [];
  for (let i = 0; i < n; i++) {
    let lo = -1;
    let hi = -1;
    for (let k = offsets[i]!; k < offsets[i + 1]!; k++) {
      const p = mapped[k]!;
      if (p < 0) continue;
      if (lo < 0) lo = p;
      hi = p + 1;
    }
    spans.push(
      lo < 0 ? { start: 0, end: 0, matched: false } : { start: lo, end: hi, matched: true },
    );
  }

  fillGaps(spans, cueTexts, ocr.length);
  return spans;
}

/** Longest edit next to a short equal run that still counts as local noise. */
const MAX_LOCAL_EDIT = 2;

/**
 * True when the equal run at ops[i] sits between short edits, such as one
 * substituted or one dropped character. A short equal run inside a long
 * insert or delete is a chance match and does not count.
 */
function isLocalNoise(ops: readonly diff.Diff[], i: number): boolean {
  let before = 0;
  for (let k = i - 1; k >= 0 && ops[k]![0] !== diff.EQUAL; k--) before += ops[k]![1].length;
  let after = 0;
  for (let k = i + 1; k < ops.length && ops[k]![0] !== diff.EQUAL; k++) after += ops[k]![1].length;
  return before <= MAX_LOCAL_EDIT && after <= MAX_LOCAL_EDIT;
}

/**
 * Give each run of unmatched cues a share of the gap between its matched
 * neighbors, in proportion to cue length.
 */
function fillGaps(spans: CharSpan[], cueTexts: readonly string[], ocrLength: number): void {
  let i = 0;
  while (i < spans.length) {
    if (spans[i]!.matched) {
      i++;
      continue;
    }
    let j = i;
    while (j < spans.length && !spans[j]!.matched) j++;
    const gapStart = i > 0 ? spans[i - 1]!.end : 0;
    const gapEnd = j < spans.length ? spans[j]!.start : ocrLength;
    let total = 0;
    for (let k = i; k < j; k++) total += cueTexts[k]!.length;
    let pos = gapStart;
    for (let k = i; k < j; k++) {
      const share = total > 0 ? Math.round(((gapEnd - gapStart) * cueTexts[k]!.length) / total) : 0;
      const end = k === j - 1 ? gapEnd : Math.min(gapEnd, pos + share);
      spans[k] = { start: pos, end, matched: false };
      pos = end;
    }
    i = j;
  }
}

/** Convert a char span to a token span with the char-to-token map. */
export function toTokenSpan(span: CharSpan, stream: Stream): TokenSpan {
  if (span.end <= span.start) {
    // Empty span: point at the token at or after the position.
    const t =
      span.start < stream.tokenOf.length ? stream.tokenOf[span.start]! : stream.tokenOf.length;
    return { start: t, end: t, matched: span.matched };
  }
  return {
    start: stream.tokenOf[span.start]!,
    end: stream.tokenOf[span.end - 1]! + 1,
    matched: span.matched,
  };
}

/** Full pipeline: raw cue texts and OCR tokens to token spans. */
export function alignCuesToTokens(
  cueTexts: readonly string[],
  tokens: readonly Pick<OcrToken, 'text'>[],
): TokenSpan[] {
  const stream = buildStream(tokens.map((t) => t.text));
  const spans = alignCues(cueTexts.map(normalizeText), stream.chars);
  return spans.map((s) => toTokenSpan(s, stream));
}
