// Pure text alignment. No DOM, no OCR engine.
//
// Input: the texts of the subtitle cues, and the tokens of the pages that
// are read so far. Output: for each cue, the span of tokens that shows the
// cue.
//
// A book has some hundred thousand characters, and the reader reads its
// pages one by one. One diff of all cues against a few pages is slow, and
// it matches cues to wrong places. So each page is aligned on its own:
//
// 1. All cues, normalized and joined, make the cue stream. An index holds
//    each K-gram (a run of K characters) that occurs only once in it.
// 2. Each K-gram of a page that is in the index gives an anchor: a cue
//    position and a page position. The longest chain of anchors that rises
//    in both stays. An anchor far from the median shift of the chain is a
//    chance hit and goes too. A page with fewer than MIN_ANCHORS anchors is
//    not in the subtitles.
// 3. The first and the last anchor give the region of the cue stream that
//    the page shows. A character diff (Myers, via fast-diff) of the region
//    against the page maps cue characters to page tokens.
// 4. The pairs (cue character, token) of all read pages must rise in both.
//    The longest rising chain of pairs stays. The other pairs go, for
//    example the pairs of a page that is out of order.
// 5. Each cue gets the span from its first to its last mapped token.
//
// The aligner keeps the result of steps 2 and 3 for each page, so one more
// page costs the work of one page. A short cue stream has too few K-grams
// for anchors: its region is the whole stream.

import diff from 'fast-diff';

/** A recognized unit of text with a box on a page. */
export interface OcrToken {
  text: string;
  page: number;
  /** Line id. Tokens with the same line id lie on one visual line. */
  line: number;
  /** Word id. Tokens with the same word id form one OCR word. Absent for hand-made tokens. */
  word?: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Half-open token span [start, end) in the tokens of the read pages. */
export interface TokenSpan {
  start: number;
  end: number;
  /** True when a character of the cue is mapped. An unmatched cue has the span [0, 0). */
  matched: boolean;
}

/** The length of the K-grams in the index. */
const K = 8;

/** A page with fewer anchors than this is not in the subtitles. */
const MIN_ANCHORS = 3;

/**
 * An anchor whose shift (cue position minus page position) is further than
 * this from the median shift of its page is a chance hit. A long page can
 * have a longer part that is not narrated, such as a caption, so a quarter
 * of the page length applies when it is more.
 */
const SHIFT_LIMIT = 50;

/**
 * A cue stream of this length or less (a few subtitle lines) is too short
 * for anchors. Each page is then compared with the whole stream, so text
 * that is not in the subtitles can match by chance.
 */
const SHORT_STREAM = 64;

/** The shortest equal run of the diff that counts as a match. */
const MIN_RUN = 2;

/** The longest edit next to a shorter equal run that still counts as local noise. */
const MAX_LOCAL_EDIT = 2;

const KEEP = /[\p{L}\p{N}\p{M}]/u;

/** A limit on the passes of normalizeText. Real text needs one or two. */
const MAX_NORMALIZE_PASSES = 4;

/** One pass: NFKC, lowercase, then only letters, numbers and marks. */
function normalizePass(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC').toLowerCase()) {
    if (KEEP.test(ch)) out += ch;
  }
  return out;
}

/**
 * Normalize text for comparison. NFKC folds full-width forms. Lowercase
 * folds case. Only letters, numbers and marks stay. Spaces and punctuation
 * go, so word boundaries do not matter. This works for CJK, where OCR and
 * subtitles rarely agree on spacing.
 *
 * The case map and the filter can leave combining marks out of canonical
 * order, and then one more pass changes the text. The passes repeat until
 * the text stays the same, so the result is stable.
 */
export function normalizeText(text: string): string {
  let out = normalizePass(text);
  for (let pass = 1; pass < MAX_NORMALIZE_PASSES; pass++) {
    const next = normalizePass(out);
    if (next === out) break;
    out = next;
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

/** The tokens of one page. The aligner uses only their text. */
export type PageTokens = readonly Pick<OcrToken, 'text'>[];

/** Aligns the cues of one subtitle file to the pages that are read. */
export interface Aligner {
  /**
   * One span for each cue. `pages[p]` holds the tokens of page p, or
   * undefined when page p is not read. The spans index the tokens of the
   * read pages, joined in page order. The spans of the matched cues rise:
   * a later cue starts and ends at or after an earlier cue.
   */
  spans(pages: readonly (PageTokens | undefined)[]): TokenSpan[];
}

/** The pairs (cue character, page token) of one page, in page order. Both rise. */
interface PageMatch {
  /** Positions in the cue stream. */
  cue: Int32Array;
  /** For each position in `cue`, the index of its token on the page. */
  token: Int32Array;
}

/** A half-open range [from, to) of the cue stream. */
interface Region {
  from: number;
  to: number;
}

/**
 * Make an aligner for the cues of one subtitle file. Keep it while the
 * subtitles stay loaded: it keeps the result of each page that it saw.
 */
export function createAligner(cueTexts: readonly string[]): Aligner {
  const cues = cueTexts.map(normalizeText);
  const stream = cues.join('');
  /** cueOf[i] is the index of the cue that holds stream[i]. */
  const cueOf = new Int32Array(stream.length);
  let at = 0;
  cues.forEach((cue, i) => {
    cueOf.fill(i, at, at + cue.length);
    at += cue.length;
  });
  const grams = uniqueGrams(stream);
  /** The match of each page, by the identity of its token array. */
  const matches = new WeakMap<PageTokens, PageMatch>();

  function matchPage(tokens: PageTokens): PageMatch {
    const page = buildStream(tokens.map((t) => t.text));
    const region =
      stream.length <= SHORT_STREAM
        ? { from: 0, to: stream.length }
        : locate(page.chars, stream, grams);
    return region
      ? mapRegion(stream, region, page)
      : { cue: new Int32Array(), token: new Int32Array() };
  }

  return {
    spans(pages) {
      // Join the pairs of the read pages in page order. A token index counts
      // the tokens of all read pages before it.
      const parts: { match: PageMatch; base: number }[] = [];
      let base = 0;
      let count = 0;
      for (const tokens of pages) {
        if (!tokens) continue;
        let match = matches.get(tokens);
        if (!match) {
          match = matchPage(tokens);
          matches.set(tokens, match);
        }
        parts.push({ match, base });
        base += tokens.length;
        count += match.cue.length;
      }
      const cue = new Int32Array(count);
      const token = new Int32Array(count);
      let n = 0;
      for (const part of parts) {
        cue.set(part.match.cue, n);
        for (let k = 0; k < part.match.token.length; k++) {
          token[n + k] = part.base + part.match.token[k]!;
        }
        n += part.match.cue.length;
      }

      // The tokens rise already. Keep the longest chain of pairs whose cue
      // positions rise too. Then each cue spans its first to its last token.
      const spans: TokenSpan[] = cues.map(() => ({ start: 0, end: 0, matched: false }));
      for (const k of risingChain(cue)) {
        const span = spans[cueOf[cue[k]!]!]!;
        if (!span.matched) {
          span.start = token[k]!;
          span.matched = true;
        }
        span.end = token[k]! + 1;
      }
      return spans;
    },
  };
}

/** A hash of the K characters of `text` at `at`. Two different K-grams can have the same hash. */
function gramHash(text: string, at: number): number {
  let h = 0;
  for (let i = at; i < at + K; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}

/**
 * For each K-gram hash of the stream: the position of the K-gram when the
 * hash occurs once, else -1.
 */
function uniqueGrams(stream: string): Map<number, number> {
  const grams = new Map<number, number>();
  for (let i = 0; i + K <= stream.length; i++) {
    const h = gramHash(stream, i);
    grams.set(h, grams.has(h) ? -1 : i);
  }
  return grams;
}

/**
 * The region of the cue stream that a page shows, found with anchors.
 * Null when the page has too few anchors: it is not in the subtitles.
 */
function locate(page: string, stream: string, grams: ReadonlyMap<number, number>): Region | null {
  // The anchors in page order. A hash hit counts only when the text agrees.
  const cuePos: number[] = [];
  const pagePos: number[] = [];
  for (let j = 0; j + K <= page.length; j++) {
    const at = grams.get(gramHash(page, j));
    if (at !== undefined && at >= 0 && stream.startsWith(page.slice(j, j + K), at)) {
      cuePos.push(at);
      pagePos.push(j);
    }
  }
  // A chance hit breaks the order, so keep the longest chain that rises in
  // both. A chance hit in the chain is far from the median shift.
  const chain = risingChain(cuePos);
  if (chain.length < MIN_ANCHORS) return null;
  const shift = (k: number): number => cuePos[k]! - pagePos[k]!;
  const median = chain.map(shift).sort((x, y) => x - y)[chain.length >> 1]!;
  const limit = Math.max(SHIFT_LIMIT, page.length / 4);
  const kept = chain.filter((k) => Math.abs(shift(k) - median) <= limit);
  if (kept.length < MIN_ANCHORS) return null;
  // The page ends, projected along the shift of the first and the last anchor.
  const first = kept[0]!;
  const last = kept[kept.length - 1]!;
  return {
    from: Math.max(0, shift(first)),
    to: Math.min(stream.length, shift(last) + page.length),
  };
}

/** Map the cue characters of a region to the tokens of a page with a character diff. */
function mapRegion(stream: string, region: Region, page: Stream): PageMatch {
  const cue: number[] = [];
  const token: number[] = [];
  const ops = diff(stream.slice(region.from, region.to), page.chars);
  let a = region.from;
  let b = 0;
  ops.forEach(([op, text], i) => {
    if (op === diff.EQUAL) {
      if (text.length >= MIN_RUN || isLocalNoise(ops, i)) {
        for (let k = 0; k < text.length; k++) {
          cue.push(a + k);
          token.push(page.tokenOf[b + k]!);
        }
      }
      a += text.length;
      b += text.length;
    } else if (op === diff.DELETE) {
      a += text.length;
    } else {
      b += text.length;
    }
  });
  return { cue: Int32Array.from(cue), token: Int32Array.from(token) };
}

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
 * The indices of a longest chain of `values` that rises strictly, in index
 * order. Patience sorting: O(n log n).
 */
export function risingChain(values: ArrayLike<number>): number[] {
  /** ends[k] is the index of the smallest last value of a rising chain of length k + 1. */
  const ends = new Int32Array(values.length);
  /** before[i] is the index before i in the chain that ends at i, or -1. */
  const before = new Int32Array(values.length);
  let length = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    // Find the shortest chain whose last value is not below `value`. Most
    // values extend the longest chain, so try that first.
    let lo = length;
    if (length === 0 || values[ends[length - 1]!]! >= value) {
      lo = 0;
      let hi = length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (values[ends[mid]!]! < value) lo = mid + 1;
        else hi = mid;
      }
    }
    before[i] = lo > 0 ? ends[lo - 1]! : -1;
    ends[lo] = i;
    if (lo === length) length++;
  }
  const chain = new Array<number>(length);
  for (let k = length - 1, i = length > 0 ? ends[length - 1]! : -1; k >= 0; k--, i = before[i]!) {
    chain[k] = i;
  }
  return chain;
}

/**
 * The spans after `count` tokens go into the tokens at index `at`: each
 * matched span keeps its first and its last token. The reader reads the
 * pages after the current page first. A page before it then puts its tokens
 * in front of the tokens that the spans index, and without this shift the
 * spans point at other tokens until the next alignment. A span across `at`
 * also holds the new tokens. An unmatched span stays as it is.
 */
export function shiftSpans(spans: readonly TokenSpan[], at: number, count: number): TokenSpan[] {
  return spans.map((span) =>
    span.matched
      ? {
          start: span.start < at ? span.start : span.start + count,
          end: span.end <= at ? span.end : span.end + count,
          matched: true,
        }
      : span,
  );
}

/**
 * Align cues to tokens in one call. The tokens must be in page order, the
 * order that the reader keeps them in. The spans index `tokens`.
 */
export function alignCuesToTokens(
  cueTexts: readonly string[],
  tokens: readonly Pick<OcrToken, 'text' | 'page'>[],
): TokenSpan[] {
  const pages: Pick<OcrToken, 'text' | 'page'>[][] = [];
  tokens.forEach((t, i) => {
    if (i > 0 && t.page < tokens[i - 1]!.page) {
      throw new Error('alignCuesToTokens: the tokens are not in page order.');
    }
    (pages[t.page] ??= []).push(t);
  });
  return createAligner(cueTexts).spans(pages);
}
