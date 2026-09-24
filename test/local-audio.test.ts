import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  choices,
  dataUrl,
  mimeFor,
  uniqueWords,
  type LocalAudioEntry,
  type Word,
} from '../src/local-audio';

describe('mimeFor', () => {
  it('maps the known extensions', () => {
    expect(mimeFor('猫.mp3')).toBe('audio/mpeg');
    expect(mimeFor('a/b/猫.MP3')).toBe('audio/mpeg');
    expect(mimeFor('x.ogg')).toBe('audio/ogg');
    expect(mimeFor('x.opus')).toBe('audio/ogg');
  });

  it('falls back to octet-stream', () => {
    expect(mimeFor('x.wav')).toBe('application/octet-stream');
    expect(mimeFor('noext')).toBe('application/octet-stream');
    expect(mimeFor('')).toBe('application/octet-stream');
  });

  it('builds a data URL', () => {
    expect(dataUrl('x.opus', 'AAAA')).toBe('data:audio/ogg;base64,AAAA');
  });
});

describe('uniqueWords', () => {
  it('keeps the first of each expression+reading pair, in order', () => {
    const words: Word[] = [
      { expression: '猫', reading: 'ねこ' },
      { expression: '猫', reading: 'ねこ' },
      { expression: '猫', reading: '' },
      { expression: '吾輩', reading: 'わがはい' },
    ];
    expect(uniqueWords(words)).toEqual([
      { expression: '猫', reading: 'ねこ' },
      { expression: '猫', reading: '' },
      { expression: '吾輩', reading: 'わがはい' },
    ]);
  });

  it('is idempotent and keeps every pair', () => {
    const word = fc.record({ expression: fc.string(), reading: fc.string() });
    fc.assert(
      fc.property(fc.array(word), (words) => {
        const once = uniqueWords(words);
        expect(uniqueWords(once)).toEqual(once);
        const keys = new Set(words.map((w) => `${w.expression}\t${w.reading}`));
        expect(once).toHaveLength(keys.size);
      }),
    );
  });
});

describe('choices', () => {
  const entries: LocalAudioEntry[] = [
    { source: 'nhk16', speaker: null, display: 'NHK', file: 'nhk16/a.mp3' },
    { source: 'jpod', speaker: null, display: null, file: 'jpod/b.mp3' },
    { source: 'nhk16', speaker: null, display: 'NHK', file: 'nhk16/c.mp3' },
    { source: 'forvo', speaker: 'kaoring', display: '', file: 'forvo/d.opus' },
  ];

  it('gives one choice per source, first entry wins, display or source as label', () => {
    expect(choices(entries)).toEqual([
      { label: 'NHK', source: 'nhk16', file: 'nhk16/a.mp3' },
      { label: 'jpod', source: 'jpod', file: 'jpod/b.mp3' },
      { label: 'forvo', source: 'forvo', file: 'forvo/d.opus' },
    ]);
  });

  it('returns nothing for no entries', () => {
    expect(choices([])).toEqual([]);
  });

  it('never repeats a source and keeps the stored order', () => {
    const entry = fc.record({
      source: fc.constantFrom('a', 'b', 'c'),
      speaker: fc.option(fc.string(), { nil: null }),
      display: fc.option(fc.string(), { nil: null }),
      file: fc.string(),
    });
    fc.assert(
      fc.property(fc.array(entry), (rows) => {
        const out = choices(rows);
        const sources = out.map((c) => c.source);
        expect(new Set(sources).size).toBe(sources.length);
        const firstSeen = [...new Set(rows.map((r) => r.source))];
        expect(sources).toEqual(firstSeen);
      }),
    );
  });
});
