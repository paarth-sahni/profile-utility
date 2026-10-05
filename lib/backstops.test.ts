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
  flagMissingDescriptions,
  hasProseLines,
  MISSING_DESCRIPTION_REASON,
  flagPronounOverview,
  applyProfileHeader,
  parseProfileHeader,
  HEADER_NOT_RECOGNISED_REASON,
  HEADER_SPECIALIZATION_LONG_REASON,
  HEADER_TAKEN_REASON,
  flagSidebarExtras,
  NOT_IN_SIDEBAR_REASON,
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
  title: "Orders Analytics",
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
  assert.deepEqual(data.projects[0].responsibilities, ["Contributed as Backend Developer to Orders Analytics"]);
  assert.deepEqual(flags, [{ path: "projects.0.responsibilities", reason: NO_RESPONSIBILITIES_REASON }]);
});

test("backstop 1: external projects use the client name", () => {
  const data = { projects: [{ client: "Northwind", role: "Tester", responsibilities: ["", "  "] }] };
  fillEmptyResponsibilities("external", data, []);
  assert.deepEqual(data.projects[0].responsibilities, ["Contributed as Tester to Northwind"]);
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
Tier 3 Backend Developer
Education 2019 B.Tech`;

test("backstop 3b: a stray digit — team size '3' (from 'Tier 3') is flagged when the label says 5-6", () => {
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

/* ---------- 3c. empty description although the source has text ---------- */

const PROJECT_SOURCE = `Project 1 - Jan 2025 - Jun 2025
Orders Analytics
Tools & Technologies
Python, FastAPI, PostgreSQL, Docker, Firebase, Azure,
Playwright, Neo4j, Pinecone, Git, Jira, Swagger
Team Size
4
Role
Backend Developer
Project Link
Internal — InfoBeans
Orders Analytics is an enterprise platform that lets teams track orders and share dashboards.
Project 2 - Jul 2025 - Dec 2025
Doc Assistant
Tools & Technologies
React, Node
Team Size
3
Role
Full Stack Developer
Project Link
NDA
`;

test("backstop 3c: empty description is flagged when the source has prose for that project", () => {
  const data = { projects: [internalProject({ description: "" }), internalProject({ title: "Doc Assistant", description: "" })] };
  const flags = flagMissingDescriptions("internal", data, [], PROJECT_SOURCE);
  assert.deepEqual(flags, [{ path: "projects.0.description", reason: MISSING_DESCRIPTION_REASON }]);
});

test("backstop 3c: non-empty descriptions, unknown projects and duplicate flags are left alone", () => {
  const ok = { projects: [internalProject({ description: "Kept." })] };
  assert.deepEqual(flagMissingDescriptions("internal", ok, [], PROJECT_SOURCE), []);
  const unknown = { projects: [internalProject({ title: "Not In Source", description: "" })] };
  assert.deepEqual(flagMissingDescriptions("internal", unknown, [], PROJECT_SOURCE), []);
  const existing = [{ path: "projects.0.description", reason: MISSING_DESCRIPTION_REASON }];
  assert.equal(flagMissingDescriptions("internal", { projects: [internalProject({ description: "" })] }, existing, PROJECT_SOURCE).length, 1);
});

test("backstop 3c: external projects are matched by client name; wrapped names still match", () => {
  const src = "Project 1\nNorthwind\nTelecom, Africa\nRole\nTester\nWorked on report mapping and testing for the telecom client.";
  const data = { projects: [{ client: "Northwind Telecom, Africa", role: "Tester", description: "" }] };
  assert.equal(flagMissingDescriptions("external", data, [], src).length, 1);
});

test("hasProseLines: labels, their values, tool lists and headings are not prose", () => {
  assert.equal(hasProseLines("Tools & Technologies\nPython, FastAPI, PostgreSQL, Docker, Firebase, Azure, Git\nTeam Size\n4\nRole\nBackend Developer"), false);
  assert.equal(hasProseLines("Project 2 - Jul 2025 - Dec 2025\nRole\nBackend Developer\nProject Link\nNDA"), false);
  assert.equal(hasProseLines("Role\nDev\nIt is an enterprise platform for managing experiments."), true);
});

/* ---------- 3d. sidebar items must come from the source sidebar ---------- */

const SIDEBAR_SOURCE = `Project 1 - Orders Analytics
Tools & Technologies
Python, FastAPI, Playwright, Neo4j, Pinecone

--- SIDEBAR ---
Skills
Java script
(3.5/5)
MVC(CodeIgniter, Laravel,
YII, CakePHP)
(3.5/5)
Certifications
ServiceNow CSA
Tools
JIRA, SVN, GIT
Domain
Healthcare
Languages
English, Hindi`;

test("backstop 3d: project tools merged into the sidebar lists are flagged; real sidebar items are not", () => {
  const data = {
    skills: [{ name: "JavaScript", rating: "3.5" }, { name: "MVC(CodeIgniter, Laravel, YII, CakePHP)", rating: "3.5" }, { name: "Neo4j", rating: "3" }],
    certifications: ["ServiceNow CSA"],
    tools: ["JIRA", "SVN", "GIT", "Playwright"],
    domains: ["Healthcare"],
    languages: ["English", "Hindi"],
    managerialExperience: [],
  };
  const flags = flagSidebarExtras("internal", data, [], SIDEBAR_SOURCE, "infobeans_internal_profile");
  assert.deepEqual(flags.map((f) => f.path).sort(), ["skills.2.name", "tools.3"]);
  assert.ok(flags.every((f) => f.reason === NOT_IN_SIDEBAR_REASON));
});

test("backstop 3d: only InfoBeans profiles on the internal template whose source has a sidebar", () => {
  const data = { tools: ["Playwright"] };
  assert.deepEqual(flagSidebarExtras("internal", data, [], SIDEBAR_SOURCE, "standard_resume"), []);
  assert.deepEqual(flagSidebarExtras("internal", data, [], SIDEBAR_SOURCE, undefined), []);
  assert.deepEqual(flagSidebarExtras("external", data, [], SIDEBAR_SOURCE, "infobeans_external_profile"), []);
  assert.deepEqual(flagSidebarExtras("internal", data, [], "no sidebar here at all, just text", "infobeans_internal_profile"), []);
  assert.equal(flagSidebarExtras("internal", data, [], SIDEBAR_SOURCE, "infobeans_internal_profile").length, 1);
});

test("applyBackstops passes the document type through to the sidebar check", () => {
  const { flags } = applyBackstops("internal", { tools: ["Playwright"], projects: [] }, [], SIDEBAR_SOURCE, "infobeans_internal_profile");
  assert.ok(flags.some((f) => f.path === "tools.0" && f.reason === NOT_IN_SIDEBAR_REASON));
});

/* ---------- 3e. header block of an existing InfoBeans profile ---------- */

const header = (...lines: string[]) => `A PROUD MEMBER OF\nMaya Fernandez\n${lines.join("\n")}\nOverview\nEngineer with experience in mobile apps.\n`;
const INFOBEANS = "infobeans_internal_profile";

test("backstop 3e: a 3-line header is read as job title, experience line, specialization", () => {
  const src = header("Lead Data Engineer", "9+ Years of Industry Experience", "Data Platforms");
  assert.deepEqual(parseProfileHeader(src, "Maya Fernandez"), ["Lead Data Engineer", "9+ Years of Industry Experience", "Data Platforms"]);
  assert.deepEqual(parseProfileHeader(src, "maya  fernandez"), ["Lead Data Engineer", "9+ Years of Industry Experience", "Data Platforms"], "name match ignores case/spacing");
});

test("backstop 3e: model values that differ are replaced and flagged; matching ones are left alone", () => {
  const src = header("Lead Data Engineer", "Fresher (4 months of internship experience)", "Quality CoE");
  const data = { name: "Maya Fernandez", jobTitle: "Lead Data Engineer", experienceSummary: "0+ Years of Industry Experience", specialization: "Test Automation" };
  const flags = applyProfileHeader(data, [], src, INFOBEANS);
  assert.equal(data.jobTitle, "Lead Data Engineer");
  assert.equal(data.experienceSummary, "Fresher (4 months of internship experience)");
  assert.equal(data.specialization, "Quality CoE");
  assert.deepEqual(flags.map((f) => f.path).sort(), ["experienceSummary", "specialization"], "no flag for the unchanged job title");
  assert.ok(flags.every((f) => f.reason === HEADER_TAKEN_REASON));
});

test("backstop 3e: a header specialization over 5 words keeps the model's value and is flagged", () => {
  const src = header("Architect", "15+ Years of Industry Experience", "Enterprise integration and cloud migration programmes");
  const data = { name: "Maya Fernandez", jobTitle: "Architect", experienceSummary: "15+ Years of Industry Experience", specialization: "Cloud Migration" };
  const flags = applyProfileHeader(data, [], src, INFOBEANS);
  assert.equal(data.specialization, "Cloud Migration");
  assert.deepEqual(flags, [{ path: "specialization", reason: HEADER_SPECIALIZATION_LONG_REASON }]);
  assert.equal(HEADER_SPECIALIZATION_LONG_REASON, "header specialization is over 5 words; shortened, please check");
  // exactly 5 words is still used
  const five = applyProfileHeader({ ...data }, [], header("Architect", "15+ Years of Industry Experience", "Cloud and data platform strategy"), INFOBEANS);
  assert.deepEqual(five.map((f) => f.reason), [HEADER_TAKEN_REASON]);
});

test("backstop 3e: '<N>+ years of industry experience' is normalised in any case; other lines are kept as written", () => {
  for (const line of ["9+ years of industry experience", "9+ YEARS OF INDUSTRY EXPERIENCE", "9+ Years Of Industry Experience", "9+  years of Industry Experience"]) {
    const data = { name: "Maya Fernandez", jobTitle: "Lead", experienceSummary: "9+ Years of Industry Experience", specialization: "Data" };
    const flags = applyProfileHeader(data, [], header("Lead", line, "Data"), INFOBEANS);
    assert.equal(data.experienceSummary, "9+ Years of Industry Experience", line);
    assert.deepEqual(flags, [], "already equal to the normalised line, so nothing to flag: " + line);
  }
  for (const line of ["Fresher (4 months of internship experience)", "Final Year MBA Student", "12 years in industry", "9+ years of industry experience in cloud"]) {
    const data = { name: "Maya Fernandez", jobTitle: "Lead", experienceSummary: "model value", specialization: "Data" };
    applyProfileHeader(data, [], header("Lead", line, "Data"), INFOBEANS);
    assert.equal(data.experienceSummary, line, "kept exactly as written");
  }
  const lower = { name: "Maya Fernandez", jobTitle: "Lead", experienceSummary: "model value", specialization: "Data" };
  const flags = applyProfileHeader(lower, [], header("Lead", "3+ years of industry experience", "Data"), INFOBEANS);
  assert.equal(lower.experienceSummary, "3+ Years of Industry Experience");
  assert.deepEqual(flags, [{ path: "experienceSummary", reason: HEADER_TAKEN_REASON }]);
});

test("backstop 3e: a 2-line or 4-line header is not recognised; model values stay and a flag is added", () => {
  for (const lines of [["Lead Data Engineer", "9+ Years of Industry Experience"], ["Lead", "9+ Years", "Data Platforms", "Extra line"]]) {
    const data = { name: "Maya Fernandez", jobTitle: "Model Title", experienceSummary: "Model Exp", specialization: "Model Spec" };
    const flags = applyProfileHeader(data, [], header(...lines), INFOBEANS);
    assert.deepEqual(data, { name: "Maya Fernandez", jobTitle: "Model Title", experienceSummary: "Model Exp", specialization: "Model Spec" });
    assert.deepEqual(flags, [{ path: "", reason: HEADER_NOT_RECOGNISED_REASON }], lines.length + " lines");
  }
});

test("backstop 3e: unknown name or missing Overview heading is not recognised; other documents are untouched", () => {
  const src = header("Lead", "9+ Years", "Data");
  const data = { name: "Someone Else", jobTitle: "x", experienceSummary: "y", specialization: "z" };
  assert.equal(applyProfileHeader(data, [], src, INFOBEANS)[0].reason, HEADER_NOT_RECOGNISED_REASON);
  assert.equal(parseProfileHeader("Maya Fernandez\nLead\n9+ Years\nData\nNo section heading", "Maya Fernandez"), null);
  assert.deepEqual(applyProfileHeader({ name: "Maya Fernandez", jobTitle: "x" }, [], src, "standard_resume"), []);
  assert.deepEqual(applyProfileHeader({ name: "Maya Fernandez", jobTitle: "x" }, [], src, undefined), []);
});

test("applyBackstops runs the header step for InfoBeans profiles only", () => {
  const src = header("Lead Data Engineer", "9+ Years of Industry Experience", "Data Platforms");
  const input = { name: "Maya Fernandez", jobTitle: "Title", experienceSummary: "Exp", specialization: "Spec", projects: [] };
  const a = applyBackstops("internal", input, [], src, "infobeans_external_profile");
  assert.equal((a.data as typeof input).specialization, "Data Platforms");
  const b = applyBackstops("internal", input, [], src, "standard_resume");
  assert.equal((b.data as typeof input).specialization, "Spec");
});
