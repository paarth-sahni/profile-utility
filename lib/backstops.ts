/**
 * Purpose: deterministic safety nets applied to the model's extraction, because prompts alone
 * are not reliable. Backstops 1-3 run on the raw model data (before normalizeToShape):
 *   1. empty responsibilities on a project with a role -> one bullet built from the role
 *   2. overview that starts with "The candidate" / a pronoun -> flag (never rewritten)
 *   3. banned marketing words that are not in the source text -> flag the field path
 *   3b. teamSize / duration / education year values that are not in the source text -> flag
 *   3c. empty project description although the source has text for that project -> flag
 *   3d. existing InfoBeans profile: sidebar items not found in the source's sidebar -> flag
 *   3e. existing InfoBeans profile: job title / experience line / specialization read from the header
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
 * catches a model that picks up a stray "3" (page number, "Tier 3") instead of the real "5-6".
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

export const MISSING_DESCRIPTION_REASON = "description missing, source has text";

/** Field labels in InfoBeans profiles; their values are not prose. "Tools" values can wrap over several lines. */
const LABEL_LINE = /^(tools\s*&\s*technologies|team\s*size|role|project\s*link|duration)\s*:?$/i;
const MULTI_LINE_LABEL = /^tools\s*&\s*technologies\s*:?$/i;

/** True if `text` contains at least one line of prose (6+ words) once labels, their values and headings are skipped. */
export function hasProseLines(text: string): boolean {
  let skipUntilLabel = false;
  let skipOne = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (LABEL_LINE.test(line)) {
      skipUntilLabel = MULTI_LINE_LABEL.test(line);
      skipOne = !skipUntilLabel;
      continue;
    }
    if (skipOne) {
      skipOne = false;
      continue;
    }
    if (skipUntilLabel || /^project\s*\d+\b/i.test(line) || line === "--- SIDEBAR ---") continue;
    if (line.split(/\s+/).length >= 6) return true;
  }
  return false;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches a project name even if the PDF wrapped it over several lines. */
const nameRegex = (name: string) => new RegExp(name.trim().split(/\s+/).map(escapeRe).join("\\s+"), "i");

/** The slice of the source that belongs to one project: after its name, up to the next project's name. */
function projectWindow(name: string, otherNames: string[], sourceText: string): string | null {
  const start = nameRegex(name).exec(sourceText);
  if (!start) return null;
  const from = start.index + start[0].length;
  let end = Math.min(sourceText.length, from + 2500);
  const sidebar = sourceText.indexOf("--- SIDEBAR ---", from);
  if (sidebar !== -1) end = Math.min(end, sidebar);
  for (const other of otherNames) {
    const m = nameRegex(other).exec(sourceText.slice(from));
    if (m && from + m.index < end) end = from + m.index;
  }
  return sourceText.slice(from, end);
}

/** 3c. Flags an empty project description when the source has prose for that project. */
export function flagMissingDescriptions(templateId: TemplateId, data: unknown, flags: ReviewFlag[], sourceText: string): ReviewFlag[] {
  if (!isRecord(data) || !Array.isArray(data.projects)) return flags;
  const nameKey = templateId === "internal" ? "title" : "client";
  const names = data.projects.map((p: unknown) => (isRecord(p) ? str(p[nameKey]) : ""));
  const out = [...flags];
  data.projects.forEach((p: unknown, i: number) => {
    if (!isRecord(p) || str(p.description) || !names[i]) return;
    const window = projectWindow(names[i], names.filter((n, j) => j !== i && n), sourceText);
    if (!window || !hasProseLines(window)) return;
    const path = `projects.${i}.description`;
    if (!hasFlag(out, path, MISSING_DESCRIPTION_REASON)) out.push({ path, reason: MISSING_DESCRIPTION_REASON });
  });
  return out;
}

export const NOT_IN_SIDEBAR_REASON = "not found in the source sidebar";
const SIDEBAR_MARKER = "--- SIDEBAR ---";

/** Compares ignoring case, spacing and punctuation ("Java script" == "JavaScript"). */
const squash = (v: string): string => v.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/**
 * 3d. For an existing InfoBeans profile, the sidebar lists (skills, certifications, tools, domains,
 * languages, managerialExperience) must hold only what the source sidebar lists — e.g. project tools
 * must not leak into the sidebar Tools. Flags items missing from the "--- SIDEBAR ---" section.
 * Does nothing for other documents, for the external template, or when the source has no sidebar.
 */
export function flagSidebarExtras(
  templateId: TemplateId,
  data: unknown,
  flags: ReviewFlag[],
  sourceText: string,
  documentType: string | undefined,
): ReviewFlag[] {
  if (templateId !== "internal" || !documentType?.startsWith("infobeans_") || !isRecord(data)) return flags;
  const at = sourceText.indexOf(SIDEBAR_MARKER);
  if (at === -1) return flags;
  const sidebar = squash(sourceText.slice(at + SIDEBAR_MARKER.length));
  if (sidebar.length < 20) return flags;

  const out = [...flags];
  const check = (list: unknown, name: string, pick: (item: unknown) => string, suffix = "") => {
    if (!Array.isArray(list)) return;
    list.forEach((item, i) => {
      const value = pick(item);
      if (!value || sidebar.includes(squash(value))) return;
      const path = `${name}.${i}${suffix}`;
      if (!hasFlag(out, path, NOT_IN_SIDEBAR_REASON)) out.push({ path, reason: NOT_IN_SIDEBAR_REASON });
    });
  };
  check(data.skills, "skills", (item) => (isRecord(item) ? str(item.name) : ""), ".name");
  for (const name of ["certifications", "tools", "domains", "languages", "managerialExperience"]) {
    check(data[name], name, (item) => str(item));
  }
  return out;
}

export const HEADER_TAKEN_REASON = "taken from profile header";
export const HEADER_NOT_RECOGNISED_REASON = "header not recognised — please check job title, experience and specialization";

/** Boilerplate the template prints in the header area; not part of the three header lines. */
const HEADER_BOILERPLATE = /^a proud member of$/i;

const wordCountOf = (v: string): number => v.trim().split(/\s+/).filter(Boolean).length;

/**
 * Reads the header block of an existing InfoBeans profile: the lines between the candidate's name
 * and the first "Overview" heading. Returns the lines (job title, experience line, specialization)
 * only when there are exactly three; otherwise null.
 */
export function parseProfileHeader(sourceText: string, name: string): [string, string, string] | null {
  const lines = sourceText.split("\n").map((l) => l.trim());
  const nameKey = squash(name);
  if (!nameKey) return null;
  const nameAt = lines.findIndex((l) => l && squash(l) === nameKey);
  if (nameAt === -1) return null;
  const overviewAt = lines.findIndex((l, i) => i > nameAt && /^overview$/i.test(l));
  if (overviewAt === -1) return null;
  const block = lines.slice(nameAt + 1, overviewAt).filter((l) => l && !HEADER_BOILERPLATE.test(l));
  return block.length === 3 ? [block[0], block[1], block[2]] : null;
}

/**
 * 3e. For an existing InfoBeans profile, takes jobTitle, experienceSummary and specialization
 * straight from the source header (deterministic; the model sometimes rewrites them). A value
 * that differs from the model's is flagged; a header of any other shape leaves the model's values
 * and is flagged. The specialization is only used when it has 5 words or fewer. Mutates `data`.
 */
export function applyProfileHeader(
  data: unknown,
  flags: ReviewFlag[],
  sourceText: string,
  documentType: string | undefined,
): ReviewFlag[] {
  if (!documentType?.startsWith("infobeans_") || !isRecord(data)) return flags;
  const out = [...flags];
  const header = parseProfileHeader(sourceText, str(data.name));
  if (!header) {
    if (!hasFlag(out, "", HEADER_NOT_RECOGNISED_REASON)) out.push({ path: "", reason: HEADER_NOT_RECOGNISED_REASON });
    return out;
  }
  const fields: [string, string][] = [
    ["jobTitle", header[0]],
    ["experienceSummary", header[1]],
    ["specialization", header[2]],
  ];
  for (const [key, value] of fields) {
    if (key === "specialization" && wordCountOf(value) > 5) continue;
    if (canon(str(data[key])) === canon(value)) continue;
    data[key] = value;
    if (!hasFlag(out, key, HEADER_TAKEN_REASON)) out.push({ path: key, reason: HEADER_TAKEN_REASON });
  }
  return out;
}

/** Applies backstops 1-3 to a clone of the model data; returns the fixed data and flags. */
export function applyBackstops(
  templateId: TemplateId,
  data: unknown,
  flags: ReviewFlag[],
  sourceText: string,
  documentType?: string,
): { data: unknown; flags: ReviewFlag[] } {
  const copy = structuredClone(data);
  let next = fillEmptyResponsibilities(templateId, copy, flags);
  next = flagPronounOverview(copy, next);
  next = flagBannedWords(copy, next, sourceText);
  next = flagUnfoundValues(copy, next, sourceText);
  next = flagMissingDescriptions(templateId, copy, next, sourceText);
  next = flagSidebarExtras(templateId, copy, next, sourceText, documentType);
  next = applyProfileHeader(copy, next, sourceText, documentType);
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
