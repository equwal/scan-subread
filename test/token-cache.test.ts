import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageEntry } from '../src/token-cache';

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

describe('token cache', () => {
  beforeEach(() => {
    // Each test gets an empty IndexedDB.
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('upgrades the database of an earlier build that has other stores', async () => {
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
    await cache.putSrt('book.pdf|10', srt);
    expect(await cache.getSrt('book.pdf|10')).toBe(srt);

    const after = await openDB('scan-subread');
    expect(after.version).toBe(2);
    expect([...after.objectStoreNames].sort()).toEqual(['pages', 'srt']);
    after.close();
  });

  it('makes the stores in a new database', async () => {
    const cache = await freshCache();
    expect(await cache.getPage('missing')).toBeUndefined();
    await cache.putPage('p', entry);
    expect(await cache.getPage('p')).toEqual(entry);
    await cache.clearPages();
    expect(await cache.getPage('p')).toBeUndefined();
    await cache.putSrt('b', srt);
    expect(await cache.getSrt('b')).toBe(srt);
  });

  it('works without the cache when IndexedDB fails, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('IndexedDB is off.', 'SecurityError');
    });
    const cache = await freshCache();
    await expect(cache.getPage('p')).resolves.toBeUndefined();
    await expect(cache.putPage('p', entry)).resolves.toBeUndefined();
    await expect(cache.clearPages()).resolves.toBeUndefined();
    await expect(cache.getSrt('b')).resolves.toBeUndefined();
    await expect(cache.putSrt('b', srt)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
