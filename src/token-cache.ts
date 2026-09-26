// The tokens of each page, and the subtitles of each book, in IndexedDB.
// Thin browser layer.
//
// OCR is slow, so a page is read once. The key names the file, the page,
// the OCR language and the source (text layer or OCR). The subtitles that
// SubRead made are kept under the key of the PDF.
//
// The reader does not need the cache. When IndexedDB fails, a read finds
// nothing, a write does nothing, and one warning goes to the console.

import { openDB, unwrap, type DBSchema, type IDBPDatabase } from 'idb';
import type { OcrToken } from './align';

export type TextSource = 'text' | 'ocr';

export interface PageEntry {
  tokens: OcrToken[];
  /** Size of the page in pixels, the space of the boxes. */
  width: number;
  height: number;
  source: TextSource;
}

interface Schema extends DBSchema {
  pages: { key: string; value: PageEntry };
  srt: { key: string; value: string };
}

const DB_NAME = 'scan-subread';

/**
 * Earlier builds of the app made version 1 of this database with the
 * stores of their dictionary. Version 2 makes sure that the stores of
 * this schema are there, and deletes the old stores.
 */
const DB_VERSION = 2;
const STORES = ['pages', 'srt'] as const;
const OLD_STORES = ['dictionaries', 'terms'];

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;
let warned = false;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // The typed database knows only the stores of the schema.
      const raw = unwrap(database);
      for (const name of OLD_STORES) {
        if (raw.objectStoreNames.contains(name)) raw.deleteObjectStore(name);
      }
      for (const name of STORES) {
        if (!raw.objectStoreNames.contains(name)) raw.createObjectStore(name);
      }
    },
  });
  return dbPromise;
}

/** Runs `op` on the database. Gives undefined when IndexedDB fails, and warns once. */
async function tryDb<T>(op: (d: IDBPDatabase<Schema>) => Promise<T>): Promise<T | undefined> {
  try {
    return await op(await db());
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('The page cache is off: IndexedDB failed.', err);
    }
    return undefined;
  }
}

type FileId = Pick<File, 'name' | 'size'>;

/** The key of a book: the file name and size. */
export function bookKey(file: FileId): string {
  return `${file.name}|${file.size}`;
}

export function pageKey(file: FileId, page: number, lang: string, source: TextSource): string {
  return `${bookKey(file)}|${page}|${lang}|${source}`;
}

export function getPage(key: string): Promise<PageEntry | undefined> {
  return tryDb((d) => d.get('pages', key));
}

export async function putPage(key: string, entry: PageEntry): Promise<void> {
  await tryDb((d) => d.put('pages', entry, key));
}

export async function clearPages(): Promise<void> {
  await tryDb((d) => d.clear('pages'));
}

export function getSrt(key: string): Promise<string | undefined> {
  return tryDb((d) => d.get('srt', key));
}

export async function putSrt(key: string, srt: string): Promise<void> {
  await tryDb((d) => d.put('srt', srt, key));
}
