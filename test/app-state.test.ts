import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backStep, keepScreenOn } from '../src/app-state';
import type { FollowMode } from '../src/follower';

describe('backStep', () => {
  it('closes the page jump first, then the drawer', () => {
    expect(backStep({ jump: true, drawer: true })).toBe('close-jump');
    expect(backStep({ jump: true, drawer: false })).toBe('close-jump');
    expect(backStep({ jump: false, drawer: true })).toBe('close-drawer');
  });

  it('puts the reader in the background, and never finishes it', () => {
    // The phone finding: Back destroyed the activity, and the book was lost.
    expect(backStep({ jump: false, drawer: false })).toBe('minimize');
  });
});

describe('keepScreenOn', () => {
  const on = { active: true, book: true, playing: true, mode: 'highlight' as FollowMode };

  it('keeps the screen on during read-along, also in "Turn pages only"', () => {
    expect(keepScreenOn(on)).toBe(true);
    expect(keepScreenOn({ ...on, mode: 'pages' })).toBe(true);
  });

  it('lets the screen turn off when one condition is missing', () => {
    const cases = fc.record({
      active: fc.boolean(),
      book: fc.boolean(),
      playing: fc.boolean(),
      mode: fc.constantFrom<FollowMode>('highlight', 'pages', 'off'),
    });
    fc.assert(
      fc.property(cases, (s) => {
        const all = s.active && s.book && s.playing && s.mode !== 'off';
        expect(keepScreenOn(s)).toBe(all);
      }),
    );
    expect(keepScreenOn({ ...on, active: false })).toBe(false);
    expect(keepScreenOn({ ...on, book: false })).toBe(false);
    expect(keepScreenOn({ ...on, playing: false })).toBe(false);
    expect(keepScreenOn({ ...on, mode: 'off' })).toBe(false);
  });
});
