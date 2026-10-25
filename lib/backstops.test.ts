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
  BULLET_REPEATS_BULLET_REASON,
  BULLET_REPEATS_DESCRIPTION_REASON,
  DESCRIPTION_STARTS_WITH_TITLE_REASON,
  OVERVIEW_REPEATS_HEADER_REASON,
  contentTokens,
  firstSentence,
  flagDescriptionStartsWithTitle,
  flagOverviewRepeatsHeader,
  flagRepeatedBullets,
  tokenOverlap,
  DATE_NOT_RECOGNISED_REASON,
  normalizeDurations,
  DESCRIPTION_MIN_WORDS,
  NO_DESCRIPTION_REASON,
  SHORT_DESCRIPTION_REASON,
  flagShortDescriptions,
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
  // the throwaway source text "source" contains neither the duration nor the team size, so those are flagged too, and
  // the 3-word description is under 2 lines
  assert.deepEqual(flags.map((f) => f.path).sort(), ["overview", "projects.0.description", "projects.0.duration", "projects.0.responsibilities", "projects.0.teamSize"]);
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

// ---------------------------------------------------------------------------------------------------------
// No-repetition backstops (3f-3h). Fictional data only. Each check only FLAGS; the data is never rewritten.
// ---------------------------------------------------------------------------------------------------------

const hdr = (over: Record<string, string> = {}) => ({
  jobTitle: "Data Engineer",
  experienceSummary: "6+ Years of Industry Experience",
  specialization: "Streaming Analytics",
  overview: "",
  ...over,
});
const overviewFlags = (over: Record<string, string>) => flagOverviewRepeatsHeader(hdr(over), []);

test("tokens: stop words dropped, plurals and endings stemmed, numbers and C#/C++ kept", () => {
  assert.deepEqual(contentTokens("The pipelines were migrated to C# and Node.js"), ["pipelin", "migrat", "c#", "node", "js"]);
  assert.deepEqual(contentTokens("pipeline pipelines migrate migrates migrated migrating"), ["pipelin", "pipelin", "migrat", "migrat", "migrat", "migrat"], "all forms of one word compare equal");
  assert.equal(tokenOverlap(["a", "b", "c", "d"], ["a", "b", "c", "x"]), 0.75);
  assert.equal(tokenOverlap([], ["a"]), 0);
});

test("firstSentence keeps abbreviations and product names together", () => {
  assert.equal(firstSentence("Builds services in Node.js for retail. Also mentors."), "Builds services in Node.js for retail.");
  assert.equal(firstSentence("Single sentence without a full stop"), "Single sentence without a full stop");
});

test("overview: opening with the job title and the years is flagged (the classic case)", () => {
  const r = overviewFlags({ overview: "Data Engineer with 6+ years of experience building pipelines for retail analytics. Works on batch jobs." });
  assert.deepEqual(r, [{ path: "overview", reason: OVERVIEW_REPEATS_HEADER_REASON }]);
});

test("overview: the job title alone, reordered, plural or without its seniority prefix, is flagged", () => {
  const flagged = (title: string, overview: string) => flagOverviewRepeatsHeader({ ...hdr({ jobTitle: title }), overview }, []).length === 1;
  assert.ok(flagged("Senior Software Engineer", "Software engineer who builds payment systems for banks."));
  assert.ok(flagged("Engineering Manager", "Manager of engineering teams that ship retail platforms."));
  assert.ok(flagged("Cloud Architect", "Cloud architects design platforms for regulated industries."), "plural / stem");
  assert.ok(flagged("Developer", "Developer of retail apps and checkout flows."), "a one-word title that opens the sentence");
});

test("overview: the years of experience alone is flagged, with the header's years or any years-of-experience phrase", () => {
  assert.equal(overviewFlags({ overview: "Builds pipelines for retail analytics with 6 years in the field." }).length, 1, "the header's own years");
  assert.equal(overviewFlags({ overview: "Builds pipelines for retail analytics with over 15 years of professional experience." }).length, 1, "years that differ from the header");
  assert.equal(overviewFlags({ overview: "Brings 8+ years of hands-on experience to retail analytics." }).length, 1);
  assert.equal(overviewFlags({ overview: "Brings experience of 9 years to retail analytics." }).length, 1);
});

test("overview: the specialization restated in the first sentence is flagged", () => {
  assert.equal(overviewFlags({ overview: "Specialises in analytics over streaming data for retail clients." }).length, 1);
});

test("overview: a header-free opening is NOT flagged (substance first, header words only in later sentences)", () => {
  assert.deepEqual(overviewFlags({ overview: "Builds batch and streaming pipelines for retail analytics. Data engineer on three platform migrations over 6 years." }), []);
  assert.deepEqual(overviewFlags({ overview: "Designs ingestion jobs for order and inventory data." }), []);
});

test("overview: ordinary vocabulary is NOT flagged", () => {
  // a one-word title deep in the sentence is just a word
  assert.deepEqual(flagOverviewRepeatsHeader({ ...hdr({ jobTitle: "Developer" }), overview: "Leads a team of developers delivering retail apps." }, []), []);
  // a number that is not an experience statement
  assert.deepEqual(overviewFlags({ overview: "Manages delivery for 6 services and a 6 year migration programme." }), []);
  // only some of the title words, far apart
  assert.deepEqual(flagOverviewRepeatsHeader({ ...hdr({ jobTitle: "Release Engineering Manager" }), overview: "Coordinates release calendars across four product teams and an engineering group, reporting to a manager of operations." }, []), []);
  // one shared word of a multi-word specialization
  assert.deepEqual(overviewFlags({ overview: "Streams order events into dashboards for store managers." }), [], "a single word of 'Streaming Analytics' is not a restatement");
});

test("overview: empty overview, empty header fields and an existing identical flag add nothing", () => {
  assert.deepEqual(overviewFlags({ overview: "" }), []);
  assert.equal(flagOverviewRepeatsHeader({ overview: "Builds pipelines with 6 years of experience." }, []).length, 1, "a years phrase flags even when the header fields are empty");
  assert.deepEqual(flagOverviewRepeatsHeader({ overview: "Builds pipelines for retail analytics." }, []), [], "no header fields and no years phrase: nothing to compare");
  const existing = [{ path: "overview", reason: OVERVIEW_REPEATS_HEADER_REASON }];
  assert.deepEqual(flagOverviewRepeatsHeader(hdr({ overview: "Data Engineer with 6+ years of experience." }), existing), existing, "no duplicate flag");
});

const entry = (over: Record<string, unknown> = {}) => ({ title: "Atlas Release Hub", client: "Atlas Retail", description: "Pipeline platform that replaces twelve team setups.", responsibilities: [] as string[], ...over });
const bulletFlags = (template: "internal" | "external", e: Record<string, unknown>) => flagRepeatedBullets(template, { projects: [e] }, []);

test("bullets: two near-duplicate bullets in one entry flag the later one", () => {
  const r = bulletFlags("internal", entry({ responsibilities: ["Moved all Maven and npm artifacts into Artifactory.", "Wrote the cut-over runbook.", "Moved Maven and npm artifacts into a single Artifactory instance."] }));
  assert.deepEqual(r, [{ path: "projects.0.responsibilities.2", reason: BULLET_REPEATS_BULLET_REASON }]);
});

test("bullets: identical short bullets are flagged even though they are short", () => {
  const r = bulletFlags("internal", entry({ responsibilities: ["Wrote the runbook.", "wrote the runbook."] }));
  assert.deepEqual(r, [{ path: "projects.0.responsibilities.1", reason: BULLET_REPEATS_BULLET_REASON }]);
});

test("bullets: a bullet that copies the description is flagged", () => {
  const r = bulletFlags("internal", entry({ description: "Pipeline platform that replaces twelve team setups.", responsibilities: ["Built the shared templates.", "Pipeline platform replacing twelve team setups."] }));
  assert.deepEqual(r, [{ path: "projects.0.responsibilities.1", reason: BULLET_REPEATS_DESCRIPTION_REASON }]);
});

test("bullets: external employer highlights are checked too", () => {
  const r = flagRepeatedBullets("external", { experience: [{ company: "Fenwick Systems", highlights: ["Automated environment provisioning with Ansible across three regions.", "Automated environment provisioning with Ansible in three regions."] }] }, []);
  assert.deepEqual(r, [{ path: "experience.0.highlights.1", reason: BULLET_REPEATS_BULLET_REASON }]);
});

test("bullets: bullets that merely share a verb or some words are NOT flagged", () => {
  assert.deepEqual(bulletFlags("internal", entry({ responsibilities: ["Designed shared pipeline templates in Jenkins and Terraform.", "Designed shared pipeline templates for all teams."] })), [], "overlap 0.67 < 0.8");
  assert.deepEqual(bulletFlags("internal", entry({ responsibilities: ["Migrated forty services onto the platform.", "Migrated the reporting database to a managed cluster."] })), []);
  assert.deepEqual(bulletFlags("internal", entry({ responsibilities: ["Trained leads.", "Trained testers."] })), [], "very short, different bullets");
});

test("bullets: the same bullet in two DIFFERENT entries is not flagged, and a bullet mentioning the project name is fine", () => {
  const same = "Wrote the cut-over runbook for the release.";
  const r = flagRepeatedBullets("internal", { projects: [entry({ responsibilities: [same] }), entry({ title: "Beacon", description: "Monitoring suite.", responsibilities: [same] })] }, []);
  assert.deepEqual(r, []);
  assert.deepEqual(bulletFlags("internal", entry({ responsibilities: ["Presented the Atlas Release Hub roadmap to leadership."] })), []);
});

test("bullets: no bullets, no description and non-array bullets are harmless", () => {
  assert.deepEqual(bulletFlags("internal", entry({ responsibilities: [] })), []);
  assert.deepEqual(flagRepeatedBullets("internal", { projects: [{ title: "A", responsibilities: "not a list" }] }, []), []);
  assert.deepEqual(flagRepeatedBullets("internal", {}, []), []);
});

const descFlags = (template: "internal" | "external", e: Record<string, unknown>) => flagDescriptionStartsWithTitle(template, { projects: [e] }, []);

test("description starting with the project title is flagged (internal title, external client, punctuation and case ignored)", () => {
  assert.deepEqual(descFlags("internal", entry({ title: "Store Locator", description: "Store Locator is a web app that lets shoppers find nearby stores." })), [{ path: "projects.0.description", reason: DESCRIPTION_STARTS_WITH_TITLE_REASON }]);
  assert.equal(descFlags("internal", entry({ title: "Store-Locator", description: "STORE LOCATOR: a web app for shoppers." })).length, 1);
  assert.equal(descFlags("external", entry({ client: "Harbor Retail", description: "Harbor Retail needed a new returns workflow for its stores." })).length, 1);
});

test("description NOT flagged when it only mentions the title later, or starts differently", () => {
  assert.deepEqual(descFlags("internal", entry({ title: "Store Locator", description: "Web app that lets shoppers find nearby stores." })), []);
  assert.deepEqual(descFlags("internal", entry({ title: "Store Locator", description: "Replaced the old Store Locator with a map-based search." })), []);
  assert.deepEqual(descFlags("internal", entry({ title: "", description: "Anything." })), [], "no title");
  assert.deepEqual(descFlags("internal", entry({ title: "Store Locator", description: "" })), [], "no description");
  assert.deepEqual(descFlags("internal", entry({ title: "Store Locator Platform Rewrite", description: "Store Locator." })), [], "description shorter than the title");
});

test("applyBackstops runs the new checks, adds only flags, and never rewrites the data", () => {
  const data = {
    ...hdr({ overview: "Data Engineer with 6+ years of experience building pipelines for retail analytics." }),
    projects: [{ title: "Store Locator", role: "Developer", description: "Store Locator is a web app for shoppers.", responsibilities: ["Moved all Maven and npm artifacts into Artifactory.", "Moved Maven and npm artifacts into a single Artifactory instance."] }],
  };
  const before = structuredClone(data);
  const r = applyBackstops("internal", data, [], "source text");
  assert.deepEqual(r.data, before, "text untouched");
  const reasons = r.flags.map((f) => `${f.path}: ${f.reason}`);
  assert.ok(reasons.includes(`overview: ${OVERVIEW_REPEATS_HEADER_REASON}`));
  assert.ok(reasons.includes(`projects.0.description: ${DESCRIPTION_STARTS_WITH_TITLE_REASON}`));
  assert.ok(reasons.includes(`projects.0.responsibilities.1: ${BULLET_REPEATS_BULLET_REASON}`));
});

test("applyBackstops adds no repetition flags to a clean profile", () => {
  const clean = {
    ...hdr({ overview: "Builds batch and streaming pipelines for retail analytics. Works with order and inventory data." }),
    projects: [{ title: "Store Locator", role: "Developer", description: "Web app that lets shoppers find nearby stores.", responsibilities: ["Built the map search screens.", "Added stock checks per store.", "Wrote the release notes."] }],
  };
  const r = applyBackstops("internal", clean, [], "source text");
  assert.ok(!r.flags.some((f) => [OVERVIEW_REPEATS_HEADER_REASON, DESCRIPTION_STARTS_WITH_TITLE_REASON, BULLET_REPEATS_BULLET_REASON, BULLET_REPEATS_DESCRIPTION_REASON].includes(f.reason)));
});

test("backstop 3i: project and employer durations become MMM YYYY ranges; unreadable ones stay and are flagged", () => {
  const data = {
    projects: [{ duration: "June-2020 - 2021-01" }, { duration: "06/2019 to Present" }, { duration: "2018 - 2019" }, { duration: "" }],
    experience: [{ duration: "Jan'19 - till date" }, { duration: "Q3 2016" }],
  };
  const flags = normalizeDurations(data, []);
  assert.deepEqual(data.projects.map((p) => p.duration), ["Jun 2020 – Jan 2021", "Jun 2019 – Present", "2018 - 2019", ""]);
  assert.deepEqual(data.experience.map((e) => e.duration), ["Jan 2019 – Present", "Q3 2016"]);
  assert.deepEqual(flags, [
    { path: "projects.2.duration", reason: DATE_NOT_RECOGNISED_REASON },
    { path: "experience.1.duration", reason: DATE_NOT_RECOGNISED_REASON },
  ]);
  assert.deepEqual(normalizeDurations(data, flags), flags, "no duplicate flags");
});

test("applyBackstops normalises durations after the source check (a reformatted date is not 'not found')", () => {
  const source = "Project 1 - June-2020 - 06/2021\nStore Locator\nProject 2 - Jan'19 - Mar'20\nOrder Tracker";
  const data = { projects: [{ title: "Store Locator", duration: "June-2020 - 06/2021" }, { title: "Order Tracker", duration: "Jan 2019 - Mar 2020" }] };
  const r = applyBackstops("internal", data, [], source);
  assert.deepEqual((r.data as typeof data).projects.map((p) => p.duration), ["Jun 2020 – Jun 2021", "Jan 2019 – Mar 2020"]);
  assert.ok(!r.flags.some((f) => f.reason === VALUE_NOT_FOUND_REASON || f.reason === DATE_NOT_RECOGNISED_REASON), JSON.stringify(r.flags));
});

const words = (n: number) => Array.from({ length: n }, (_, k) => `word${k}`).join(" ");

test("backstop 3j: a description under 2 lines (fewer than 25 words) is flagged, never lengthened", () => {
  const data = { projects: [{ title: "Store Locator", description: words(DESCRIPTION_MIN_WORDS - 1) }, { title: "Order Tracker", description: words(DESCRIPTION_MIN_WORDS) }] };
  const before = structuredClone(data);
  const flags = flagShortDescriptions("internal", data, []);
  assert.deepEqual(flags, [{ path: "projects.0.description", reason: SHORT_DESCRIPTION_REASON }]);
  assert.deepEqual(data, before, "the description is not changed");
  assert.deepEqual(flagShortDescriptions("internal", data, flags), flags, "no duplicate flag");
});

test("backstop 3j: a named project without a description is flagged; external projects use the client field", () => {
  const data = { projects: [{ client: "Claims Portal", description: "" }, { client: "", description: "" }] };
  assert.deepEqual(flagShortDescriptions("external", data, []), [{ path: "projects.0.description", reason: NO_DESCRIPTION_REASON }]);
});

test("backstop 3j: one flag per description (3c's 'missing' flag or the model's own 'under 2 lines' flag is enough)", () => {
  const data = { projects: [{ title: "Store Locator", description: "" }, { title: "Order Tracker", description: "Tracks orders." }] };
  const existing = [
    { path: "projects.0.description", reason: MISSING_DESCRIPTION_REASON },
    { path: "projects.1.description", reason: "description under 2 lines: the resume has no more detail" },
  ];
  assert.deepEqual(flagShortDescriptions("internal", data, existing), existing);
});
