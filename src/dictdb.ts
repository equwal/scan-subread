// Dictionary storage in IndexedDB, through `idb`. Thin browser layer.
//
// Store `dictionaries`: one row per imported dictionary.
// Store `terms`: one row per term, with indexes on expression, reading
// and dictionary id. Terms persist across app restarts.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TermFinder } from './lookup';
import { openDictionaryZip, type DictTerm } from './yomitan';

export interface DictionaryRow {
  id: number;
  title: string;
  revision: string;
  termCount: number;
}

interface TermRow extends DictTerm {
  dict: number;
}

interface Schema extends DBSchema {
  dictionaries: { key: number; value: DictionaryRow; indexes: { title: string } };
  terms: {
    key: number;
    value: TermRow;
    indexes: { expression: string; reading: string; dict: number };
  };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('scan-subread', 1, {
    upgrade(d) {
      const dicts = d.createObjectStore('dictionaries', { keyPath: 'id', autoIncrement: true });
      dicts.createIndex('title', 'title');
      const terms = d.createObjectStore('terms', { autoIncrement: true });
      terms.createIndex('expression', 'expression');
      terms.createIndex('reading', 'reading');
      terms.createIndex('dict', 'dict');
    },
  });
  return dbPromise;
}

export async function listDictionaries(): Promise<DictionaryRow[]> {
  return (await db()).getAll('dictionaries');
}

/**
 * Import one Yomitan dictionary zip. One term bank is parsed and written
 * per transaction, so memory holds one bank at a time. `onProgress` gets
 * a status line after each bank.
 */
export async function importDictionary(
  zip: Uint8Array,
  onProgress: (status: string) => void,
): Promise<DictionaryRow> {
  const dict = openDictionaryZip(zip);
  const d = await db();
  const { title, revision } = dict.index;
  if (await d.getFromIndex('dictionaries', 'title', title)) {
    throw new Error(`"${title}" is already imported. Delete it first to import it again.`);
  }
  // The store fills in `id`, so the row goes in without it.
  const id = await d.add('dictionaries', { title, revision, termCount: 0 } as DictionaryRow);
  let termCount = 0;
  for (let i = 0; i < dict.termBanks.length; i++) {
    onProgress(
      `Importing ${title}: bank ${i + 1} of ${dict.termBanks.length}, ${termCount} terms...`,
    );
    const terms = dict.readTermBank(dict.termBanks[i]!);
    const tx = d.transaction('terms', 'readwrite');
    for (const term of terms) void tx.store.add({ ...term, dict: id });
    await tx.done;
    termCount += terms.length;
  }
  const row: DictionaryRow = { id, title, revision, termCount };
  await d.put('dictionaries', row);
  return row;
}

/** Delete a dictionary and all its terms. */
export async function deleteDictionary(id: number): Promise<void> {
  const d = await db();
  const tx = d.transaction(['terms', 'dictionaries'], 'readwrite');
  let cursor = await tx.objectStore('terms').index('dict').openKeyCursor(id);
  while (cursor) {
    await tx.objectStore('terms').delete(cursor.primaryKey);
    cursor = await cursor.continue();
  }
  await tx.objectStore('dictionaries').delete(id);
  await tx.done;
}

/** Terms whose expression or reading equals the key, with the dictionary title. */
export interface FoundTerm extends DictTerm {
  dictTitle: string;
}

/** A finder over the stored terms. Titles are read once at creation. */
export async function storedFinder(): Promise<TermFinder<FoundTerm>> {
  const d = await db();
  const titles = new Map((await d.getAll('dictionaries')).map((r) => [r.id, r.title]));
  return async (key) => {
    const [byExpression, byReading] = await Promise.all([
      d.getAllFromIndex('terms', 'expression', key),
      d.getAllFromIndex('terms', 'reading', key),
    ]);
    const rows = [...byExpression, ...byReading.filter((r) => r.expression !== key)];
    return rows.map((r): FoundTerm => ({ ...r, dictTitle: titles.get(r.dict) ?? '' }));
  };
}
