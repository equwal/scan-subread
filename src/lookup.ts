// Tap-to-look-up. Pure: no DOM, no database.
//
// 1. `tokenAt` finds the OCR token under a tap.
// 2. `scanText` reads that token and the ones after it on the same line.
// 3. `lookup` finds the longest prefix of that text that is a dictionary
//    term, after deinflection. Shorter matches follow.

import type { OcrToken } from './align';
import { deinflect } from './deinflect';
import type { DictTerm } from './yomitan';

/** Longest scan string, in characters. */
export const SCAN_LENGTH = 16;

/** Most results that `lookup` returns. */
const MAX_RESULTS = 20;

/** Distance from a point to a box. Zero inside the box. */
function boxDistance(box: OcrToken['bbox'], x: number, y: number): number {
  const dx = Math.max(box.x0 - x, 0, x - box.x1);
  const dy = Math.max(box.y0 - y, 0, y - box.y1);
  return Math.hypot(dx, dy);
}

/** Distance from a point to the center of a box. */
function centerDistance(box: OcrToken['bbox'], x: number, y: number): number {
  return Math.hypot((box.x0 + box.x1) / 2 - x, (box.y0 + box.y1) / 2 - y);
}

/**
 * Index of the token on `page` nearest to (x, y), or -1 when none is
 * within `tolerance` pixels. Coordinates are in OCR page pixels. OCR
 * boxes overlap, so among boxes at the same distance the one with the
 * nearest center wins.
 */
export function tokenAt(
  tokens: readonly OcrToken[],
  page: number,
  x: number,
  y: number,
  tolerance: number,
): number {
  let best = -1;
  let bestDist = tolerance;
  let bestCenter = Infinity;
  tokens.forEach((t, i) => {
    if (t.page !== page) return;
    const d = boxDistance(t.bbox, x, y);
    if (d > bestDist) return;
    const c = centerDistance(t.bbox, x, y);
    if (d < bestDist || c < bestCenter) {
      best = i;
      bestDist = d;
      bestCenter = c;
    }
  });
  return best;
}

/** Text of token `start` and the following tokens on its line, up to `max` characters. */
export function scanText(tokens: readonly OcrToken[], start: number, max = SCAN_LENGTH): string {
  const first = tokens[start];
  if (!first) return '';
  let text = '';
  for (let i = start; i < tokens.length && tokens[i]!.line === first.line; i++) {
    if (text.length + tokens[i]!.text.length > max) break;
    text += tokens[i]!.text;
  }
  return text;
}

export interface LookupResult<T extends DictTerm = DictTerm> {
  /** The part of the scan text that matched. */
  surface: string;
  term: T;
  /** Names of the deinflection rules applied. Empty for an exact match. */
  rules: string[];
}

/** Terms whose expression or reading equals `key`. */
export type TermFinder<T extends DictTerm = DictTerm> = (key: string) => Promise<readonly T[]>;

/** True when the term may take the deinflection (its rules allow the part of speech). */
function posAllows(term: DictTerm, pos: string | undefined): boolean {
  if (!pos || term.rules === '') return true;
  return term.rules.split(' ').includes(pos);
}

/**
 * Dictionary matches for the prefixes of `text`, longest prefix first.
 * Within one prefix, exact matches come before deinflected ones, then
 * higher scores first.
 */
export async function lookup<T extends DictTerm>(
  text: string,
  find: TermFinder<T>,
): Promise<LookupResult<T>[]> {
  const results: LookupResult<T>[] = [];
  const chars = [...text];
  for (let len = chars.length; len > 0 && results.length < MAX_RESULTS; len--) {
    const surface = chars.slice(0, len).join('');
    const found: LookupResult<T>[] = [];
    const seen = new Set<string>();
    for (const cand of deinflect(surface)) {
      for (const term of await find(cand.term)) {
        if (!posAllows(term, cand.pos)) continue;
        const key = `${term.expression}\t${term.reading}\t${term.glossary.join('\n')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ surface, term, rules: cand.rules });
      }
    }
    found.sort((a, b) => a.rules.length - b.rules.length || b.term.score - a.term.score);
    results.push(...found);
  }
  return results.slice(0, MAX_RESULTS);
}

/** A finder over an in-memory term list. Used by tests and small dictionaries. */
export function memoryFinder(terms: readonly DictTerm[]): TermFinder {
  const byKey = new Map<string, DictTerm[]>();
  const add = (key: string, term: DictTerm) => {
    const list = byKey.get(key);
    if (list) {
      if (!list.includes(term)) list.push(term);
    } else byKey.set(key, [term]);
  };
  for (const term of terms) {
    add(term.expression, term);
    if (term.reading) add(term.reading, term);
  }
  return async (key) => byKey.get(key) ?? [];
}
