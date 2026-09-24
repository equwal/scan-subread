// Japanese deinflection. Pure: no DOM, no dictionary.
//
// Input: an inflected surface form such as 食べました.
// Output: candidate dictionary forms such as 食べる, with the chain of
// rules that produced each one. The input itself is always a candidate.
// The dictionary decides which candidates are real words.
//
// Each rule replaces a suffix. A rule that ends a chain names the part of
// speech of its output (`pos`), so the caller can check it against the
// `rules` field of a dictionary term. A rule with no `pos` maps one
// inflection to a simpler inflection (ました → ます) and the chain goes on.

export type Pos = 'v1' | 'v5' | 'vs' | 'vk' | 'adj-i';

export interface Rule {
  name: string;
  from: string;
  to: string;
  pos?: Pos;
}

export interface Candidate {
  term: string;
  /** Names of the rules applied, in order. Empty for the input itself. */
  rules: string[];
  /** Part of speech that the term must have. Undefined: no constraint. */
  pos?: Pos;
}

/** Longest chain of rules. */
const MAX_DEPTH = 3;

/** Godan verb rows: the final kana and its a/i/e/o stems and past form. */
const GODAN = [
  { end: 'う', a: 'わ', i: 'い', e: 'え', o: 'お', ta: 'った' },
  { end: 'く', a: 'か', i: 'き', e: 'け', o: 'こ', ta: 'いた' },
  { end: 'ぐ', a: 'が', i: 'ぎ', e: 'げ', o: 'ご', ta: 'いだ' },
  { end: 'す', a: 'さ', i: 'し', e: 'せ', o: 'そ', ta: 'した' },
  { end: 'つ', a: 'た', i: 'ち', e: 'て', o: 'と', ta: 'った' },
  { end: 'ぬ', a: 'な', i: 'に', e: 'ね', o: 'の', ta: 'んだ' },
  { end: 'ぶ', a: 'ば', i: 'び', e: 'べ', o: 'ぼ', ta: 'んだ' },
  { end: 'む', a: 'ま', i: 'み', e: 'め', o: 'も', ta: 'んだ' },
  { end: 'る', a: 'ら', i: 'り', e: 'れ', o: 'ろ', ta: 'った' },
];

/** The te form of a past form: た → て, だ → で. */
function teOf(ta: string): string {
  return ta.slice(0, -1) + (ta.endsWith('だ') ? 'で' : 'て');
}

function godanRules(): Rule[] {
  const rules: Rule[] = [];
  for (const g of GODAN) {
    const r = (name: string, from: string): Rule => ({ name, from, to: g.end, pos: 'v5' });
    rules.push(
      r('negative', g.a + 'ない'),
      r('passive', g.a + 'れる'),
      r('causative', g.a + 'せる'),
      r('polite', g.i + 'ます'),
      r('tai', g.i + 'たい'),
      r('potential', g.e + 'る'),
      r('ba', g.e + 'ば'),
      r('imperative', g.e),
      r('volitional', g.o + 'う'),
      r('past', g.ta),
      r('te', teOf(g.ta)),
      r('tara', g.ta + 'ら'),
    );
  }
  return rules;
}

function ichidanRules(): Rule[] {
  const r = (name: string, from: string): Rule => ({ name, from, to: 'る', pos: 'v1' });
  return [
    r('negative', 'ない'),
    r('passive', 'られる'),
    r('potential', 'られる'),
    r('causative', 'させる'),
    r('polite', 'ます'),
    r('tai', 'たい'),
    r('ba', 'れば'),
    r('imperative', 'ろ'),
    r('volitional', 'よう'),
    r('past', 'た'),
    r('te', 'て'),
    r('tara', 'たら'),
  ];
}

function adjectiveRules(): Rule[] {
  const r = (name: string, from: string): Rule => ({ name, from, to: 'い', pos: 'adj-i' });
  return [
    r('ku', 'く'),
    r('negative', 'くない'),
    r('past', 'かった'),
    r('te', 'くて'),
    r('ba', 'ければ'),
  ];
}

/** Irregular verbs and one common exception of the godan past rule. */
function irregularRules(): Rule[] {
  const rules: Rule[] = [];
  const add = (to: string, pos: Pos, forms: Record<string, string>) => {
    for (const [name, from] of Object.entries(forms)) rules.push({ name, from, to, pos });
  };
  add('行く', 'v5', { past: '行った', te: '行って', tara: '行ったら' });
  add('する', 'vs', {
    past: 'した',
    te: 'して',
    negative: 'しない',
    polite: 'します',
    volitional: 'しよう',
  });
  add('来る', 'vk', { past: '来た', te: '来て', negative: '来ない', polite: '来ます' });
  add('くる', 'vk', { past: 'きた', te: 'きて', negative: 'こない', polite: 'きます' });
  return rules;
}

/** Rules that map one inflection to a simpler one. The chain goes on. */
const CHAIN_RULES: Rule[] = [
  { name: 'polite past', from: 'ました', to: 'ます' },
  { name: 'polite negative', from: 'ません', to: 'ます' },
  { name: 'polite negative past', from: 'ませんでした', to: 'ます' },
  { name: 'negative past', from: 'なかった', to: 'ない' },
  { name: 'negative te', from: 'なくて', to: 'ない' },
  { name: 'negative ba', from: 'なければ', to: 'ない' },
  { name: 'progressive', from: 'ている', to: 'て' },
  { name: 'progressive', from: 'でいる', to: 'で' },
];

export const RULES: readonly Rule[] = [
  ...CHAIN_RULES,
  ...irregularRules(),
  ...ichidanRules(),
  ...godanRules(),
  ...adjectiveRules(),
];

/**
 * All candidate dictionary forms of `word`, the input first. No candidate
 * appears twice. The stem may be empty: the irregular rules (行った, した)
 * match the whole word.
 */
export function deinflect(word: string): Candidate[] {
  const out: Candidate[] = [{ term: word, rules: [] }];
  const seen = new Set<string>([word]);
  let frontier: Candidate[] = out;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next: Candidate[] = [];
    for (const c of frontier) {
      for (const rule of RULES) {
        if (!c.term.endsWith(rule.from)) continue;
        const term = c.term.slice(0, -rule.from.length) + rule.to;
        if (seen.has(term)) continue;
        seen.add(term);
        const cand: Candidate = { term, rules: [...c.rules, rule.name] };
        if (rule.pos) cand.pos = rule.pos;
        next.push(cand);
      }
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}
