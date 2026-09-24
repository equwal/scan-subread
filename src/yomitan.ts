// Yomitan dictionary zip reader. Pure: no DOM, no database.
//
// A Yomitan dictionary is a zip with `index.json` and `term_bank_N.json`
// files. Each term bank is an array of rows:
//   [expression, reading, definitionTags, rules, score, glossary, sequence, termTags]
// A glossary entry is a string, a structured-content object, an image
// object, or a text object. This module keeps plain text only.
//
// The zip is read one entry at a time, so a large dictionary does not
// need all its banks in memory at once.

import { unzipSync } from 'fflate';

export interface DictIndex {
  title: string;
  revision: string;
}

/** One dictionary term as stored and looked up. */
export interface DictTerm {
  expression: string;
  reading: string;
  /** Space-separated part-of-speech rules: "v1", "v5", "adj-i", ... */
  rules: string;
  score: number;
  glossary: string[];
}

/** Names of the entries in a zip. */
export function listZipEntries(zip: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(zip, {
    filter: (file) => {
      names.push(file.name);
      return false;
    },
  });
  return names;
}

/** Decompress one entry of a zip. */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array {
  const files = unzipSync(zip, { filter: (file) => file.name === name });
  const data = files[name];
  if (!data) throw new Error(`Zip entry not found: ${name}`);
  return data;
}

function readJson(zip: Uint8Array, name: string): unknown {
  return JSON.parse(new TextDecoder().decode(readZipEntry(zip, name)));
}

/** Parse `index.json`. */
export function parseIndex(json: unknown): DictIndex {
  if (typeof json !== 'object' || json === null) throw new Error('index.json is not an object');
  const { title, revision } = json as Record<string, unknown>;
  if (typeof title !== 'string' || title.length === 0) throw new Error('index.json has no title');
  return { title, revision: typeof revision === 'string' ? revision : '' };
}

/** Parse one term bank. Rows with a wrong shape are skipped. */
export function parseTermBank(json: unknown): DictTerm[] {
  if (!Array.isArray(json)) throw new Error('term bank is not an array');
  const terms: DictTerm[] = [];
  for (const row of json) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    const expression = row[0];
    const reading = typeof row[1] === 'string' ? row[1] : '';
    const rules = typeof row[3] === 'string' ? row[3] : '';
    const score = typeof row[4] === 'number' ? row[4] : 0;
    const glossary = Array.isArray(row[5]) ? row[5].map(glossaryText).filter((s) => s !== '') : [];
    terms.push({ expression, reading, rules, score, glossary });
  }
  return terms;
}

/** Plain text of one glossary entry. Images give an empty string. */
export function glossaryText(entry: unknown): string {
  return contentText(entry).replace(/\s+/g, ' ').trim();
}

/** Tags whose content starts a new line in plain text. */
const BLOCK_TAGS = new Set(['div', 'p', 'li', 'br', 'tr', 'ul', 'ol', 'details', 'summary']);

function contentText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(contentText).join('');
  if (typeof node !== 'object' || node === null) return '';
  const obj = node as Record<string, unknown>;
  if (obj['type'] === 'image' || obj['tag'] === 'img') return '';
  if (obj['type'] === 'text') return typeof obj['text'] === 'string' ? obj['text'] : '';
  const inner = contentText(obj['content']);
  return typeof obj['tag'] === 'string' && BLOCK_TAGS.has(obj['tag']) ? ` ${inner} ` : inner;
}

/** A parsed dictionary: its index and a reader for each term bank. */
export interface DictionaryZip {
  index: DictIndex;
  /** Term bank entry names in numeric order. */
  termBanks: string[];
  readTermBank(name: string): DictTerm[];
}

const TERM_BANK = /^term_bank_(\d+)\.json$/;

/** Open a Yomitan dictionary zip. Banks are read on demand. */
export function openDictionaryZip(zip: Uint8Array): DictionaryZip {
  const names = listZipEntries(zip);
  if (!names.includes('index.json')) throw new Error('Not a Yomitan dictionary: no index.json');
  const index = parseIndex(readJson(zip, 'index.json'));
  const termBanks = names
    .filter((n) => TERM_BANK.test(n))
    .sort((a, b) => Number(TERM_BANK.exec(a)![1]) - Number(TERM_BANK.exec(b)![1]));
  return {
    index,
    termBanks,
    readTermBank: (name) => parseTermBank(readJson(zip, name)),
  };
}
