import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubRead } from '../src/subread';

/** A fake Screen Wake Lock API that keeps each lock it gives. */
function fakeWakeLock() {
  const locks: { released: boolean; release: () => Promise<void> }[] = [];
  const request = vi.fn(async (type: string) => {
    expect(type).toBe('screen');
    const lock = {
      released: false,
      release: async () => {
        lock.released = true;
      },
    };
    locks.push(lock);
    return lock;
  });
  return { wakeLock: { request }, request, locks };
}

describe('the web fallback of the plugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds one screen wake lock while keepAwake is on', async () => {
    const { wakeLock, request, locks } = fakeWakeLock();
    vi.stubGlobal('navigator', { wakeLock });
    await SubRead.keepAwake({ on: true });
    await SubRead.keepAwake({ on: true });
    expect(request).toHaveBeenCalledTimes(1);
    await SubRead.keepAwake({ on: false });
    expect(locks[0]!.released).toBe(true);
    await SubRead.keepAwake({ on: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks again for a lock that the browser released', async () => {
    const { wakeLock, request, locks } = fakeWakeLock();
    vi.stubGlobal('navigator', { wakeLock });
    await SubRead.keepAwake({ on: true });
    // The browser releases the lock when the page is hidden.
    locks[0]!.released = true;
    await SubRead.keepAwake({ on: true });
    expect(request).toHaveBeenCalledTimes(2);
    await SubRead.keepAwake({ on: false });
    expect(locks[1]!.released).toBe(true);
  });

  it('ignores a browser with no wake lock, and a refused request', async () => {
    vi.stubGlobal('navigator', {});
    await expect(SubRead.keepAwake({ on: true })).resolves.toBeUndefined();
    const refuse = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    vi.stubGlobal('navigator', { wakeLock: { request: refuse } });
    await expect(SubRead.keepAwake({ on: true })).resolves.toBeUndefined();
    expect(refuse).toHaveBeenCalledTimes(1);
    await expect(SubRead.keepAwake({ on: false })).resolves.toBeUndefined();
  });
});
