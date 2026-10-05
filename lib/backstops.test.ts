/**
 * Purpose: unit tests for the truthfulness code backstops (lib/backstops.ts). Run with `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_RESPONSIBILITIES_REASON,
  applyBackstops,
  fillEmptyResponsibilities,
  flagBannedWords,
  flagPronounOverview,
  reconcileFlagPaths,
} from "./backstops";
import { normalizeToShape } from "./normalize";
import type { ReviewFlag } from "./extract.types";

const internalProject = (over: Record<string, unknown> = {}) => ({
  duration: "Jan 2025 - Jun 2025",
  title: "Expona 2.0",
  toolsAndTechnologies: ["Python"],
  teamSize: "4",
  role: "Backend Developer",
  projectLink: "NDA",
  description: "An enterprise platform.",
  responsibilities: [],
  ...over,
});

/* ---------- 1. empty responsibilities ---------- */

test("backstop 1: empty responsibilities + role -> role bullet and flag (internal uses title)", () => {
  const data = { projects: [internalProject()] };
  const flags = fillEmptyResponsibilities("internal", data, []);
  assert.deepEqual(data.projects[0].responsibilities, ["Contributed as Backend Developer to Expona 2.0"]);
  assert.deepEqual(flags, [{ path: "projects.0.responsibilities", reason: NO_RESPONSIBILITIES_REASON }]);
});

test("backstop 1: external projects use the client name", () => {
  const data = { projects: [{ client: "Airtel", role: "Tester", responsibilities: ["", "  "] }] };
  fillEmptyResponsibilities("external", data, []);
  assert.deepEqual(data.projects[0].responsibilities, ["Contributed as Tester to Airtel"]);
});

test("backstop 1: leaves existing bullets, roleless projects and existing flags alone", () => {
  const data = {
    projects: [internalProject({ responsibilities: ["Built the API."] }), internalProject({ role: "" }), internalProject()],
  };
  const existing: ReviewFlag[] = [{ path: "projects.2.responsibilities", reason: NO_RESPONSIBILITIES_REASON }];
  const flags = fillEmptyResponsibilities("internal", data, existing);
  assert.deepEqual(data.projects[0].responsibilities, ["Built the API."]);
  assert.deepEqual(data.projects[1].responsibilities, []);
  assert.equal(flags.length, 1, "no duplicate flag when the model already flagged it");
  assert.equal(data.projects[2].responsibilities.length, 1);
});

/* ---------- 2. pronoun overview ---------- */

test("backstop 2: flags overviews starting with The candidate / He / She / They, without rewriting", () => {
  for (const start of ["The candidate is", "He has", "She built", "They work", "the Candidate ", "Her focus"]) {
    const data = { overview: `${start} a developer.` };
    const flags = flagPronounOverview(data, []);
    assert.equal(flags.length, 1, start);
    assert.equal(flags[0].path, "overview");
    assert.equal(data.overview, `${start} a developer.`, "overview must not be rewritten");
  }
});

test("backstop 2: role-first overviews and words merely starting with 'he' are not flagged", () => {
  for (const o of ["Computer Science graduate specializing in AI.", "Contoso consultant with 5 years.", "Theme designer with…"]) {
    assert.deepEqual(flagPronounOverview({ overview: o }, []), [], o);
  }
});

/* ---------- 3. banned words ---------- */

test("backstop 3: banned words absent from the source are flagged at their field path", () => {
  const data = {
    overview: "Engineer who successfully delivered projects.",
    projects: [{ responsibilities: ["Built a robust API.", "Wrote tests."], description: "A cutting edge tool" }],
  };
  const flags = flagBannedWords(data, [], "Built an API. Wrote tests.");
  const paths = flags.map((f) => f.path).sort();
  assert.deepEqual(paths, ["overview", "projects.0.description", "projects.0.responsibilities.0"]);
  assert.ok(flags.every((f) => /isn't in the source/.test(f.reason)));
});

test("backstop 3: words that are in the source are not flagged (case-insensitive)", () => {
  const data = { overview: "Passionate engineer who Successfully shipped a Robust platform." };
  assert.deepEqual(flagBannedWords(data, [], "I am passionate; we successfully shipped a robust platform"), []);
});

test("applyBackstops: clones the input, normalised output then passes the responsibilities check", () => {
  const original = { projects: [internalProject()], overview: "The candidate builds things." };
  const { data, flags } = applyBackstops("internal", original, [], "source");
  assert.deepEqual((original.projects[0].responsibilities as unknown[]).length, 0, "input is not mutated");
  const normalized = normalizeToShape("internal", data);
  assert.equal(normalized.projects[0].responsibilities.length, 1);
  assert.deepEqual(flags.map((f) => f.path).sort(), ["overview", "projects.0.responsibilities"]);
});

/* ---------- 4. flag paths ---------- */

test("backstop 4: valid paths are kept, unknown paths and out-of-range indexes are dropped", () => {
  const data = normalizeToShape("internal", { projects: [internalProject({ responsibilities: ["a"] })], skills: [{ name: "Go", rating: "3" }] });
  const flags: ReviewFlag[] = [
    { path: "projects.0.duration", reason: "ok" },
    { path: "skills.0.rating", reason: "ok" },
    { path: "projects.5.duration", reason: "no such project" },
    { path: "projects.0.nonsense", reason: "no such field" },
    { path: "", reason: "document-level" },
  ];
  assert.deepEqual(reconcileFlagPaths(data, flags).map((f) => f.path), ["projects.0.duration", "skills.0.rating", ""]);
});

test("backstop 4: fixes brackets, implicit entry 0 and indexes past the end of a string list", () => {
  const data = normalizeToShape("internal", {
    education: [{ year: "2020", qualification: "B.Tech" }],
    certifications: ["AZ-900"],
    projects: [internalProject({ responsibilities: ["a", "b"] })],
  });
  const fixed = reconcileFlagPaths(data, [
    { path: "projects[0].duration", reason: "brackets" },
    { path: "education.year", reason: "implicit 0" },
    { path: "certifications.4", reason: "index past end" },
  ]);
  assert.deepEqual(fixed.map((f) => f.path), ["projects.0.duration", "education.0.year", "certifications"]);
});

test("backstop 4: duplicate flags collapse", () => {
  const data = normalizeToShape("external", { name: "A" });
  const flags = reconcileFlagPaths(data, [
    { path: "name", reason: "x" },
    { path: "name", reason: "x" },
  ]);
  assert.equal(flags.length, 1);
});
