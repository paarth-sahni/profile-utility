/**
 * Purpose: scans a profile for registered names, but only where a client can actually be identified: the candidate's name,
 * the job title, and EVERY field of every project (title, duration, tools, team size, role, link, description, bullets). The
 * Project Link is also checked for a name written as one word of a web address (Matcher.scanLink: "northwindtraders.example").
 * The rest of the profile (overview, skills, tools, certifications, education, ...) is not scanned. A string with real
 * content (not blank, not "N/A") is checked, which is what the Word templates print (see lib/docxData.ts).
 * To change what is covered, change SCANNED_PATH below (one place); every consumer works from the returned paths.
 * Paths use the same dot style as the form errors (lib/fieldErrors.ts), e.g. "projects.0.responsibilities.2".
 * Pure, so it runs in the browser (live highlights) and on the server (the gate).
 */
import { isRealText, type ResumeData } from "../schemas";
import type { Matcher, NameType, TextMatch } from "./match";

export type Violation = TextMatch & { path: string };

export const COMPLIANCE_MESSAGE =
  "Registered client, company or project name found. Remove or rephrase it so the client is not identified.";

/** The field paths that are scanned: the candidate's name, the job title, and anything inside a project. */
export const SCANNED_PATH = /^(name|jobTitle|projects\.\d+\..+)$/;
/** The Project Link field: checked as a web address too (see Matcher.scanLink). */
const LINK_PATH = /^projects\.\d+\.projectLink$/;

function* stringLeaves(value: unknown, path: string): Generator<{ path: string; text: string }> {
  if (typeof value === "string") {
    if (isRealText(value)) yield { path, text: value };
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* stringLeaves(value[i], path ? `${path}.${i}` : String(i));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* stringLeaves(v, path ? `${path}.${k}` : k);
  }
}

/** All registered-name matches in the profile, in document order of the data. */
export function findViolations(matcher: Matcher, data: ResumeData): Violation[] {
  const out: Violation[] = [];
  if (matcher.size === 0) return out;
  for (const leaf of stringLeaves(data, "")) {
    if (!SCANNED_PATH.test(leaf.path)) continue;
    const scan = LINK_PATH.test(leaf.path) ? matcher.scanLink : matcher.scan;
    for (const m of scan(leaf.text)) out.push({ ...m, path: leaf.path });
  }
  return out;
}

/** One message per field path, for the existing red field marks (several matches in a field share its message). */
export function violationsByPath(violations: readonly { path: string }[]): Record<string, string> {
  const byPath: Record<string, string> = {};
  for (const v of violations) byPath[v.path] = COMPLIANCE_MESSAGE;
  return byPath;
}

/** Highlight ranges per field path. */
export function highlightsByPath(violations: readonly { path: string; start: number; end: number }[]): Record<string, { start: number; end: number }[]> {
  const out: Record<string, { start: number; end: number }[]> = {};
  for (const v of violations) (out[v.path] ??= []).push({ start: v.start, end: v.end });
  return out;
}

/** What the API returns to the caller: where and what the caller typed, never anything else from the registry. */
export type ViolationDto = { path: string; start: number; end: number; matchedText: string; types: NameType[] };
export const toDto = (v: Violation): ViolationDto => ({
  path: v.path,
  start: v.start,
  end: v.end,
  matchedText: v.matchedText,
  types: v.types,
});
