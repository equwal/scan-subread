import { describe, expect, it } from 'vitest';
import { PlayerError, type ClockState } from '../src/clock-source';
import {
  clockText,
  errorMessage,
  notReadText,
  OVERLAY_RELEASES,
  pagesReadText,
  pdfLoadedText,
  playerMessage,
  playerProblem,
  readingText,
} from '../src/messages';

function state(over: Partial<ClockState>): ClockState {
  return { positionMs: 0, playing: false, seeked: false, error: null, ...over };
}

describe('clockText', () => {
  it('gives minutes and seconds, and hours from one hour', () => {
    expect(clockText(0)).toBe('00:00');
    expect(clockText(20_500)).toBe('00:20');
    expect(clockText(3_599_999)).toBe('59:59');
    expect(clockText(3_600_000 + 61_000)).toBe('1:01:01');
  });
});

describe('playerProblem', () => {
  it('tells what to do for each reason, on Android and on the web', () => {
    expect(playerProblem('no_player', true)).toEqual({
      text: 'No audiobook is playing. Start it in your player app.',
    });
    expect(playerProblem('no_player', false)).toEqual({ text: 'Load the audio file first.' });
    expect(playerProblem('no_overlay', true)).toEqual({
      text: 'SubRead Overlay is not installed.',
      link: { href: OVERLAY_RELEASES, text: 'Get it' },
    });
    expect(playerProblem('no_notification_access', true)).toEqual({
      text: 'Allow notification access in SubRead Overlay.',
    });
  });

  it('gives null for another reason', () => {
    expect(playerProblem('malformed', true)).toBeNull();
  });
});

describe('errorMessage', () => {
  it('gives the text of the reason for a PlayerError', () => {
    expect(errorMessage(new PlayerError('no_player'), false)).toEqual({
      text: 'Load the audio file first.',
    });
    expect(errorMessage(new PlayerError('empty'), true)).toEqual({
      text: 'The player failed: empty.',
    });
  });

  it('gives the error as text for another error', () => {
    expect(errorMessage(new Error('boom'), true)).toEqual({ text: 'Error: boom' });
  });
});

describe('playerMessage', () => {
  it('gives the time and the play state', () => {
    expect(playerMessage(state({ positionMs: 75_000, playing: true }), true)).toEqual({
      text: 'Player 01:15, playing',
    });
    expect(playerMessage(state({ positionMs: 5_000 }), false)).toEqual({
      text: 'Audio 00:05, paused',
    });
  });

  it('gives the problem and what to do', () => {
    expect(playerMessage(state({ positionMs: null, error: 'no_player' }), false)).toEqual({
      text: 'Load the audio file first.',
    });
    expect(playerMessage(state({ error: 'malformed' }), true)).toEqual({
      text: 'Player: cannot read it (malformed).',
    });
    expect(playerMessage(state({ positionMs: null }), true)).toEqual({
      text: 'Player: no position.',
    });
    expect(playerMessage(null, true)).toEqual({ text: 'Player: not read yet.' });
  });
});

describe('page texts', () => {
  it('uses the singular for one page', () => {
    expect(pdfLoadedText(1)).toBe('PDF loaded: 1 page.');
    expect(pdfLoadedText(40)).toBe('PDF loaded: 40 pages.');
    expect(pagesReadText({ text: 0, ocr: 1 })).toBe('1 page read: 0 text layer, 1 OCR.');
    expect(pagesReadText({ text: 38, ocr: 2 })).toBe('40 pages read: 38 text layer, 2 OCR.');
  });

  it('tells the reading progress and the page that is not read yet', () => {
    expect(readingText(3, 40, '')).toBe('Reading 3/40');
    expect(readingText(3, 40, 'page 5: OCR 45%')).toBe('Reading 3/40 · page 5: OCR 45%');
    expect(notReadText(3, 40)).toBe('This page is not read yet (3/40 read).');
  });
});
