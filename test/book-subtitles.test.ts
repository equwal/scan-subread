import { describe, expect, it } from 'vitest';
import { srtName, subtitlesOnOpen } from '../src/book-subtitles';

describe('srtName', () => {
  it('puts .srt in place of .pdf', () => {
    expect(srtName('sample-eng-2p.pdf')).toBe('sample-eng-2p.srt');
    expect(srtName('Neko.PDF')).toBe('Neko.srt');
    expect(srtName('吾輩は猫である.pdf')).toBe('吾輩は猫である.srt');
  });

  it('adds .srt to a name without .pdf at the end', () => {
    expect(srtName('book')).toBe('book.srt');
    expect(srtName('a.pdf.txt')).toBe('a.pdf.txt.srt');
  });
});

describe('subtitlesOnOpen', () => {
  const eng = 'sample-eng-2p.pdf|4053';
  const jpn = 'sample-jpn.pdf|20410';

  it('loads the saved subtitles of the book, else clears', () => {
    expect(subtitlesOnOpen(undefined, jpn, true)).toBe('load');
    expect(subtitlesOnOpen(undefined, jpn, false)).toBe('clear');
  });

  it('does not keep the subtitles of another book', () => {
    // The web finding: the cues of the English book stayed on the Japanese book.
    expect(subtitlesOnOpen(eng, jpn, false)).toBe('clear');
    expect(subtitlesOnOpen(eng, jpn, true)).toBe('load');
  });

  it('keeps subtitles that were loaded while no book was open, for the book that opens', () => {
    expect(subtitlesOnOpen(null, jpn, false)).toBe('keep');
    expect(subtitlesOnOpen(null, jpn, true)).toBe('keep');
  });

  it('keeps the subtitles of the same book', () => {
    expect(subtitlesOnOpen(jpn, jpn, true)).toBe('keep');
    expect(subtitlesOnOpen(jpn, jpn, false)).toBe('keep');
  });
});
