import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alignCues, normalizeText } from '../src/align';

// A small mixed alphabet: Latin, kana and kanji, so CJK is always covered.
const ALPHABET = [...'abcdefghijklmnop', ...'あいうえおかきくけこ', ...'吾輩猫名前春夏秋冬'];
const char = fc.constantFrom(...ALPHABET);
const word = (min: number, max: number) =>
  fc.array(char, { minLength: min, maxLength: max }).map((cs) => cs.join(''));

describe('normalizeText', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        const once = normalizeText(s);
        expect(normalizeText(once)).toBe(once);
      }),
    );
  });
});

describe('alignCues properties', () => {
  it('maps exact text to exact spans', () => {
    fc.assert(
      fc.property(fc.array(word(1, 30), { minLength: 1, maxLength: 20 }), (cues) => {
        const spans = alignCues(cues, cues.join(''));
        let offset = 0;
        cues.forEach((cue, i) => {
          expect(spans[i]).toMatchObject({ start: offset, end: offset + cue.length });
          offset += cue.length;
        });
      }),
    );
  });

  it('gives every cue a contiguous in-range span, monotonic across cues', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: 'grapheme' }), { maxLength: 20 }),
        fc.string({ unit: 'grapheme' }),
        (cues, ocr) => {
          const spans = alignCues(cues, ocr);
          expect(spans).toHaveLength(cues.length);
          let prevEnd = 0;
          for (const s of spans) {
            expect(s.start).toBeGreaterThanOrEqual(prevEnd);
            expect(s.end).toBeGreaterThanOrEqual(s.start);
            expect(s.end).toBeLessThanOrEqual(ocr.length);
            prevEnd = s.end;
          }
        },
      ),
    );
  });

  it('keeps spans near the truth under modest random character noise', () => {
    // One cue with up to one edit per ten characters.
    const noisyCue = word(15, 40).chain((text) =>
      fc.tuple(
        fc.constant(text),
        fc.array(
          fc.record({
            pos: fc.nat({ max: text.length - 1 }),
            kind: fc.constantFrom('sub', 'del', 'ins'),
            ch: char,
          }),
          { maxLength: Math.floor(text.length / 10) },
        ),
      ),
    );

    fc.assert(
      fc.property(fc.array(noisyCue, { minLength: 1, maxLength: 15 }), (items) => {
        const cues = items.map(([text]) => text);
        const noisy = items.map(([text, edits]) => applyEdits(text, edits));
        const ocr = noisy.join('');
        const spans = alignCues(cues, ocr);

        let offset = 0;
        noisy.forEach((truth, i) => {
          const trueStart = offset;
          const trueEnd = offset + truth.length;
          offset = trueEnd;
          const s = spans[i]!;
          const overlap = Math.max(0, Math.min(s.end, trueEnd) - Math.max(s.start, trueStart));
          expect(overlap).toBeGreaterThanOrEqual(0.6 * truth.length);
          expect(s.start).toBeGreaterThanOrEqual(trueStart - 4);
          expect(s.end).toBeLessThanOrEqual(trueEnd + 4);
        });
      }),
    );
  });
});

interface Edit {
  pos: number;
  kind: 'sub' | 'del' | 'ins';
  ch: string;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  const chars = [...text];
  // Apply from the end so earlier positions stay valid.
  for (const e of [...edits].sort((x, y) => y.pos - x.pos)) {
    if (e.kind === 'sub') chars[e.pos] = e.ch;
    else if (e.kind === 'del') chars.splice(e.pos, 1);
    else chars.splice(e.pos, 0, e.ch);
  }
  return chars.join('');
}
