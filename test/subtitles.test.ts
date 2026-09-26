import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cueIndexAt, lastCueAt, parseSubtitles } from '../src/subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
The morning sun

2
00:00:03,500 --> 00:00:06,000
was clear and bright,
over the hills.
`;

const VTT = `WEBVTT

NOTE a comment block

00:01.000 --> 00:03.500 align:start
<v Narrator>The morning sun</v>

id-2
00:03.500 --> 00:06.000
was clear and bright
`;

describe('parseSubtitles', () => {
  it('parses SRT with multi-line text', () => {
    expect(parseSubtitles(SRT)).toEqual([
      { start: 1, end: 3.5, text: 'The morning sun' },
      { start: 3.5, end: 6, text: 'was clear and bright,\nover the hills.' },
    ]);
  });

  it('parses WebVTT, skips the header and notes, strips tags', () => {
    expect(parseSubtitles(VTT)).toEqual([
      { start: 1, end: 3.5, text: 'The morning sun' },
      { start: 3.5, end: 6, text: 'was clear and bright' },
    ]);
  });

  it('accepts CRLF and a BOM', () => {
    const text = '﻿' + SRT.replace(/\n/g, '\r\n');
    expect(parseSubtitles(text)).toHaveLength(2);
  });

  it('parses hours', () => {
    const cues = parseSubtitles('1\n01:02:03,004 --> 01:02:04,000\nx\n');
    expect(cues[0]?.start).toBeCloseTo(3723.004, 6);
  });
});

describe('cueIndexAt', () => {
  const cues = parseSubtitles(SRT);

  it('finds the active cue and returns -1 in gaps', () => {
    expect(cueIndexAt(cues, 0.5)).toBe(-1);
    expect(cueIndexAt(cues, 1)).toBe(0);
    expect(cueIndexAt(cues, 3.49)).toBe(0);
    expect(cueIndexAt(cues, 3.5)).toBe(1);
    expect(cueIndexAt(cues, 6)).toBe(-1);
  });

  it('agrees with a linear scan over non-overlapping cues', () => {
    // Each item is (gap before the cue, cue length).
    const gapsAndLengths = fc.array(fc.tuple(fc.nat({ max: 20 }), fc.nat({ max: 20 })), {
      maxLength: 30,
    });
    fc.assert(
      fc.property(gapsAndLengths, fc.nat({ max: 1300 }), (items, t) => {
        let clock = 0;
        const sorted = items.map(([gap, len]) => {
          const start = clock + gap;
          clock = start + len;
          return { start, end: clock, text: 'x' };
        });
        const got = cueIndexAt(sorted, t);
        const linear = sorted.findIndex((c) => c.start <= t && t < c.end);
        expect(got).toBe(linear);
      }),
    );
  });
});

describe('lastCueAt', () => {
  const cues = [
    { start: 1, end: 2 },
    { start: 3, end: 4 },
  ];

  it('gives the last cue that started, also in the silence after it', () => {
    expect(lastCueAt(cues, 0.5)).toBe(-1);
    expect(lastCueAt(cues, 1)).toBe(0);
    expect(lastCueAt(cues, 2.5)).toBe(0);
    expect(lastCueAt(cues, 3)).toBe(1);
    expect(lastCueAt(cues, 99)).toBe(1);
    expect(lastCueAt([], 1)).toBe(-1);
  });

  it('agrees with a linear scan', () => {
    const starts = fc
      .array(fc.nat({ max: 100 }), { maxLength: 30 })
      .map((s) => s.sort((a, b) => a - b));
    fc.assert(
      fc.property(starts, fc.integer({ min: -5, max: 110 }), (sorted, t) => {
        const list = sorted.map((start) => ({ start }));
        let linear = -1;
        list.forEach((c, i) => {
          if (c.start <= t) linear = i;
        });
        expect(lastCueAt(list, t)).toBe(linear);
      }),
    );
  });
});
