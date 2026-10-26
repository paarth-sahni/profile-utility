/**
 * Purpose: finds registered client / legal / project names inside free text. Pure and shared by the browser (live
 * highlights) and the server (the authoritative gate), so both give the same answer.
 *
 * A name matches only as a whole run of tokens (see normalize.ts), so no naive substring hits. When two matches overlap
 * the earlier one wins and, from the same start, the longer one, so "Acme Bank Limited" is reported once, not as "Acme Bank"
 * plus "Acme". Fuzzy similarity is
 * deliberately not used: a near-miss is never treated as the same company.
 */
import { tokenize } from "./normalize";

export type NameType = "client" | "legal" | "friendly" | "group" | "project";

export type RegistryName = {
  id: string;
  name: string;
  types: NameType[];
};

export type TextMatch = {
  nameId: string;
  types: NameType[];
  /** Offsets in the scanned text (end exclusive). */
  start: number;
  end: number;
  /** The text as the user typed it. */
  matchedText: string;
};

type Compiled = { id: string; types: NameType[]; tokens: string[] };

export type Matcher = {
  /** Number of registry names that could be compiled (names with no letters or digits are skipped). */
  size: number;
  scan: (text: string) => TextMatch[];
};

export function buildMatcher(names: readonly RegistryName[]): Matcher {
  const byFirst = new Map<string, Compiled[]>();
  let size = 0;
  for (const n of names) {
    const tokens = tokenize(n.name).map((t) => t.value);
    if (tokens.length === 0) continue;
    const list = byFirst.get(tokens[0]) ?? [];
    list.push({ id: n.id, types: n.types, tokens });
    byFirst.set(tokens[0], list);
    size++;
  }

  const scan = (text: string): TextMatch[] => {
    if (!text || size === 0) return [];
    const toks = tokenize(text);
    const found: TextMatch[] = [];
    for (let i = 0; i < toks.length; i++) {
      const candidates = byFirst.get(toks[i].value);
      if (!candidates) continue;
      for (const c of candidates) {
        if (i + c.tokens.length > toks.length) continue;
        let ok = true;
        for (let k = 1; k < c.tokens.length; k++) {
          if (toks[i + k].value !== c.tokens[k]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const start = toks[i].start;
        const end = toks[i + c.tokens.length - 1].end;
        found.push({ nameId: c.id, types: c.types, start, end, matchedText: text.slice(start, end) });
      }
    }
    // earliest first, and at the same start the longest first; drop anything overlapping an already kept match
    found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const kept: TextMatch[] = [];
    let lastEnd = -1;
    for (const m of found) {
      if (m.start >= lastEnd) {
        kept.push(m);
        lastEnd = m.end;
      }
    }
    return kept;
  };

  return { size, scan };
}
