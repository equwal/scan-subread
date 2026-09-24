// One smoke test for the copied engine: it is tested in its own repository.
import { describe, expect, it } from 'vitest';
import { alignBook, language, writeSrt } from '../src/engine/align.js';
import { parseSubtitles } from '../src/subtitles';

describe('engine align.js', () => {
  it('aligns a tiny transcript to three paragraphs and writes SRT the parser reads', () => {
    const paragraphs = [
      '朝の光が丘の上に昇った。',
      '村の人々は目を覚ました。',
      'パン屋は店を開けた。',
    ];
    // A rough transcript: no punctuation, one recognition slip.
    const transcript = [
      { text: '朝の光が丘の上に昇った', start: 0, end: 2.5 },
      { text: '村の人々は目を覚ました', start: 2.5, end: 5 },
      { text: 'パン屋は店をあけた', start: 5, end: 7.5 },
    ];
    const result = alignBook(transcript, paragraphs, language('ja'));
    expect(result.cues).toHaveLength(3);
    expect(result.matchRate).toBe(1);
    expect(result.cues.map((c) => c.text)).toEqual(paragraphs);

    const cues = parseSubtitles(writeSrt(result.cues));
    expect(cues).toEqual([
      { start: 0, end: 2.5, text: paragraphs[0] },
      { start: 2.5, end: 5, text: paragraphs[1] },
      { start: 5, end: 7.5, text: paragraphs[2] },
    ]);
  });
});
