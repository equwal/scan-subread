import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cueIndexAt, decodeSubtitles, parseSubtitles } from '../src/subtitles';

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

const NEKO = '吾輩は猫である。';

/** NEKO in Shift_JIS. .NET made these bytes with Encoding.GetEncoding(932). */
const NEKO_SHIFT_JIS = [
  0x8c, 0xe1, 0x94, 0x79, 0x82, 0xcd, 0x94, 0x4c, 0x82, 0xc5, 0x82, 0xa0, 0x82, 0xe9, 0x81, 0x42,
];

function utf8(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function utf16(text: string, littleEndian: boolean): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(text.length * 2));
  for (let i = 0; i < text.length; i++) view.setUint16(2 * i, text.charCodeAt(i), littleEndian);
  return view.buffer;
}

describe('decodeSubtitles', () => {
  it('decodes UTF-8 without a BOM', () => {
    expect(decodeSubtitles(utf8(NEKO))).toBe(NEKO);
  });

  it('decodes UTF-8 with a BOM, and removes the BOM', () => {
    expect(decodeSubtitles(utf8('﻿' + NEKO))).toBe(NEKO);
  });

  it('keeps UTF-8 for a file with a UTF-8 BOM and a bad byte', () => {
    const bytes = new Uint8Array([...new Uint8Array(utf8('﻿' + NEKO)), 0xff]);
    expect(decodeSubtitles(bytes.buffer)).toBe(NEKO + '�');
  });

  it('decodes UTF-16 with a BOM, and removes the BOM', () => {
    expect(decodeSubtitles(utf16('﻿' + NEKO, true))).toBe(NEKO);
    expect(decodeSubtitles(utf16('﻿' + NEKO, false))).toBe(NEKO);
  });

  it('decodes Shift_JIS', () => {
    expect(decodeSubtitles(new Uint8Array(NEKO_SHIFT_JIS).buffer)).toBe(NEKO);
  });

  it('gives the cues of a Shift_JIS file', () => {
    const time = new TextEncoder().encode('1\r\n00:00:00,000 --> 00:00:02,500\r\n');
    const file = new Uint8Array([...time, ...NEKO_SHIFT_JIS, 0x0d, 0x0a]);
    expect(parseSubtitles(decodeSubtitles(file.buffer))).toEqual([
      { start: 0, end: 2.5, text: NEKO },
    ]);
  });

  it('gives back each text that is encoded as UTF-8', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        // A BOM at the start is not text, so the decoder removes it.
        expect(decodeSubtitles(utf8(text))).toBe(text.replace(/^﻿/, ''));
      }),
    );
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
