import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  keepMakeStatus,
  resultName,
  srtName,
  subreadConcerns,
  subtitlesOnOpen,
} from '../src/book-subtitles';

describe('keepMakeStatus', () => {
  it('removes the SubRead result of the book before', () => {
    // The finding: "15 cues, language en, 97% ..." of book A stayed in the
    // menu when book B opened.
    expect(keepMakeStatus('B', null, null)).toBe(false);
  });

  it('removes the wait of the book before: its job does not start', () => {
    expect(keepMakeStatus('B', null, 'A')).toBe(false);
  });

  it('keeps the status of the job that runs: it tells why the button is off', () => {
    expect(keepMakeStatus('B', 'A', null)).toBe(true);
    expect(keepMakeStatus('A', 'A', null)).toBe(true);
  });

  it('keeps the wait of the book that opens again', () => {
    expect(keepMakeStatus('A', null, 'A')).toBe(true);
  });
});

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

describe('resultName', () => {
  it('is the FNV-1a hash of the book key', () => {
    // The test vectors of FNV-1a (32 bit).
    expect(resultName('')).toBe('subread-811c9dc5.srt');
    expect(resultName('a')).toBe('subread-e40c292c.srt');
    expect(resultName('foobar')).toBe('subread-bf9cf968.srt');
  });

  it('tells apart two Japanese books that the plugin would both call "_"', () => {
    const neko = resultName('吾輩は猫である.pdf|204800');
    const botchan = resultName('坊っちゃん.pdf|204800');
    expect(neko).not.toBe(botchan);
    expect(resultName('吾輩は猫である.pdf|204801')).not.toBe(neko);
  });

  it('gives a name that the plugin keeps as it is, the same for the same key', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (key) => {
        const name = resultName(key);
        expect(name).toMatch(/^subread-[0-9a-f]{8}\.srt$/);
        expect(resultName(key)).toBe(name);
      }),
    );
  });
});

describe('subreadConcerns', () => {
  const file = { name: 'sample-eng-2p.srt', source: 'file' as const };

  it('asks for the phone case: no speech, language km, match rate 1, over a loaded file', () => {
    expect(
      subreadConcerns({
        requested: 'auto',
        ocrLang: 'eng',
        language: 'km',
        matchRate: 1,
        loaded: file,
      }),
    ).toEqual([
      'They replace sample-eng-2p.srt, the subtitles that you loaded.',
      'SubRead found the language "km", not "en".',
    ]);
  });

  it('loads at once a good result over no subtitles or over an earlier SubRead result', () => {
    const good = { requested: 'auto', ocrLang: 'jpn', language: 'ja', matchRate: 0.97 };
    expect(subreadConcerns(good)).toEqual([]);
    const earlier = { name: 'neko.srt', source: 'subread' as const };
    expect(subreadConcerns({ ...good, loaded: earlier })).toEqual([]);
  });

  it('compares the found language with the requested one', () => {
    expect(subreadConcerns({ requested: 'ja', ocrLang: 'eng', language: 'ja' })).toEqual([]);
    expect(subreadConcerns({ requested: 'ja', ocrLang: 'jpn', language: 'en' })).toEqual([
      'SubRead found the language "en", not "ja".',
    ]);
  });

  it('takes the language of the book from the OCR language when the request is auto', () => {
    const both = { requested: 'auto', ocrLang: 'jpn+eng' };
    expect(subreadConcerns({ ...both, language: 'en' })).toEqual([]);
    expect(subreadConcerns({ ...both, language: 'ja' })).toEqual([]);
    expect(subreadConcerns({ ...both, language: 'km' })).toEqual([
      'SubRead found the language "km", not "ja" or "en".',
    ]);
    const vertical = { requested: 'auto', ocrLang: 'jpn_vert', language: 'ja' };
    expect(subreadConcerns(vertical)).toEqual([]);
    expect(subreadConcerns({ requested: 'auto', ocrLang: 'eng', language: 'en-US' })).toEqual([]);
  });

  it('does not ask about a language or a match rate that SubRead does not tell', () => {
    expect(subreadConcerns({ requested: 'ja', ocrLang: 'jpn', language: null })).toEqual([]);
    expect(subreadConcerns({ requested: 'ja', ocrLang: 'jpn', language: '' })).toEqual([]);
    expect(subreadConcerns({ requested: 'ja', ocrLang: 'jpn', matchRate: -1 })).toEqual([]);
  });

  it('asks when less than 80% of the lines are found in the book', () => {
    expect(subreadConcerns({ requested: 'en', ocrLang: 'eng', matchRate: 0.42 })).toEqual([
      'SubRead found only 42% of the lines in the book.',
    ]);
    expect(subreadConcerns({ requested: 'en', ocrLang: 'eng', matchRate: 0.8 })).toEqual([]);
  });
});
