/**
 * Purpose: turns validation problems into what the Review screen needs to point at fields: a map from field key
 * ("name", "education.0.year", "projects.0.title") to a short message, and a readable list for the summary box.
 * Pure; unit-tested (lib/fieldErrors.test.ts).
 */
import { describeFieldPath } from "./schemas";

/** A problem with a machine path (zod issue) and its message. */
export interface PathIssue {
  path: (string | number)[];
  message: string;
}

export interface FieldProblem {
  /** Dot path of the field, e.g. "projects.0.title". */
  key: string;
  /** Human label, e.g. "Projects → Project name 1"-style text from describeFieldPath. */
  label: string;
  /** Short sentence for the user. */
  message: string;
}

export interface FieldErrors {
  /** Field key -> message (first problem wins). */
  byPath: Record<string, string>;
  list: FieldProblem[];
}

/** "name is required" -> "Required"; "at least one skill" -> "Add at least one skill"; others are capitalised. */
export function friendlyMessage(message: string): string {
  const m = message.trim();
  if (/ is required$/i.test(m)) return "Required";
  if (/^at least one /i.test(m)) return `Add ${m.charAt(0).toLowerCase()}${m.slice(1)}`;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export const pathKey = (path: (string | number)[]): string => path.join(".");

/** Builds the map and the list from problems that carry machine paths. */
export function toFieldErrors(issues: PathIssue[]): FieldErrors {
  const byPath: Record<string, string> = {};
  const list: FieldProblem[] = [];
  for (const issue of issues) {
    const key = pathKey(issue.path);
    const message = friendlyMessage(issue.message);
    if (!(key in byPath)) byPath[key] = message;
    list.push({ key, label: issue.path.length ? describeFieldPath(issue.path) : "Profile", message });
  }
  return { byPath, list };
}

/** True when any error key is `prefix` itself or inside it ("projects" matches "projects.0.title"). */
export function hasErrorUnder(byPath: Record<string, string> | undefined, ...prefixes: string[]): boolean {
  if (!byPath) return false;
  return Object.keys(byPath).some((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`)));
}
