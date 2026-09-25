// The tokens of each page, and the subtitles of each book, in IndexedDB.
// Thin browser layer.
//
// OCR is slow, so a page is read once. The key names the file, the page,
// the OCR language and the source (text layer or OCR). The subtitles that
// SubRead made are kept under the key of the PDF.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('scan-subread', 1, {
    upgrade(d) {
      d.createObjectStore('pages');
      d.createObjectStore('srt');
    },
  });
  return dbPromise;
}

type FileId = Pick<File, 'name' | 'size'>;

/** The key of a book: the file name and size. */
export function bookKey(file: FileId): string {
  return `${file.name}|${file.size}`;
}

export function pageKey(file: FileId, page: number, lang: string, source: TextSource): string {
  return `${bookKey(file)}|${page}|${lang}|${source}`;
}

export async function getPage(key: string): Promise<PageEntry | undefined> {
  return (await db()).get('pages', key);
}

export async function putPage(key: string, entry: PageEntry): Promise<void> {
  await (await db()).put('pages', entry, key);
}

export async function clearPages(): Promise<void> {
  await (await db()).clear('pages');
}

export async function getSrt(key: string): Promise<string | undefined> {
  return (await db()).get('srt', key);
}

export async function putSrt(key: string, srt: string): Promise<void> {
  await (await db()).put('srt', srt, key);
}
