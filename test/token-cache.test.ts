import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import fc from 'fast-check';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookSubtitles, PageEntry } from '../src/token-cache';

const entry: PageEntry = {
  tokens: [{ text: '猫', page: 0, line: 0, word: 0, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }],
  width: 1600,
  height: 2263,
  source: 'ocr',
};

const srt = '1\n00:00:00,000 --> 00:00:02,500\n吾輩は猫である。\n';

/** A new copy of the module. Its database connection is not open yet. */
async function freshCache() {
  vi.resetModules();
  return import('../src/token-cache');
}

/** The version and the store names of the database. Open the cache first. */
async function schema(): Promise<{ version: number; stores: string[] }> {
  const d = await openDB('scan-subread');
  const result = { version: d.version, stores: [...d.objectStoreNames].sort() };
  d.close();
  return result;
}

describe('token cache', () => {
  beforeEach(() => {
    // Each test gets an empty IndexedDB.
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('upgrades version 1, which has the stores of the dictionary', async () => {
    // Earlier builds made version 1 with the stores of the dictionary.
    const old = await openDB('scan-subread', 1, {
      upgrade(d) {
        d.createObjectStore('dictionaries');
        d.createObjectStore('terms');
      },
    });
    await old.put('terms', { term: '猫' }, 'k');
    old.close();

    const cache = await freshCache();
    await cache.putPage('book.pdf|10|0|jpn|ocr', entry);
    expect(await cache.getPage('book.pdf|10|0|jpn|ocr')).toEqual(entry);
    expect(await schema()).toEqual({ version: 3, stores: ['books', 'meta', 'pages'] });
  });

  it('upgrades version 2: the pages stay, and the subtitles move to the meta data', async () => {
    const old = await openDB('scan-subread', 2, {
      upgrade(d) {
        d.createObjectStore('pages');
        d.createObjectStore('srt');
      },
    });
    await old.put('pages', entry, 'book.pdf|10|0|jpn|ocr');
    await old.put('srt', srt, 'book.pdf|10');
    await old.put('srt', 'x', 'Neko.PDF|20');
    await old.put('srt', 'y', 'a|b|30');
    old.close();

    const cache = await freshCache();
    expect(await cache.getPage('book.pdf|10|0|jpn|ocr')).toEqual(entry);
    expect(await cache.getMeta('book.pdf|10')).toEqual({
      subtitles: { name: 'book.srt', text: srt, source: 'subread' },
    });
    expect(await cache.getMeta('Neko.PDF|20')).toEqual({
      subtitles: { name: 'Neko.srt', text: 'x', source: 'subread' },
    });
    expect(await cache.getMeta('a|b|30')).toEqual({
      subtitles: { name: 'a|b.srt', text: 'y', source: 'subread' },
    });
    expect(await schema()).toEqual({ version: 3, stores: ['books', 'meta', 'pages'] });
  });

  it('makes the stores in a new database', async () => {
    const cache = await freshCache();
    expect(await cache.getPage('missing')).toBeUndefined();
    expect(await cache.getMeta('missing')).toEqual({});
    expect(await cache.getLastBook()).toBeUndefined();
    expect(await schema()).toEqual({ version: 3, stores: ['books', 'meta', 'pages'] });
  });

  it('keeps the last book, and a new book replaces it', async () => {
    const cache = await freshCache();
    const neko = new File(['%PDF-1.7 猫'], 'neko.pdf', { type: 'application/pdf' });
    expect(await cache.putLastBook(neko)).toBe(true);
    const back = await cache.getLastBook();
    expect(back).toBeInstanceOf(File);
    expect(back?.name).toBe('neko.pdf');
    expect(back?.type).toBe('application/pdf');
    expect(await back?.text()).toBe('%PDF-1.7 猫');
    expect(back && cache.bookKey(back)).toBe(cache.bookKey(neko));

    const inu = new File(['%PDF-1.7 犬と猫'], 'inu.pdf', { type: 'application/pdf' });
    expect(await cache.putLastBook(inu)).toBe(true);
    expect((await cache.getLastBook())?.name).toBe('inu.pdf');

    const d = await openDB('scan-subread');
    expect(await d.getAllKeys('books')).toEqual(['last']);
    const record = await d.get('books', 'last');
    d.close();
    expect(record).toMatchObject({
      key: cache.bookKey(inu),
      name: 'inu.pdf',
      type: 'application/pdf',
    });
    expect(record.blob).toBeInstanceOf(Blob);
  });

  it('merges the meta data, and removes a field that is undefined in the patch', async () => {
    const cache = await freshCache();
    const subtitles: BookSubtitles = { name: 'neko.srt', text: srt, source: 'file' };
    await cache.putMeta('neko.pdf|10', { page: 3 });
    await cache.putMeta('neko.pdf|10', { subtitles, forceOcr: true });
    expect(await cache.getMeta('neko.pdf|10')).toEqual({ page: 3, subtitles, forceOcr: true });

    await cache.putMeta('neko.pdf|10', { page: undefined, forceOcr: false });
    const meta = await cache.getMeta('neko.pdf|10');
    expect(meta).toEqual({ subtitles, forceOcr: false });
    expect('page' in meta).toBe(false);
    expect(await cache.getMeta('inu.pdf|20')).toEqual({});
  });

  it('keeps the fields of two merges at the same time', async () => {
    const cache = await freshCache();
    await Promise.all([
      cache.putMeta('neko.pdf|10', { page: 1 }),
      cache.putMeta('neko.pdf|10', { forceOcr: true }),
    ]);
    expect(await cache.getMeta('neko.pdf|10')).toEqual({ page: 1, forceOcr: true });
  });

  it('forgets the last book, and keeps the meta data and the pages', async () => {
    const cache = await freshCache();
    const neko = new File(['%PDF-1.7 猫'], 'neko.pdf', { type: 'application/pdf' });
    await cache.putLastBook(neko);
    await cache.putMeta(cache.bookKey(neko), { page: 2 });
    await cache.putPage(cache.pageKey(neko, 0, 'jpn', 'ocr'), entry);
    await cache.clearLastBook(cache.bookKey(neko));
    expect(await cache.getLastBook()).toBeUndefined();
    expect(await cache.getMeta(cache.bookKey(neko))).toEqual({ page: 2 });
    expect(await cache.getPage(cache.pageKey(neko, 0, 'jpn', 'ocr'))).toEqual(entry);
    // No last book: nothing to forget.
    await expect(cache.clearLastBook(cache.bookKey(neko))).resolves.toBeUndefined();
  });

  it('forgets the last book only while the copy is of that book', async () => {
    // The finding: the restore of the last book failed after the user had
    // opened another book, and it deleted the copy of the user's book.
    const cache = await freshCache();
    const last = new File(['%PDF-1.7 猫'], 'neko.pdf', { type: 'application/pdf' });
    const picked = new File(['%PDF-1.7 犬と猫'], 'inu.pdf', { type: 'application/pdf' });
    await cache.putLastBook(last);
    await cache.putLastBook(picked);
    await cache.clearLastBook(cache.bookKey(last));
    expect((await cache.getLastBook())?.name).toBe('inu.pdf');
    await cache.clearLastBook(cache.bookKey(picked));
    expect(await cache.getLastBook()).toBeUndefined();
  });

  it('tells when the database is open, after the upgrade', async () => {
    const old = await openDB('scan-subread', 1, {
      upgrade(d) {
        d.createObjectStore('dictionaries');
        d.createObjectStore('terms');
      },
    });
    old.close();
    const cache = await freshCache();
    await cache.dbReady();
    expect(await schema()).toEqual({ version: 3, stores: ['books', 'meta', 'pages'] });
  });

  it('clears the pages of one book, or the pages of all books', async () => {
    const cache = await freshCache();
    const a = { name: 'a.pdf', size: 1 };
    // The key of this book, "a.pdf|10", starts with the key of `a`, "a.pdf|1".
    const a10 = { name: 'a.pdf', size: 10 };
    const keys = [
      cache.pageKey(a, 0, 'jpn', 'ocr'),
      cache.pageKey(a, 1, 'jpn', 'text'),
      cache.pageKey(a10, 0, 'jpn', 'ocr'),
    ] as const;
    for (const key of keys) await cache.putPage(key, entry);
    await cache.putMeta(cache.bookKey(a), { page: 1 });

    await cache.clearPages(cache.bookKey(a));
    expect(await cache.getPage(keys[0])).toBeUndefined();
    expect(await cache.getPage(keys[1])).toBeUndefined();
    expect(await cache.getPage(keys[2])).toEqual(entry);
    expect(await cache.getMeta(cache.bookKey(a))).toEqual({ page: 1 });

    await cache.clearPages();
    expect(await cache.getPage(keys[2])).toBeUndefined();
  });

  // 100 runs of IndexedDB work take about 2 s, and more than the 5 s default on a busy machine.
  it('clears each page key that starts with the book key and "|", and no other key', async () => {
    const cache = await freshCache();
    const separator = fc.constantFrom('|', '||', '}', '{', '', '￿');
    const tails = fc.array(fc.tuple(separator, fc.string({ unit: 'binary' })), { maxLength: 8 });
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary' }), tails, async (book, parts) => {
        await cache.clearPages();
        const keys = parts.map(([sep, tail]) => `${book}${sep}${tail}`);
        for (const key of keys) await cache.putPage(key, entry);
        await cache.clearPages(book);
        for (const key of keys) {
          const cleared = key.startsWith(`${book}|`);
          expect(await cache.getPage(key), key).toEqual(cleared ? undefined : entry);
        }
      }),
    );
  }, 30_000);

  it('gives back the file name of a book key, also a name with "|"', async () => {
    const cache = await freshCache();
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.nat(), (name, size) => {
        expect(cache.bookName(cache.bookKey({ name, size }))).toBe(name);
      }),
    );
  });

  it('works without IndexedDB, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('IndexedDB is off.', 'SecurityError');
    });
    const cache = await freshCache();
    await expect(cache.getPage('p')).resolves.toBeUndefined();
    await expect(cache.putPage('p', entry)).resolves.toBeUndefined();
    await expect(cache.clearPages()).resolves.toBeUndefined();
    await expect(cache.clearPages('b')).resolves.toBeUndefined();
    await expect(cache.getMeta('b')).resolves.toEqual({});
    await expect(cache.putMeta('b', { page: 1 })).resolves.toBeUndefined();
    await expect(cache.putLastBook(new File(['x'], 'b.pdf'))).resolves.toBe(false);
    await expect(cache.getLastBook()).resolves.toBeUndefined();
    await expect(cache.clearLastBook('b.pdf|1')).resolves.toBeUndefined();
    await expect(cache.dbReady()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('gives false when the book does not fit, and keeps the other data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cache = await freshCache();
    await cache.putPage('p', entry);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota is full.', 'QuotaExceededError');
    });
    await expect(cache.putLastBook(new File(['x'], 'b.pdf'))).resolves.toBe(false);
    put.mockRestore();
    expect(await cache.getPage('p')).toEqual(entry);
    expect(await cache.getLastBook()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
