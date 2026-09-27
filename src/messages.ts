// The texts of the status strip. Pure: no DOM.

import { PlayerError, type ClockState } from './clock-source';

/** The actions of the buttons in the strip. main.ts runs them. */
export type ActionId = 'retry-reading';

/** A text, and a link or a button after it. */
export interface Message {
  text: string;
  link?: { href: string; text: string };
  action?: { id: ActionId; text: string };
}

export const OVERLAY_RELEASES = 'https://github.com/equwal/subread-overlay/releases/latest';

/** "1 page", "2 pages". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** A position as mm:ss, or h:mm:ss from one hour. */
export function clockText(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return `${h > 0 ? `${h}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * What is wrong with the player, and what to do, for a reason of
 * `PlayerError` or `ClockState.error`. Null for another reason.
 */
export function playerProblem(reason: string, android: boolean): Message | null {
  switch (reason) {
    case 'no_player':
      return {
        text: android
          ? 'No audiobook is playing. Start it in your player app.'
          : 'Load the audio file first.',
      };
    case 'no_overlay':
      return {
        text: 'SubRead Overlay is not installed.',
        link: { href: OVERLAY_RELEASES, text: 'Get it' },
      };
    case 'no_notification_access':
      return { text: 'Allow notification access in SubRead Overlay.' };
    default:
      return null;
  }
}

/** The text for a command that failed. A PlayerError gets the text of its reason. */
export function errorMessage(err: unknown, android: boolean): Message {
  if (err instanceof PlayerError) {
    return playerProblem(err.reason, android) ?? { text: `The player failed: ${err.reason}.` };
  }
  return { text: String(err) };
}

/** The player part of the strip: the time and the play state, or the problem. */
export function playerMessage(s: ClockState | null, android: boolean): Message {
  const name = android ? 'Player' : 'Audio';
  if (!s) return { text: `${name}: not read yet.` };
  if (s.error !== null) {
    return playerProblem(s.error, android) ?? { text: `${name}: cannot read it (${s.error}).` };
  }
  if (s.positionMs === null) return { text: `${name}: no position.` };
  return { text: `${name} ${clockText(s.positionMs)}, ${s.playing ? 'playing' : 'paused'}` };
}

export function pdfLoadedText(pages: number): string {
  return `PDF loaded: ${count(pages, 'page')}.`;
}

/** The reading part of the strip while the pages are read. `note` tells about one page. */
export function readingText(read: number, total: number, note: string): string {
  return `Reading ${read}/${total}${note ? ` · ${note}` : ''}`;
}

/** The message after the last page is read. */
export function pagesReadText(counts: { text: number; ocr: number }): string {
  return `${count(counts.text + counts.ocr, 'page')} read: ${counts.text} text layer, ${counts.ocr} OCR.`;
}

export const OCR_START_TEXT =
  'OCR could not start. The first OCR run needs a network connection to download the language data.';

const RETRY = { id: 'retry-reading', text: 'Retry' } as const;

/**
 * The reading part of the strip after the reading of the pages ends: what
 * went wrong, with Retry. `failed` is the count of pages that could not be
 * read. `startFailed` is true when OCR could not start. Null when each page
 * is read.
 */
export function readingEndMessage(failed: number, startFailed: boolean): Message | null {
  if (startFailed) return { text: OCR_START_TEXT, action: RETRY };
  if (failed > 0) return { text: `${count(failed, 'page')} could not be read.`, action: RETRY };
  return null;
}

export const FORCE_OCR_NOTE = 'Force OCR is on';

/** The reading part of the strip, with the note while Force OCR is on for the open book. */
export function withForceOcr(m: Message | null, forceOcr: boolean): Message | null {
  if (!forceOcr) return m;
  if (m === null) return { text: `${FORCE_OCR_NOTE}.` };
  const text = m.text.endsWith('.')
    ? `${m.text} ${FORCE_OCR_NOTE}.`
    : `${m.text} · ${FORCE_OCR_NOTE}`;
  return { ...m, text };
}

/** The question before the saved pages of one book go. */
export function clearBookQuestion(name: string): string {
  return `Remove the saved pages of ${name}? The reader reads them again the next time it opens the book.`;
}

export const CLEAR_ALL_QUESTION =
  'Remove the saved pages of all books? The reader reads each book again the next time it opens it.';

/** The message for a tap on a page that is not read yet. */
export function notReadText(read: number, total: number): string {
  return `This page is not read yet (${read}/${total} read).`;
}

/** The strip says this while the database upgrade holds the reading. */
export const UPDATING_CACHE_TEXT = 'Updating the page cache...';

/** The copy of the last book cannot be read, for example after the storage was cleared. */
export const LAST_BOOK_GONE_TEXT = 'The last book is no longer in the app storage. Open it again.';

/** A picked file of 0 bytes, for example a file that another app still writes. */
export const EMPTY_FILE_TEXT = 'The file is empty or not ready. Try again in a moment.';

/** The message when pdf.js cannot open a file. */
export function pdfOpenText(err: unknown): string {
  if (err instanceof Error && err.name === 'InvalidPDFException') {
    return 'This file is not a PDF, or it is damaged.';
  }
  return `Cannot open the PDF: ${String(err)}`;
}

/** The message for a subtitle file with no cues, for example a PDF. */
export function noCuesText(name: string): string {
  return `No subtitle lines in ${name}. Choose an .srt or .vtt file.`;
}

/**
 * When all pages are read and less than this share of the cues is
 * matched, the subtitles are for another text or another language.
 */
export const MISMATCH_SHARE = 0.3;

export const MISMATCH_TEXT = 'These subtitles do not match this book or the OCR language.';

/**
 * The count of matched cues. When all pages are read and less than
 * MISMATCH_SHARE of the cues is matched, the hint follows.
 */
export function matchedText(matched: number, cues: number, allRead: boolean): string {
  if (!allRead) return `${matched}/${cues} cues matched to the pages read so far.`;
  const text = `${matched}/${cues} cues matched.`;
  return cues > 0 && matched / cues < MISMATCH_SHARE ? `${text} ${MISMATCH_TEXT}` : text;
}
