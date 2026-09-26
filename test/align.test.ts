import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alignCuesToTokens, buildStream, createAligner, normalizeText } from '../src/align';
import { ENG2 } from '../fixtures/sample-text';
import { books, char, grams, pagesOfCue, readPages, type Token } from './book';

/** One token for each character of `text`, all on `page`. */
function tokensOf(text: string, page = 0): Token[] {
  return [...text].map((ch) => ({ text: ch, page }));
}

/** The opening of A Tale of Two Cities, as cues. */
const TWO_CITIES = [
  'It was the best of times,',
  'it was the worst of times,',
  'it was the age of wisdom,',
  'it was the age of foolishness,',
  'it was the epoch of belief,',
  'it was the epoch of incredulity,',
  'it was the season of Light,',
  'it was the season of Darkness,',
];

describe('normalizeText', () => {
  it('drops spaces and punctuation and folds case', () => {
    expect(normalizeText('Hello, World!  ')).toBe('helloworld');
  });

  it('folds full-width forms with NFKC', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('abc123');
  });

  it('keeps kana, kanji and the long vowel mark', () => {
    expect(normalizeText('コーヒーを飲む。')).toBe('コーヒーを飲む');
  });

  it('gives a stable result when case folding moves combining marks', () => {
    // fast-check found these inputs. The case map and the filter left the
    // combining marks out of canonical order, so a second pass changed the text.
    for (const s of ['\u{1D157}\u{1D165}\u{FC5E}', '\u{130}\u{1D15E}']) {
      const once = normalizeText(s);
      expect(normalizeText(once)).toBe(once);
    }
  });
});

describe('alignCuesToTokens on one page', () => {
  it('maps exact text to exact spans', () => {
    const cues = ['thequick', 'brownfox', 'jumps'];
    expect(alignCuesToTokens(cues, tokensOf(cues.join('')))).toEqual([
      { start: 0, end: 8, matched: true },
      { start: 8, end: 16, matched: true },
      { start: 16, end: 21, matched: true },
    ]);
  });

  it('tolerates OCR substitutions and drops', () => {
    // "rn" read as "m", "l" read as "1", one char lost.
    const cues = ['themorningsun', 'wasclearandbright'];
    const spans = alignCuesToTokens(cues, tokensOf('thernorningsun' + 'wasc1earandbrigt'));
    expect(spans[0]).toEqual({ start: 0, end: 14, matched: true });
    expect(spans[1]).toEqual({ start: 14, end: 30, matched: true });
  });

  it('skips OCR text that no cue covers, such as a page header', () => {
    const cues = ['firstline', 'secondline'];
    const spans = alignCuesToTokens(
      cues,
      tokensOf('chapterone' + 'firstline' + 'pagenumber12' + 'secondline'),
    );
    expect(spans[0]).toEqual({ start: 10, end: 19, matched: true });
    expect(spans[1]).toEqual({ start: 31, end: 41, matched: true });
  });

  it('leaves a cue that is not on the page unmatched, with an empty span', () => {
    const cues = ['abcdefgh', 'zzzzzzzz', 'ijklmnop'];
    const spans = alignCuesToTokens(cues, tokensOf('abcdefgh' + 'qqqqqqqq' + 'ijklmnop'));
    expect(spans).toEqual([
      { start: 0, end: 8, matched: true },
      { start: 0, end: 0, matched: false },
      { start: 16, end: 24, matched: true },
    ]);
  });

  it('aligns Japanese text at character level with OCR noise', () => {
    const cues = ['吾輩は猫である', '名前はまだ無い', 'どこで生れたか'];
    // 猫 read as 描, one char doubled, one char lost.
    const spans = alignCuesToTokens(
      cues,
      tokensOf('吾輩は描である' + '名前はまだだ無い' + 'どこで生れか'),
    );
    expect(spans[0]).toEqual({ start: 0, end: 7, matched: true });
    expect(spans[1]).toEqual({ start: 7, end: 15, matched: true });
    expect(spans[2]).toEqual({ start: 15, end: 21, matched: true });
  });

  it('returns empty spans for empty input', () => {
    expect(alignCuesToTokens([], tokensOf('abc'))).toEqual([]);
    expect(alignCuesToTokens(['abc'], [])).toEqual([{ start: 0, end: 0, matched: false }]);
  });

  it('runs the full pipeline on word tokens with punctuation tokens', () => {
    const tokens = ['It', 'was', 'a', 'dark', 'and', 'stormy', 'night', '.', 'The', 'rain'].map(
      (text) => ({ text, page: 0 }),
    );
    const spans = alignCuesToTokens(['It was a dark', 'and stormy night.', 'The rain'], tokens);
    expect(spans).toEqual([
      { start: 0, end: 4, matched: true },
      { start: 4, end: 7, matched: true },
      { start: 8, end: 10, matched: true },
    ]);
  });

  it('works with one token per character, as for vertical Japanese', () => {
    const spans = alignCuesToTokens(
      ['春はあけぼの', 'やうやう白くなりゆく山ぎは'],
      tokensOf('春はあけぼの。やうやう白くなりゆく山ぎは'),
    );
    expect(spans[0]).toEqual({ start: 0, end: 6, matched: true });
    expect(spans[1]).toEqual({ start: 7, end: 20, matched: true });
  });

  it('refuses tokens that are not in page order', () => {
    const tokens = [
      { text: 'a', page: 1 },
      { text: 'b', page: 0 },
    ];
    expect(() => alignCuesToTokens(['ab'], tokens)).toThrow(/page order/);
  });
});

describe('buildStream', () => {
  it('maps chars back to the tokens that hold them', () => {
    const stream = buildStream(['The', 'quick,', '—', 'fox']);
    expect(stream.chars).toBe('thequickfox');
    expect(stream.tokenOf).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 3, 3, 3]);
  });
});

describe('createAligner', () => {
  const text = normalizeText(TWO_CITIES.join(''));
  const cues = text.match(/.{1,20}/g)!;

  it('indexes the tokens of the read pages, joined in page order', () => {
    const pages = [tokensOf(text.slice(0, 60), 0), undefined, tokensOf(text.slice(60), 2)];
    const spans = createAligner(cues).spans(pages);
    expect(spans.map((s) => s.matched)).toEqual(cues.map(() => true));
    expect(spans[0]).toEqual({ start: 0, end: 20, matched: true });
    expect(spans[3]).toEqual({ start: 60, end: 80, matched: true });
  });

  it('leaves the cues of an unread page unmatched', () => {
    const pages = [undefined, undefined, tokensOf(text.slice(60), 2)];
    const spans = createAligner(cues).spans(pages);
    expect(spans.slice(0, 3).map((s) => s.matched)).toEqual([false, false, false]);
    expect(spans[3]).toEqual({ start: 0, end: 20, matched: true });
  });

  it('matches no cue of subtitles for another text (regression)', () => {
    // The opening of A Tale of Two Cities over the two pages of the
    // sample-eng-2p fixture. The texts share no 8-character run, so no
    // page has an anchor. One diff of all cues matched every cue on chance
    // runs of two characters.
    const pages = ENG2.pages.map((lines, p) => tokensOf(lines.join(' '), p));
    const pageGrams = grams(ENG2.pages.flat().join(''));
    expect([...grams(TWO_CITIES.join(''))].filter((g) => pageGrams.has(g))).toEqual([]);

    const spans = alignCuesToTokens(TWO_CITIES, pages.flat());
    expect(spans.filter((s) => s.matched)).toEqual([]);
  });

  it('matches no cue to a wrong page when only 3 pages in the middle are read (regression)', () => {
    // The measured defect in small form: a book of 20 pages with 5% OCR
    // noise, and only pages 9 to 11 read. One diff of all cues against
    // those pages matched cues to wrong places.
    const [book] = fc.sample(
      books({ cues: [220, 220], cueLength: [15, 40], pageLength: [300, 300], noise: 0.05 }),
      { seed: 3, numRuns: 1 },
    );
    const read = book!.pages.map((_, p) => p >= 9 && p <= 11);
    const pages = readPages(book!, read);
    const tokens = pages.flatMap((p) => p ?? []);
    const spans = alignCuesToTokens(book!.cues, tokens);

    const wrong: number[] = [];
    const missed: number[] = [];
    book!.cues.forEach((_, i) => {
      const own = pagesOfCue(book!, i);
      const span = spans[i]!;
      const onOwnPages = tokens.slice(span.start, span.end).every((t) => own.has(t.page));
      if (span.matched && !onOwnPages) wrong.push(i);
      if ([...own].every((p) => read[p]) && !(span.matched && onOwnPages)) missed.push(i);
    });
    expect(wrong).toEqual([]);
    expect(missed).toEqual([]);
  });
});

describe('createAligner speed', () => {
  it('aligns a book of 300 000 characters in under 3 s, and one more page in under 100 ms', () => {
    const LENGTH = 300_000;
    const PAGE = 600;
    // 5% noise: 3 codes in 60 are a drop, a substitution and an insertion.
    const codes = [...'k'.repeat(57), 'd', 's', 'i'];
    const [sample] = fc.sample(
      fc.tuple(
        fc.string({ unit: char, minLength: LENGTH, maxLength: LENGTH }),
        fc.string({ unit: fc.constantFrom(...codes), minLength: LENGTH, maxLength: LENGTH }),
      ),
      { seed: 1, numRuns: 1 },
    );
    const [text, noise] = sample!;
    const cues = text.match(/.{1,40}/g)!;
    const pages: Token[][] = [];
    for (let i = 0; i < LENGTH; i++) {
      const page = Math.floor(i / PAGE);
      const tokens = (pages[page] ??= []);
      const ch = text[i]!;
      const other = text[(i + 1) % LENGTH]!;
      if (noise[i] === 's') tokens.push({ text: other, page });
      else if (noise[i] === 'i') tokens.push({ text: other, page }, { text: ch, page });
      else if (noise[i] !== 'd') tokens.push({ text: ch, page });
    }

    let t = performance.now();
    const aligner = createAligner(cues);
    const spans = aligner.spans(pages);
    const all = performance.now() - t;
    // Read one page again: a new token array, as after a change of the OCR language.
    pages[250] = [...pages[250]!];
    t = performance.now();
    aligner.spans(pages);
    const one = performance.now() - t;

    expect(spans.filter((s) => s.matched).length).toBeGreaterThanOrEqual(0.99 * cues.length);
    expect(all).toBeLessThan(3000);
    expect(one).toBeLessThan(100);
  }, 30_000);
});
