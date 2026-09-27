import { describe, expect, it } from 'vitest';
import { srtName } from '../src/book-subtitles';

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
