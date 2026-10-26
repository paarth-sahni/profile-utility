/**
 * Purpose: groups the "Please double-check" review flags that say the same thing about the same kind of field into one
 * line with a count, e.g. twelve flags "skills.0.rating" ... "skills.11.rating" with the reason "rating estimated from years
 * of use" become one group: "Skills 1–12 → Rating — rating estimated from years of use (12 skills)". Every original flag is
 * kept inside its group (in order), so the panel can expand a group to list each flag with its own full field label.
 * Pure (no React); unit-tested in lib/flagGroups.test.ts.
 */
import type { ReviewFlag } from "./extract.types";
import { describeFlagPath } from "./reviewFlags";
import { isSingularSection, labelForSegment } from "./schemas";

export interface FlagGroup {
  /** The shared reason (as written on the first flag of the group). */
  reason: string;
  /** Readable field label for the whole group, e.g. "Skills 1–12 → Rating"; for a single flag, its own label. */
  label: string;
  /** What the count refers to, e.g. "skills" (empty when the path has no numbered part). */
  noun: string;
  /** The original flags, in their original order. */
  flags: ReviewFlag[];
}

const segmentsOf = (path: string): (string | number)[] =>
  path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** The path with every number replaced by "#": two flags of the same kind of field share a shape. */
const shapeOf = (path: string): string =>
  segmentsOf(path)
    .map((s) => (typeof s === "number" ? "#" : s))
    .join(".");

/** "Responsibility" -> "Responsibilities", "Skill" -> "Skills". */
const plural = (label: string): string => (/[^aeiou]y$/i.test(label) ? `${label.slice(0, -1)}ies` : `${label}s`);

/** 1-based display of a set of 0-based indices: [0..11] -> "1–12", [0,2,4] -> "1, 3, 5", [0,1,2,4] -> "1–3, 5". */
export function formatIndices(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j > i + 1 ? `${sorted[i] + 1}–${sorted[j] + 1}` : sorted.slice(i, j + 1).map((n) => String(n + 1)).join(", "));
    i = j + 1;
  }
  return runs.join(", ");
}

/** Builds "Skills 1–12 → Rating" for flags that share one shape; returns the label and the noun the count refers to. */
function groupLabel(flags: ReviewFlag[]): { label: string; noun: string } {
  const parsed = flags.map((f) => segmentsOf(f.path));
  const shape = parsed[0];
  const labels: string[] = [];
  let noun = "";
  shape.forEach((seg, pos) => {
    if (typeof seg === "number") {
      const prev = shape[pos - 1];
      if (typeof prev !== "string" || isSingularSection(prev) || labels.length === 0) return;
      const used = parsed.map((p) => p[pos]).filter((n): n is number => typeof n === "number");
      const distinct = new Set(used);
      const base = labels[labels.length - 1];
      if (distinct.size > 1) {
        labels[labels.length - 1] = `${plural(base)} ${formatIndices(used)}`;
        noun = plural(base).toLowerCase();
      } else {
        labels[labels.length - 1] = `${base} ${formatIndices(used)}`;
        noun = noun || `${base.toLowerCase()}s`;
      }
    } else {
      labels.push(labelForSegment(seg));
    }
  });
  return { label: labels.join(" → ") || "This resume", noun };
}

/**
 * Groups flags by (reason, field shape), keeping first-appearance order. The reason is compared trimmed and case-insensitively.
 * A group of one flag carries that flag's own label, exactly as the panel showed it before grouping.
 */
export function groupFlags(flags: ReviewFlag[]): FlagGroup[] {
  const groups = new Map<string, ReviewFlag[]>();
  for (const f of flags) {
    const key = `${f.reason.trim().toLowerCase()}\u0000${shapeOf(f.path)}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.values()].map((list) => {
    if (list.length === 1) return { reason: list[0].reason, label: list[0].path ? describeFlagPath(list[0].path) : "", noun: "", flags: list };
    const { label, noun } = groupLabel(list);
    return { reason: list[0].reason, label, noun, flags: list };
  });
}

/** The short count text for a group of more than one flag: "(12 skills)" or "(×3)" when there is nothing to name. */
export const countText = (g: FlagGroup): string => `(${g.flags.length}${g.noun ? ` ${g.noun}` : " flags"})`;
