import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PlayerError, type ClockState } from '../src/clock-source';
import {
  ANKI_RELEASES,
  ANKI_WEB_TEXT,
  ankiText,
  clockText,
  errorMessage,
  matchedText,
  MISMATCH_SHARE,
  MISMATCH_TEXT,
  noCuesText,
  notReadText,
  OCR_START_TEXT,
  OVERLAY_RELEASES,
  pagesReadText,
  pdfLoadedText,
  pdfOpenText,
  playerCommandsOff,
  playerMessage,
  playerProblem,
  readingEndMessage,
  readingText,
  keptResultText,
  shownInPlayerPart,
  subreadErrorText,
  subreadQuestion,
  subreadResultText,
  waitMessage,
  waitPagesText,
  withForceOcr,
} from '../src/messages';

describe('waitMessage', () => {
  const retry = { id: 'retry-reading', text: 'Retry' };

  it('tells how far the reading is while it runs', () => {
    expect(waitMessage(3, 40, true)).toEqual({ text: 'Reading pages 3/40 first...' });
  });

  it('tells after the reading that SubRead waits for the pages that could not be read', () => {
    // The finding: after "2 pages could not be read." the menu still said
    // "Reading pages 38/40 first...", and SubRead never started.
    expect(waitMessage(38, 40, false)).toEqual({
      text: 'SubRead waits for 2 pages that could not be read.',
      action: retry,
    });
    // OCR could not start: no page of the scan is read.
    expect(waitMessage(0, 1, false)).toEqual({
      text: 'SubRead waits for 1 page that could not be read.',
      action: retry,
    });
  });
});

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
  });

  it('gives a button that opens SubRead Overlay when it has no notification access', () => {
    // The phone finding: the strip showed "PlayerError: no_notification_access".
    expect(playerProblem('no_notification_access', true)).toEqual({
      text: 'Allow notification access in SubRead Overlay.',
      action: { id: 'open-overlay', text: 'Open SubRead Overlay' },
    });
  });

  it('gives the button, not the link, when SubRead Overlay is installed but does not answer', () => {
    expect(playerProblem('no_overlay', true, true)).toEqual({
      text: 'SubRead Overlay does not answer.',
      action: { id: 'open-overlay', text: 'Open SubRead Overlay' },
    });
    expect(playerMessage(state({ positionMs: null, error: 'no_overlay' }), true, true)).toEqual(
      playerProblem('no_overlay', true, true),
    );
    expect(errorMessage(new PlayerError('no_overlay'), true, true)).toEqual(
      playerProblem('no_overlay', true, true),
    );
  });

  it('gives null for another reason', () => {
    expect(playerProblem('malformed', true)).toBeNull();
  });
});

describe('shownInPlayerPart', () => {
  it('does not repeat the problem that the player part shows', () => {
    // The phone finding: after play, the strip said the same sentence twice.
    expect(
      shownInPlayerPart(new PlayerError('no_notification_access'), 'no_notification_access'),
    ).toBe(true);
    expect(shownInPlayerPart(new PlayerError('no_player'), 'no_player')).toBe(true);
  });

  it('tells another error, or a problem that the player part does not show', () => {
    expect(shownInPlayerPart(new PlayerError('no_player'), null)).toBe(false);
    expect(shownInPlayerPart(new PlayerError('no_player'), undefined)).toBe(false);
    expect(shownInPlayerPart(new PlayerError('no_overlay'), 'no_player')).toBe(false);
    expect(shownInPlayerPart(new Error('no_player'), 'no_player')).toBe(false);
  });
});

describe('playerCommandsOff', () => {
  it('turns off play and "audio to page" without notification access', () => {
    // The phone finding: with no notification access, play stayed on.
    expect(playerCommandsOff('no_notification_access', true)).toBe(true);
    expect(playerCommandsOff('no_overlay', true)).toBe(true);
  });

  it('turns them off on the web without an audio file only', () => {
    expect(playerCommandsOff('no_player', false)).toBe(true);
    expect(playerCommandsOff('no_player', true)).toBe(false);
    expect(playerCommandsOff(null, true)).toBe(false);
    expect(playerCommandsOff(null, false)).toBe(false);
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

/** The error of pdf.js 6 for a file that is not a PDF: a PNG, an .srt, or a cut PDF. */
function invalidPdf(): Error {
  const err = new Error('Invalid PDF structure.');
  err.name = 'InvalidPDFException';
  return err;
}

describe('file texts', () => {
  it('says that a file is not a PDF, with no exception text', () => {
    expect(pdfOpenText(invalidPdf())).toBe('This file is not a PDF, or it is damaged.');
  });

  it('gives another error of pdf.js as it is', () => {
    expect(pdfOpenText(new Error('Worker was destroyed'))).toBe(
      'Cannot open the PDF: Error: Worker was destroyed',
    );
  });

  it('names the subtitle file with no cues', () => {
    expect(noCuesText('sample-eng.pdf')).toBe(
      'No subtitle lines in sample-eng.pdf. Choose an .srt or .vtt file.',
    );
  });
});

describe('the end of the reading', () => {
  const retry = { id: 'retry-reading', text: 'Retry' };

  it('tells that OCR could not start, with Retry', () => {
    expect(readingEndMessage(40, true)).toEqual({ text: OCR_START_TEXT, action: retry });
    expect(OCR_START_TEXT).toBe(
      'OCR could not start. The first OCR run needs a network connection to download the language data.',
    );
  });

  it('counts the pages that could not be read, with Retry', () => {
    expect(readingEndMessage(1, false)).toEqual({
      text: '1 page could not be read.',
      action: retry,
    });
    expect(readingEndMessage(3, false)).toEqual({
      text: '3 pages could not be read.',
      action: retry,
    });
    expect(readingEndMessage(0, false)).toBeNull();
  });

  it('adds the Force OCR note while it is on', () => {
    expect(withForceOcr(null, false)).toBeNull();
    expect(withForceOcr(null, true)).toEqual({ text: 'Force OCR is on.' });
    expect(withForceOcr({ text: 'Reading 1/2 · page 2: OCR 45%' }, true)).toEqual({
      text: 'Reading 1/2 · page 2: OCR 45% · Force OCR is on',
    });
    expect(withForceOcr(readingEndMessage(2, false), true)).toEqual({
      text: '2 pages could not be read. Force OCR is on.',
      action: retry,
    });
    expect(withForceOcr({ text: 'Reading 1/2' }, false)).toEqual({ text: 'Reading 1/2' });
  });
});

describe('ankiText', () => {
  it('tells the result of SubRead Anki', () => {
    expect(ankiText({ added: true })).toEqual({ text: 'Card added to Anki.' });
    expect(ankiText({ error: 'not_installed' })).toEqual({
      text: 'SubRead Anki is not installed.',
      link: { href: ANKI_RELEASES, text: 'Get SubRead Anki' },
    });
    expect(ankiText({ error: 'cannot_start' })).toEqual({ text: 'SubRead Anki could not start.' });
  });

  it('says nothing when the user closed the card', () => {
    expect(ankiText({ added: false })).toBeNull();
  });

  it('tells the web that cards need Android', () => {
    expect(ANKI_WEB_TEXT).toBe('Anki cards need SubRead Anki on Android.');
  });
});

describe('SubRead texts', () => {
  it('tells how far the reading is while SubRead waits', () => {
    expect(waitPagesText(3, 40)).toBe('Reading pages 3/40 first...');
  });

  it('tells what SubRead made', () => {
    expect(subreadResultText({ cues: 15, language: 'en', matchRate: 0.97 })).toBe(
      '15 cues, language en, 97% of the lines found in the book.',
    );
    expect(subreadResultText({ cues: 15, language: 'en', matchRate: 0.5 })).toBe(
      '15 cues, language en, 50% of the lines found in the book. Under 80% usually means another edition or the wrong language.',
    );
    // The result file holds only the .srt, and the plugin gives -1 for no value.
    expect(subreadResultText({})).toBe('? cues, language ?.');
    expect(subreadResultText({ cues: -1, language: null, matchRate: -1 })).toBe(
      '? cues, language ?.',
    );
  });

  it('tells that the result for a book that is not open waits for that book', () => {
    expect(keptResultText('neko.pdf')).toBe(
      'SubRead made the subtitles of neko.pdf. The reader offers them when you open that book.',
    );
  });

  it('asks the user to choose the audio again when SubRead cannot start', () => {
    expect(subreadErrorText('cannot_start: Permission Denial: opening provider')).toBe(
      'SubRead cannot read the audio file. Choose the audio again.',
    );
    expect(subreadErrorText('cancelled')).toBe('SubRead made no subtitles: cancelled.');
  });

  it('asks with the reasons before the subtitles of SubRead load', () => {
    expect(subreadQuestion(['A.', 'B.'])).toBe(
      'SubRead made subtitles for this book.\n\nA.\n\nB.\n\nLoad them?',
    );
  });
});

describe('matchedText', () => {
  it('counts the matched cues of the pages read so far', () => {
    expect(matchedText(2, 15, false)).toBe('2/15 cues matched to the pages read so far.');
  });

  it('adds the hint when all pages are read and less than 30% of the cues match', () => {
    // sample-jpn.srt on the English PDF.
    expect(matchedText(0, 3, true)).toBe(`0/3 cues matched. ${MISMATCH_TEXT}`);
    expect(matchedText(4, 15, true)).toBe(`4/15 cues matched. ${MISMATCH_TEXT}`);
    expect(matchedText(5, 15, true)).toBe('5/15 cues matched.');
    expect(matchedText(15, 15, true)).toBe('15/15 cues matched.');
  });

  it('gives the hint exactly for all pages read and less than 30% matched', () => {
    expect(MISMATCH_SHARE).toBe(0.3);
    // 3 of 10 is 30%: no hint. In floating point 0.3 * 10 is more than 3.
    expect(matchedText(3, 10, true)).toBe('3/10 cues matched.');
    const counts = fc
      .tuple(fc.nat({ max: 500 }), fc.nat({ max: 500 }))
      .map(([a, b]) => ({ matched: Math.min(a, b), cues: Math.max(a, b) }));
    fc.assert(
      fc.property(counts, fc.boolean(), ({ matched, cues }, allRead) => {
        const hint = matchedText(matched, cues, allRead).endsWith(MISMATCH_TEXT);
        // Whole numbers: 10 * matched < 3 * cues is exact.
        expect(hint).toBe(allRead && 10 * matched < 3 * cues);
      }),
    );
  });
});
