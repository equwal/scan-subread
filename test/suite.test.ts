import { describe, expect, it } from 'vitest';
import {
  ANKI_RELEASES,
  DICTIONARY_RELEASES,
  OVERLAY_RELEASES,
  SUBREAD_RELEASES,
} from '../src/messages';
import type { SuiteApps } from '../src/subread';
import { suiteChecklist } from '../src/suite';

const openOverlay = { id: 'open-overlay', text: 'Open SubRead Overlay' };

const none: SuiteApps = {
  overlay: false,
  overlayDebug: false,
  subread: null,
  anki: false,
  dictionaries: 0,
};

describe('suiteChecklist', () => {
  it('links each missing app to its releases', () => {
    expect(suiteChecklist(none, undefined)).toEqual([
      {
        ok: false,
        text: 'SubRead Overlay: not installed.',
        link: { href: OVERLAY_RELEASES, text: 'Get SubRead Overlay' },
      },
      {
        ok: false,
        text: 'Dictionary apps: none.',
        link: { href: DICTIONARY_RELEASES, text: 'Get SubRead Dictionary' },
      },
      {
        ok: false,
        text: 'SubRead: not installed.',
        link: { href: SUBREAD_RELEASES, text: 'Get SubRead' },
      },
      {
        ok: false,
        text: 'SubRead Anki: not installed.',
        link: { href: ANKI_RELEASES, text: 'Get SubRead Anki' },
      },
    ]);
  });

  it('shows the phone of the test: the overlay without notification access', () => {
    const phone: SuiteApps = {
      overlay: true,
      overlayDebug: false,
      subread: '0.9.1',
      anki: true,
      dictionaries: 3,
    };
    expect(suiteChecklist(phone, 'no_notification_access')).toEqual([
      { ok: false, text: 'SubRead Overlay: no notification access.', action: openOverlay },
      { ok: true, text: 'Dictionary apps: 3.' },
      { ok: true, text: 'SubRead 0.9.1: installed.' },
      { ok: true, text: 'SubRead Anki: installed.' },
    ]);
  });

  it('takes the notification access of the overlay from the last player state', () => {
    const debug = { ...none, overlayDebug: true };
    const overlay = (error: string | null | undefined) => suiteChecklist(debug, error)[0];
    expect(overlay(undefined)).toEqual({
      ok: true,
      text: 'SubRead Overlay: installed.',
      action: openOverlay,
    });
    const access = {
      ok: true,
      text: 'SubRead Overlay: installed, with notification access.',
      action: openOverlay,
    };
    expect(overlay(null)).toEqual(access);
    expect(overlay('no_player')).toEqual(access);
    expect(overlay('no_overlay')).toEqual({
      ok: false,
      text: 'SubRead Overlay: does not answer.',
      action: openOverlay,
    });
  });

  it('names SubRead without a version name', () => {
    expect(suiteChecklist({ ...none, subread: '' }, undefined)[2]).toEqual({
      ok: true,
      text: 'SubRead: installed.',
    });
  });
});
