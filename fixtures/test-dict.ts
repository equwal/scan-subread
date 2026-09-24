// A tiny Yomitan-format dictionary that covers words of the sample-jpn
// fixture. test/yomitan.test.ts parses it. scripts/make-fixtures.ts
// writes it to fixtures/test-dict.zip for use on a phone.

import { strToU8, zipSync } from 'fflate';

export const TEST_DICT_INDEX = {
  title: 'Test dictionary',
  revision: '2026-09-24',
  format: 3,
  sequenced: true,
};

/** Rows in Yomitan term bank order: expression, reading, definitionTags, rules, score, glossary, sequence, termTags. */
export const TEST_DICT_TERMS: unknown[][] = [
  ['吾輩', 'わがはい', 'pn', '', 10, ['I, me (archaic, pompous)'], 1, ''],
  ['猫', 'ねこ', 'n', '', 50, ['cat'], 2, ''],
  ['名前', 'なまえ', 'n', '', 50, ['name'], 3, ''],
  ['無い', 'ない', 'adj-i', 'adj-i', 40, ['nonexistent, not being (there)'], 4, ''],
  ['生れる', 'うまれる', 'v1', 'v1', 30, ['to be born'], 5, ''],
  ['見当', 'けんとう', 'n', '', 20, ['estimate, guess', 'aim, direction'], 6, ''],
  ['薄暗い', 'うすぐらい', 'adj-i', 'adj-i', 20, ['dim, gloomy'], 7, ''],
  ['泣く', 'なく', 'v5', 'v5', 40, ['to cry, to weep'], 8, ''],
  ['記憶', 'きおく', 'n vs', 'vs', 40, ['memory, recollection'], 9, ''],
  ['人間', 'にんげん', 'n', '', 50, ['human being, person'], 10, ''],
  [
    '見る',
    'みる',
    'v1',
    'v1',
    50,
    [
      {
        type: 'structured-content',
        content: [
          { tag: 'div', content: [{ tag: 'span', content: 'to see, to look, to watch' }] },
          { tag: 'div', content: 'to examine' },
          { tag: 'img', path: 'img/eye.png' },
        ],
      },
    ],
    11,
    '',
  ],
  ['聞く', 'きく', 'v5', 'v5', 50, ['to hear, to listen', 'to ask'], 12, ''],
  [
    '書生',
    'しょせい',
    'n',
    '',
    10,
    ['student (esp. one who lives in the home of a teacher)'],
    13,
    '',
  ],
];

/** The dictionary as a zip, as Yomitan would export it. */
export function buildTestDictionaryZip(): Uint8Array {
  return zipSync({
    'index.json': strToU8(JSON.stringify(TEST_DICT_INDEX)),
    'term_bank_1.json': strToU8(JSON.stringify(TEST_DICT_TERMS.slice(0, 7))),
    'term_bank_2.json': strToU8(JSON.stringify(TEST_DICT_TERMS.slice(7))),
  });
}
