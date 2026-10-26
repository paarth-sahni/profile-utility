/** Purpose: unit tests for grouping review flags (same reason + same kind of field -> one line with a count). */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewFlag } from "./extract.types";
import { countText, formatIndices, groupFlags } from "./flagGroups";

const RATING = "rating estimated from years of use";
const skillFlags = (n: number): ReviewFlag[] => Array.from({ length: n }, (_, i) => ({ path: `skills.${i}.rating`, reason: RATING }));

test("twelve skill-rating flags become one group: 'Skills 1–12 → Rating … (12 skills)'", () => {
  const groups = groupFlags(skillFlags(12));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Skills 1–12 → Rating");
  assert.equal(groups[0].reason, RATING);
  assert.equal(countText(groups[0]), "(12 skills)");
  assert.equal(groups[0].flags.length, 12);
});

test("every original flag is kept, once, in its original order (nothing is lost by grouping)", () => {
  const flags: ReviewFlag[] = [
    ...skillFlags(3),
    { path: "overview", reason: "overview repeats the header" },
    { path: "skills.5.rating", reason: RATING },
    { path: "projects.0.teamSize", reason: "value not found in source, please check" },
  ];
  const groups = groupFlags(flags);
  const flat = groups.flatMap((g) => g.flags);
  assert.equal(flat.length, flags.length);
  assert.deepEqual([...flat].sort((a, b) => a.path.localeCompare(b.path)), [...flags].sort((a, b) => a.path.localeCompare(b.path)));
  assert.deepEqual(groups.find((g) => g.reason === RATING)?.flags.map((f) => f.path), ["skills.0.rating", "skills.1.rating", "skills.2.rating", "skills.5.rating"]);
});

test("a single flag keeps exactly its own label (as the panel showed it before grouping)", () => {
  const [g] = groupFlags([{ path: "projects.1.duration", reason: "Not stated in the resume" }]);
  assert.equal(g.label, "Project 2 → Duration");
  assert.equal(g.flags.length, 1);
  assert.equal(groupFlags([{ path: "", reason: "General note" }])[0].label, "");
});

test("non-contiguous indices are listed, runs are shortened", () => {
  assert.equal(formatIndices([0, 2, 4]), "1, 3, 5");
  assert.equal(formatIndices([0, 1, 2, 4]), "1–3, 5");
  assert.equal(formatIndices([0, 1]), "1, 2");
  assert.equal(formatIndices([3, 3, 3]), "4");
  assert.equal(formatIndices([9, 10, 11, 0]), "1, 10–12");
  const [g] = groupFlags([0, 2, 7].map((i) => ({ path: `skills.${i}.rating`, reason: RATING })));
  assert.equal(g.label, "Skills 1, 3, 8 → Rating");
});

test("different reasons on the same kind of field stay separate, in order of first appearance", () => {
  const groups = groupFlags([
    { path: "skills.0.rating", reason: RATING },
    { path: "skills.1.rating", reason: "rating missing in source" },
    { path: "skills.2.rating", reason: RATING },
  ]);
  assert.deepEqual(groups.map((g) => g.reason), [RATING, "rating missing in source"]);
  assert.equal(groups[0].flags.length, 2);
});

test("the same reason on different kinds of field stays separate (a vague 'several fields' line would hide what to check)", () => {
  const reason = "value not found in source, please check";
  const groups = groupFlags([
    { path: "projects.0.teamSize", reason },
    { path: "projects.1.teamSize", reason },
    { path: "projects.0.duration", reason },
    { path: "education.0.year", reason },
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Projects 1, 2 → Team Size", "Project 1 → Duration", "Education → Year"]);
  assert.equal(countText(groups[0]), "(2 projects)");
});

test("reasons are compared trimmed and case-insensitively", () => {
  const groups = groupFlags([
    { path: "skills.0.rating", reason: "Rating estimated from years of use" },
    { path: "skills.1.rating", reason: "  rating estimated from years of use " },
  ]);
  assert.equal(groups.length, 1);
});

test("two numbered levels: indices per level, count names the inner items", () => {
  const reason = "bullet repeats another bullet in this entry";
  const [g] = groupFlags([
    { path: "projects.0.responsibilities.1", reason },
    { path: "projects.0.responsibilities.2", reason },
    { path: "projects.1.responsibilities.1", reason },
  ]);
  assert.equal(g.label, "Projects 1, 2 → Responsibilities 2, 3");
  assert.equal(countText(g), "(3 responsibilities)");
});

test("grouped flags without a numbered part say how many flags there are", () => {
  const [g] = groupFlags([{ path: "overview", reason: "x" }, { path: "overview", reason: "x" }]);
  assert.equal(countText(g), "(2 flags)");
  assert.equal(g.label, "Overview");
});

test("no flags, no groups", () => {
  assert.deepEqual(groupFlags([]), []);
});
