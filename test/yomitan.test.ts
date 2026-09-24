import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { glossaryText, openDictionaryZip, parseTermBank } from '../src/yomitan';
import { buildTestDictionaryZip, TEST_DICT_TERMS } from '../fixtures/test-dict';

describe('openDictionaryZip', () => {
  it('reads the index and the term banks in order', () => {
    const dict = openDictionaryZip(buildTestDictionaryZip());
    expect(dict.index).toEqual({ title: 'Test dictionary', revision: '2026-09-24' });
    expect(dict.termBanks).toEqual(['term_bank_1.json', 'term_bank_2.json']);
    const terms = dict.termBanks.flatMap((name) => dict.readTermBank(name));
    expect(terms).toHaveLength(TEST_DICT_TERMS.length);
    expect(terms[1]).toEqual({
      expression: '猫',
      reading: 'ねこ',
      rules: '',
      score: 50,
      glossary: ['cat'],
    });
  });

  it('flattens structured content and drops images', () => {
    const dict = openDictionaryZip(buildTestDictionaryZip());
    const miru = dict.readTermBank('term_bank_2.json').find((t) => t.expression === '見る');
    expect(miru).toMatchObject({ reading: 'みる', rules: 'v1' });
    expect(miru!.glossary).toEqual(['to see, to look, to watch to examine']);
  });

  it('sorts banks by number, not by name', () => {
    const zip = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'T', revision: '1' })),
      'term_bank_10.json': strToU8('[]'),
      'term_bank_2.json': strToU8('[]'),
      'tag_bank_1.json': strToU8('[]'),
    });
    expect(openDictionaryZip(zip).termBanks).toEqual(['term_bank_2.json', 'term_bank_10.json']);
  });

  it('rejects a zip without index.json', () => {
    const zip = zipSync({ 'term_bank_1.json': strToU8('[]') });
    expect(() => openDictionaryZip(zip)).toThrow(/index\.json/);
  });
});

describe('parseTermBank', () => {
  it('skips rows with a wrong shape', () => {
    const terms = parseTermBank([['a', 'b', '', '', 1, ['x'], 1, ''], 'junk', [42]]);
    expect(terms.map((t) => t.expression)).toEqual(['a']);
  });
});

describe('glossaryText', () => {
  it('handles strings, text objects, nested content and images', () => {
    expect(glossaryText('plain')).toBe('plain');
    expect(glossaryText({ type: 'text', text: 'txt' })).toBe('txt');
    expect(glossaryText({ type: 'image', path: 'a.png' })).toBe('');
    expect(
      glossaryText({
        type: 'structured-content',
        content: {
          tag: 'ul',
          content: [
            { tag: 'li', content: 'one' },
            { tag: 'li', content: 'two' },
          ],
        },
      }),
    ).toBe('one two');
  });
});
