// The checklist of the SubRead suite: which apps are on the device, and
// what to do for an app that is missing. Pure: no DOM.

import { OPEN_OVERLAY, OVERLAY_RELEASES, SUBREAD_RELEASES, type Message } from './messages';
import type { SuiteApps } from './subread';

export const DICTIONARY_RELEASES = 'https://github.com/equwal/subread-dictionary/releases/latest';
export const ANKI_RELEASES = 'https://github.com/equwal/subread-anki/releases/latest';

/** One line of the checklist. `ok` is true when the app is ready. */
export interface ChecklistItem extends Message {
  ok: boolean;
}

/**
 * The line of SubRead Overlay. `playerError` is the error of the last
 * player state, undefined before the first state. A state or `no_player`
 * shows that the overlay has notification access.
 */
function overlayItem(apps: SuiteApps, playerError: string | null | undefined): ChecklistItem {
  if (!apps.overlay && !apps.overlayDebug) {
    return {
      ok: false,
      text: 'SubRead Overlay: not installed.',
      link: { href: OVERLAY_RELEASES, text: 'Get SubRead Overlay' },
    };
  }
  switch (playerError) {
    case 'no_notification_access':
      return { ok: false, text: 'SubRead Overlay: no notification access.', action: OPEN_OVERLAY };
    case 'no_overlay':
      return { ok: false, text: 'SubRead Overlay: does not answer.', action: OPEN_OVERLAY };
    case null:
    case 'no_player':
      return {
        ok: true,
        text: 'SubRead Overlay: installed, with notification access.',
        action: OPEN_OVERLAY,
      };
    default:
      return { ok: true, text: 'SubRead Overlay: installed.', action: OPEN_OVERLAY };
  }
}

function dictionaryItem(count: number): ChecklistItem {
  if (count > 0) return { ok: true, text: `Dictionary apps: ${count}.` };
  return {
    ok: false,
    text: 'Dictionary apps: none.',
    link: { href: DICTIONARY_RELEASES, text: 'Get SubRead Dictionary' },
  };
}

function subreadItem(version: string | null): ChecklistItem {
  if (version === null) {
    return {
      ok: false,
      text: 'SubRead: not installed.',
      link: { href: SUBREAD_RELEASES, text: 'Get SubRead' },
    };
  }
  return { ok: true, text: version ? `SubRead ${version}: installed.` : 'SubRead: installed.' };
}

function ankiItem(installed: boolean): ChecklistItem {
  if (installed) return { ok: true, text: 'SubRead Anki: installed.' };
  return {
    ok: false,
    text: 'SubRead Anki: not installed.',
    link: { href: ANKI_RELEASES, text: 'Get SubRead Anki' },
  };
}

/**
 * The checklist: SubRead Overlay, the dictionary apps, SubRead and SubRead
 * Anki. `playerError` is the error of the last player state, undefined
 * before the first state.
 */
export function suiteChecklist(
  apps: SuiteApps,
  playerError: string | null | undefined,
): ChecklistItem[] {
  return [
    overlayItem(apps, playerError),
    dictionaryItem(apps.dictionaries),
    subreadItem(apps.subread),
    ankiItem(apps.anki),
  ];
}
