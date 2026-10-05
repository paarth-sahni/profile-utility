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
  flagUnfoundValues,
  reconcileFlagPaths,
  teamSizeInSource,
  valueInSource,
  VALUE_NOT_FOUND_REASON,
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
  // the throwaway source text "source" contains neither the duration nor the team size, so those are flagged too
  assert.deepEqual(flags.map((f) => f.path).sort(), ["overview", "projects.0.duration", "projects.0.responsibilities", "projects.0.teamSize"]);
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

/* ---------- 3b. values not found in the source ---------- */

const SOURCE = `Project 3 - Feb 2025 - June 2025
Team Size
5-6
Role
Layer 3 Backend Developer
Education 2019 B.Tech`;

test("backstop 3b: the page-number case — team size '3' (from 'Layer 3') is flagged when the label says 5-6", () => {
  const data = { projects: [{ teamSize: "3", duration: "Feb 2025 - June 2025" }], education: [{ year: "2019" }] };
  const flags = flagUnfoundValues(data, [], SOURCE);
  assert.deepEqual(flags, [{ path: "projects.0.teamSize", reason: VALUE_NOT_FOUND_REASON }]);
});

test("backstop 3b: values that are in the source are not flagged (ranges, dash variants, reformatted months)", () => {
  assert.ok(teamSizeInSource("5-6", SOURCE));
  assert.ok(teamSizeInSource("5 – 6", SOURCE), "en dash and spaces are equivalent");
  const data = { projects: [{ teamSize: "5-6", duration: "Feb 2025 - Jun 2025" }], education: [{ year: "2019" }] };
  assert.deepEqual(flagUnfoundValues(data, [], SOURCE), []);
});

test("backstop 3b: missing duration, education year and experience duration are flagged with their paths", () => {
  const data = {
    projects: [{ teamSize: "", duration: "Jan 2010 - Dec 2010" }],
    experience: [{ duration: "2001 - 2003" }],
    education: [{ year: "1999" }],
  };
  const paths = flagUnfoundValues(data, [], SOURCE).map((f) => f.path).sort();
  assert.deepEqual(paths, ["education.0.year", "experience.0.duration", "projects.0.duration"]);
});

test("backstop 3b: digits must match on boundaries; empty values and existing flags are left alone", () => {
  assert.equal(valueInSource("3", "joined in 2023"), false, "'3' is not inside '2023'");
  assert.equal(valueInSource("2023", "joined in 2023"), true);
  assert.equal(teamSizeInSource("4", "we were a team of 4 people"), true, "no label in the source: plain match");
  const existing = [{ path: "education.0.year", reason: VALUE_NOT_FOUND_REASON }];
  assert.equal(flagUnfoundValues({ education: [{ year: "1999" }] }, existing, SOURCE).length, 1, "no duplicate flag");
});

test("applyBackstops includes the not-found check", () => {
  const { flags } = applyBackstops("internal", { projects: [internalProject({ teamSize: "3", responsibilities: ["x"] })] }, [], SOURCE);
  assert.ok(flags.some((f) => f.path === "projects.0.teamSize" && f.reason === VALUE_NOT_FOUND_REASON));
});
