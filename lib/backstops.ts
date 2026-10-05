/**
 * Purpose: deterministic safety nets applied to the model's extraction, because prompts alone
 * are not reliable. Backstops 1-3 run on the raw model data (before normalizeToShape):
 *   1. empty responsibilities on a project with a role -> one bullet built from the role
 *   2. overview that starts with "The candidate" / a pronoun -> flag (never rewritten)
 *   3. banned marketing words that are not in the source text -> flag the field path
 *   3b. teamSize / duration / education year values that are not in the source text -> flag
 * Backstop 4 (reconcileFlagPaths) runs on the normalized output and makes sure every review
 * flag points at a field that exists. All functions are pure except fillEmptyResponsibilities,
 * which edits the (already cloned) data it is given.
 */
import type { ReviewFlag } from "./extract.types";
import type { TemplateId } from "./schemas";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const NO_RESPONSIBILITIES_REASON = "no responsibilities stated in source";

/** Words the model tends to add on its own; flagged when they are not in the source resume. */
export const BANNED_WORDS = ["seamless", "robust", "successfully", "demonstrated", "cutting-edge", "passionate"] as const;

const bannedPattern = (word: string): RegExp =>
  new RegExp(`\\b${word.replace("-", "[-\\s]")}(ly)?\\b`, "i");

const hasFlag = (flags: ReviewFlag[], path: string, reason?: string) =>
  flags.some((f) => f.path === path && (reason === undefined || f.reason === reason));

/** 1. Fills an empty responsibilities list from the stated role; flags it. Mutates `data`. */
export function fillEmptyResponsibilities(templateId: TemplateId, data: unknown, flags: ReviewFlag[]): ReviewFlag[] {
  if (!isRecord(data) || !Array.isArray(data.projects)) return flags;
  const nameKey = templateId === "internal" ? "title" : "client";
  const out = [...flags];
  data.projects.forEach((p: unknown, i: number) => {
    if (!isRecord(p)) return;
    const bullets = Array.isArray(p.responsibilities) ? p.responsibilities.filter((b) => str(b)) : [];
    const role = str(p.role);
    const name = str(p[nameKey]);
    if (bullets.length > 0 || !role || !name) return;
    p.responsibilities = [`Contributed as ${role} to ${name}`];
    const path = `projects.${i}.responsibilities`;
    if (!hasFlag(out, path, NO_RESPONSIBILITIES_REASON)) out.push({ path, reason: NO_RESPONSIBILITIES_REASON });
  });
  return out;
}

/** 2. Flags an overview that starts with "The candidate" or a pronoun. Never rewrites it. */
export function flagPronounOverview(data: unknown, flags: ReviewFlag[]): ReviewFlag[] {
  if (!isRecord(data)) return flags;
  const overview = str(data.overview);
  if (!/^(the\s+candidate|he|she|they|his|her|their|i)\b/i.test(overview) || hasFlag(flags, "overview")) return flags;
  return [...flags, { path: "overview", reason: "Overview starts with “The candidate” or a pronoun — please reword it to start with the role" }];
}

/** 3. Flags banned words that appear in the output but not in the source text. */
export function flagBannedWords(data: unknown, flags: ReviewFlag[], sourceText: string): ReviewFlag[] {
  const out = [...flags];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      for (const word of BANNED_WORDS) {
        const re = bannedPattern(word);
        if (!re.test(node) || re.test(sourceText)) continue;
        const reason = `Contains “${word}”, which isn't in the source resume`;
        if (!hasFlag(out, path, reason)) out.push({ path, reason });
      }
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
    } else if (isRecord(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(data, "");
  return out;
}

export const VALUE_NOT_FOUND_REASON = "value not found in source, please check";

/** Lower-cases and unifies dashes/spaces so "5 – 6" and "5-6" compare equal. */
const canon = (v: string): string =>
  v
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Is `value` supported by the source? Exact (normalised) match with digit boundaries, so "3" does not
 * match inside "2023". Durations may be re-formatted by the model ("June" -> "Jun"), so for them it
 * is enough that every number in the value (years, days) appears in the source.
 */
export function valueInSource(value: string, sourceText: string, lenientNumbers = false): boolean {
  const v = canon(value);
  const src = canon(sourceText);
  if (!v) return true;
  const digitSafe = (x: string) => new RegExp(`(^|[^\\d])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\d])`).test(src);
  if (digitSafe(v)) return true;
  if (!lenientNumbers) return false;
  const numbers = v.match(/\d+/g);
  return !!numbers && numbers.every((n) => digitSafe(n));
}

/**
 * Team size is supported if it appears right after a "Team Size" label in the source. When the
 * source has no such label at all, any digit-bounded occurrence of the value is accepted. This
 * catches a model that picks up a stray "3" (page number, "Layer 3") instead of the real "5-6".
 */
export function teamSizeInSource(value: string, sourceText: string): boolean {
  const src = canon(sourceText);
  if (!/team size/.test(src)) return valueInSource(value, sourceText);
  const v = canon(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`team size\\s*[:\\-]?\\s*${v}($|[^\\d])`).test(src);
}

/** 3b. Flags teamSize, duration and education year values that don't appear in the source text. */
export function flagUnfoundValues(data: unknown, flags: ReviewFlag[], sourceText: string): ReviewFlag[] {
  if (!isRecord(data)) return flags;
  const out = [...flags];
  const check = (
    obj: unknown,
    path: string,
    key: string,
    lenient: boolean,
    found: (v: string, src: string) => boolean = (v, src) => valueInSource(v, src, lenient),
  ) => {
    if (!isRecord(obj)) return;
    const value = str(obj[key]);
    if (!value || found(value, sourceText)) return;
    const fieldPath = `${path}.${key}`;
    if (!hasFlag(out, fieldPath, VALUE_NOT_FOUND_REASON)) out.push({ path: fieldPath, reason: VALUE_NOT_FOUND_REASON });
  };
  const each = (list: unknown, name: string, fn: (item: unknown, path: string) => void) => {
    if (Array.isArray(list)) list.forEach((item, i) => fn(item, `${name}.${i}`));
  };
  each(data.projects, "projects", (p, path) => {
    check(p, path, "teamSize", false, teamSizeInSource);
    check(p, path, "duration", true);
  });
  each(data.experience, "experience", (e, path) => check(e, path, "duration", true));
  each(data.education, "education", (e, path) => check(e, path, "year", false));
  return out;
}

/** Applies backstops 1-3 to a clone of the model data; returns the fixed data and flags. */
export function applyBackstops(
  templateId: TemplateId,
  data: unknown,
  flags: ReviewFlag[],
  sourceText: string,
): { data: unknown; flags: ReviewFlag[] } {
  const copy = structuredClone(data);
  let next = fillEmptyResponsibilities(templateId, copy, flags);
  next = flagPronounOverview(copy, next);
  next = flagBannedWords(copy, next, sourceText);
  next = flagUnfoundValues(copy, next, sourceText);
  return { data: copy, flags: next };
}

/** Resolves a dot path against `data`; returns the (possibly corrected) path or null if it can't exist. */
function resolvePath(data: unknown, rawPath: string): string | null {
  const segments = rawPath
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let node: unknown = data;
  const fixed: string[] = [];
  for (const seg of segments) {
    if (Array.isArray(node)) {
      if (/^\d+$/.test(seg)) {
        const idx = Number(seg);
        if (idx >= node.length) return fixed.length > 0 && typeof node[0] === "string" ? fixed.join(".") : null;
        node = node[idx];
        fixed.push(seg);
        continue;
      }
      // "education.year" on a single-entry list means entry 0
      if (node.length === 1 && isRecord(node[0]) && seg in node[0]) {
        node = node[0][seg];
        fixed.push("0", seg);
        continue;
      }
      return null;
    }
    if (isRecord(node) && seg in node) {
      node = node[seg];
      fixed.push(seg);
      continue;
    }
    return null;
  }
  return fixed.join(".");
}

/**
 * 4. Keeps only flags that point at a real field of the output. Fixes common slips (brackets,
 * an implicit entry 0, an index past the end of a string list -> the list itself); drops the rest.
 * Document-level flags (empty path) are kept as they are.
 */
export function reconcileFlagPaths(data: unknown, flags: ReviewFlag[]): ReviewFlag[] {
  const seen = new Set<string>();
  const out: ReviewFlag[] = [];
  for (const f of flags) {
    const path = f.path.trim() === "" ? "" : resolvePath(data, f.path);
    if (path === null) continue;
    const key = `${path}|${f.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, reason: f.reason });
  }
  return out;
}
