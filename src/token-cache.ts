// What the reader keeps in IndexedDB. Thin browser layer.
//
// - "pages": the tokens of each page. OCR is slow, so a page is read once.
//   The key names the file, the page, the OCR language and the source (text
//   layer or OCR).
// - "books": a copy of the last book, under the key "last". Android can stop
//   the reader while the user is in the dictionary or in the player, and a
//   reload forgets the file that the user opened.
// - "meta": for each book, the page that was open, the subtitles and the
//   "Force OCR" setting.
//
// The reader does not need IndexedDB. When IndexedDB fails, a read finds
// nothing, a write does nothing, and one warning goes to the console. No
// function throws.

import {
  openDB,
  unwrap,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type { OcrToken } from './align';

export type TextSource = 'text' | 'ocr';

export interface PageEntry {
  tokens: OcrToken[];
  /** Size of the page in pixels, the space of the boxes. */
  width: number;
  height: number;
  source: TextSource;
}

/** The subtitles of a book. */
export interface BookSubtitles {
  /** The file name, for example "book.srt". */
  name: string;
  /** The text of the subtitle file. */
  text: string;
  /** A file that the user loaded, or the result of SubRead. */
  source: 'file' | 'subread';
}

/** What the reader keeps for a book, other than its pages. */
export interface BookMeta {
  /** The page that was open. 0 is the first page. */
  page?: number;
  subtitles?: BookSubtitles;
  /** The "Force OCR" setting for the book. */
  forceOcr?: boolean;
}

/** The record of the last book. */
interface LastBook {
  /** See bookKey. */
  key: string;
  name: string;
  /** The MIME type of the file. */
  type: string;
  blob: Blob;
}

interface Schema extends DBSchema {
  pages: { key: string; value: PageEntry };
  books: { key: string; value: LastBook };
  meta: { key: string; value: BookMeta };
  /** Only in version 2. The upgrade to version 3 moves the subtitles to "meta". */
  srt: { key: string; value: string };
}

const DB_NAME = 'scan-subread';

/**
 * Version 1: earlier builds kept the stores of their dictionary.
 * Version 2: "pages" and "srt". The upgrade deletes the stores of the
 * dictionary.
 * Version 3: "pages", "books" and "meta". The upgrade moves each text of
 * "srt" to "meta", and deletes "srt".
 */
const DB_VERSION = 3;
const STORES = ['pages', 'books', 'meta'] as const;
const OLD_STORES = ['dictionaries', 'terms'];

/** The key of the one record in "books". */
const LAST = 'last';

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;
let warned = false;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    async upgrade(database, _oldVersion, _newVersion, transaction) {
      // The typed database knows only the stores of the schema.
      const raw = unwrap(database);
      for (const name of OLD_STORES) {
        if (raw.objectStoreNames.contains(name)) raw.deleteObjectStore(name);
      }
      for (const name of STORES) {
        if (!raw.objectStoreNames.contains(name)) raw.createObjectStore(name);
      }
      if (raw.objectStoreNames.contains('srt')) {
        await moveSrtToMeta(transaction);
        raw.deleteObjectStore('srt');
      }
    },
  });
  return dbPromise;
}

/** Copies each text of "srt" to "meta", as subtitles from SubRead. */
async function moveSrtToMeta(
  transaction: IDBPTransaction<Schema, StoreNames<Schema>[], 'versionchange'>,
): Promise<void> {
  const meta = transaction.objectStore('meta');
  let cursor = await transaction.objectStore('srt').openCursor();
  while (cursor) {
    await meta.put({ subtitles: subreadSubtitles(cursor.key, cursor.value) }, cursor.key);
    cursor = await cursor.continue();
  }
}

/** Subtitles from SubRead for the book `key`. "book.pdf|123" gives the name "book.srt". */
function subreadSubtitles(key: string, text: string): BookSubtitles {
  const bar = key.lastIndexOf('|');
  const file = bar < 0 ? key : key.slice(0, bar);
  return { name: `${file.replace(/\.pdf$/i, '')}.srt`, text, source: 'subread' };
}

/** Runs `op` on the database. Gives undefined when IndexedDB fails, and warns once. */
async function tryDb<T>(op: (d: IDBPDatabase<Schema>) => Promise<T>): Promise<T | undefined> {
  try {
    return await op(await db());
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('IndexedDB failed. The reader continues without it.', err);
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

/** Removes the pages of the book `key` (see bookKey). Without a key, removes all pages. */
export async function clearPages(key?: string): Promise<void> {
  await tryDb((d) =>
    key === undefined
      ? d.clear('pages')
      : // "}" follows "|" in the order of the code units. So this range holds
        // each key that starts with `${key}|`, and no other key.
        d.delete('pages', IDBKeyRange.bound(`${key}|`, `${key}}`, false, true)),
  );
}

/**
 * Keeps a copy of `file` as the last book, in place of the book before it.
 * Gives false when IndexedDB fails, for example when the file is larger than
 * the free quota.
 */
export async function putLastBook(file: File): Promise<boolean> {
  const record: LastBook = { key: bookKey(file), name: file.name, type: file.type, blob: file };
  const done = await tryDb(async (d) => {
    await d.put('books', record, LAST);
    return true;
  });
  return done === true;
}

/** The last book, or undefined when there is no last book or IndexedDB fails. */
export function getLastBook(): Promise<File | undefined> {
  return tryDb(async (d) => {
    const book = await d.get('books', LAST);
    return book && new File([book.blob], book.name, { type: book.type });
  });
}

/** What the reader keeps for the book `key`. An empty object when there is nothing, or IndexedDB fails. */
export async function getMeta(key: string): Promise<BookMeta> {
  return (await tryDb((d) => d.get('meta', key))) ?? {};
}

/**
 * Merges `patch` into what the reader keeps for the book `key`. A field that
 * is undefined in `patch` is removed.
 */
export async function putMeta(key: string, patch: Partial<BookMeta>): Promise<void> {
  await tryDb((d) => {
    // One transaction reads and writes, so two merges at the same time keep
    // the fields of both.
    const tx = d.transaction('meta', 'readwrite');
    const merge = async (): Promise<void> => {
      const meta: BookMeta = { ...(await tx.store.get(key)), ...patch };
      for (const field of Object.keys(patch) as (keyof BookMeta)[]) {
        if (patch[field] === undefined) delete meta[field];
      }
      await tx.store.put(meta, key);
    };
    return Promise.all([merge(), tx.done]);
  });
}

/**
 * The text of the subtitles of the book `key`.
 * @deprecated Use getMeta. The next change of main.ts removes this function.
 */
export async function getSrt(key: string): Promise<string | undefined> {
  return (await getMeta(key)).subtitles?.text;
}

/**
 * Keeps the subtitles that SubRead made for the book `key`.
 * @deprecated Use putMeta. The next change of main.ts removes this function.
 */
export async function putSrt(key: string, srt: string): Promise<void> {
  await putMeta(key, { subtitles: subreadSubtitles(key, srt) });
}
