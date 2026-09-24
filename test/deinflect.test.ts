import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deinflect } from '../src/deinflect';

function terms(word: string): string[] {
  return deinflect(word).map((c) => c.term);
}

describe('deinflect examples', () => {
  it.each([
    ['食べました', '食べる'],
    ['書いて', '書く'],
    ['読まない', '読む'],
    ['高くない', '高い'],
    ['走った', '走る'],
    ['行った', '行く'],
    ['見られる', '見る'],
    ['話せる', '話す'],
    ['食べたい', '食べる'],
    ['食べませんでした', '食べる'],
    ['高くなかった', '高い'],
    ['泣いていた', '泣く'],
    ['しました', 'する'],
  ])('%s → %s', (input, expected) => {
    expect(terms(input)).toContain(expected);
  });

  it('records the rule chain and the part of speech', () => {
    const c = deinflect('食べました').find((c) => c.term === '食べる');
    expect(c).toMatchObject({ rules: ['polite past', 'polite'], pos: 'v1' });
  });

  it('keeps the input first, with no rules', () => {
    expect(deinflect('猫')[0]).toEqual({ term: '猫', rules: [] });
  });
});

const KANA = [
  ...'あいうえおかきくけこさしすせそたちつてとなにぬねのまみむめもらりるれろわんっ',
  ...'べ見食行高',
];
const word = fc
  .array(fc.constantFrom(...KANA), { minLength: 0, maxLength: 12 })
  .map((c) => c.join(''));

describe('deinflect properties', () => {
  it('always includes the input', () => {
    fc.assert(
      fc.property(word, (w) => {
        expect(terms(w)).toContain(w);
      }),
    );
  });

  it('never produces a candidate longer than the input plus two', () => {
    fc.assert(
      fc.property(word, (w) => {
        for (const t of terms(w)) expect(t.length).toBeLessThanOrEqual(w.length + 2);
      }),
    );
  });

  it('never repeats a candidate', () => {
    fc.assert(
      fc.property(word, (w) => {
        const ts = terms(w);
        expect(new Set(ts).size).toBe(ts.length);
      }),
    );
  });

  it('applies at most three rules', () => {
    fc.assert(
      fc.property(word, (w) => {
        for (const c of deinflect(w)) expect(c.rules.length).toBeLessThanOrEqual(3);
      }),
    );
  });
});
