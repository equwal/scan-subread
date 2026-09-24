import { describe, expect, it } from 'vitest';
import { alignCues, alignCuesToTokens, buildStream, normalizeText, toTokenSpan } from '../src/align';

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
});

describe('alignCues', () => {
  it('maps exact text to exact spans', () => {
    const cues = ['thequick', 'brownfox', 'jumps'];
    const spans = alignCues(cues, cues.join(''));
    expect(spans).toEqual([
      { start: 0, end: 8, matched: true },
      { start: 8, end: 16, matched: true },
      { start: 16, end: 21, matched: true },
    ]);
  });

  it('tolerates OCR substitutions and drops', () => {
    // "rn" read as "m", "l" read as "1", one char lost.
    const cues = ['themorningsun', 'wasclearandbright'];
    const ocr = 'thernorningsun' + 'wasc1earandbrigt';
    const spans = alignCues(cues, ocr);
    expect(spans[0]).toEqual({ start: 0, end: 14, matched: true });
    expect(spans[1]).toEqual({ start: 14, end: 30, matched: true });
  });

  it('skips OCR text that no cue covers, such as a page header', () => {
    const cues = ['firstline', 'secondline'];
    const ocr = 'chapterone' + 'firstline' + 'pagenumber12' + 'secondline';
    const spans = alignCues(cues, ocr);
    expect(spans[0]).toEqual({ start: 10, end: 19, matched: true });
    expect(spans[1]).toEqual({ start: 31, end: 41, matched: true });
  });

  it('gives an unmatched cue a share of the gap between its neighbors', () => {
    const cues = ['abcdefgh', 'zzzzzzzz', 'ijklmnop'];
    const ocr = 'abcdefgh' + 'qqqqqqqq' + 'ijklmnop';
    const spans = alignCues(cues, ocr);
    expect(spans[1]).toEqual({ start: 8, end: 16, matched: false });
  });

  it('aligns Japanese text at character level with OCR noise', () => {
    const cues = ['吾輩は猫である', '名前はまだ無い', 'どこで生れたか'];
    // 猫 read as 描, one char doubled, one char lost.
    const ocr = '吾輩は描である' + '名前はまだだ無い' + 'どこで生れか';
    const spans = alignCues(cues, ocr);
    expect(spans[0]).toEqual({ start: 0, end: 7, matched: true });
    expect(spans[1]).toEqual({ start: 7, end: 15, matched: true });
    expect(spans[2]).toEqual({ start: 15, end: 21, matched: true });
  });

  it('returns empty spans for empty input', () => {
    expect(alignCues([], 'abc')).toEqual([]);
    expect(alignCues(['abc'], '')).toEqual([{ start: 0, end: 0, matched: false }]);
  });
});

describe('buildStream and toTokenSpan', () => {
  it('maps chars back to the tokens that hold them', () => {
    const stream = buildStream(['The', 'quick,', '—', 'fox']);
    expect(stream.chars).toBe('thequickfox');
    expect(stream.tokenOf).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 3, 3, 3]);
    expect(toTokenSpan({ start: 3, end: 11, matched: true }, stream)).toEqual({
      start: 1,
      end: 4,
      matched: true,
    });
  });

  it('points an empty span at the token at that position', () => {
    const stream = buildStream(['ab', 'cd']);
    expect(toTokenSpan({ start: 2, end: 2, matched: false }, stream)).toEqual({
      start: 1,
      end: 1,
      matched: false,
    });
  });
});

describe('alignCuesToTokens', () => {
  it('runs the full pipeline on word tokens with punctuation tokens', () => {
    const tokens = ['It', 'was', 'a', 'dark', 'and', 'stormy', 'night', '.', 'The', 'rain'].map(
      (text) => ({ text }),
    );
    const spans = alignCuesToTokens(['It was a dark', 'and stormy night.', 'The rain'], tokens);
    expect(spans).toEqual([
      { start: 0, end: 4, matched: true },
      { start: 4, end: 7, matched: true },
      { start: 8, end: 10, matched: true },
    ]);
  });

  it('works with one token per character, as for vertical Japanese', () => {
    const text = '春はあけぼの。やうやう白くなりゆく山ぎは';
    const tokens = [...text].map((ch) => ({ text: ch }));
    const spans = alignCuesToTokens(['春はあけぼの', 'やうやう白くなりゆく山ぎは'], tokens);
    expect(spans[0]).toEqual({ start: 0, end: 6, matched: true });
    expect(spans[1]).toEqual({ start: 7, end: 20, matched: true });
  });
});
