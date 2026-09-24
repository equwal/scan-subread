// Finished subtitles per audio file, in IndexedDB. Thin browser layer.
//
// Key: audio file name and size. A book is aligned once; the next time the
// same audio file is picked, the subtitles load from here.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface Schema extends DBSchema {
  srt: { key: string; value: string };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('scan-subread-srt', 1, {
    upgrade(d) {
      d.createObjectStore('srt');
    },
  });
  return dbPromise;
}

/** The cache key of an audio file. */
export function audioKey(file: Pick<File, 'name' | 'size'>): string {
  return `${file.name}|${file.size}`;
}

export async function getSrt(key: string): Promise<string | undefined> {
  return (await db()).get('srt', key);
}

export async function putSrt(key: string, srt: string): Promise<void> {
  await (await db()).put('srt', srt, key);
}
