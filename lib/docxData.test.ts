/** Purpose: unit tests for prepareData: the hasX flags, the cleaning of blank / "N/A" items, and dropped empty entries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareData } from "./docxData";
import type { ExternalResume, InternalResume } from "./schemas";

const FULL_INTERNAL: InternalResume = {
  name: "A", jobTitle: "B", experienceSummary: "8+ years", specialization: "Cloud", overview: "O",
  education: [{ year: "2014", qualification: "B.E." }],
  projects: [{ duration: "2020", title: "P1", toolsAndTechnologies: ["Go", "", "N/A", "Rust"], teamSize: "4", role: "Lead", projectLink: "NDA", description: "D", responsibilities: ["r1", " ", "r2"] }],
  skills: [{ name: "Go", rating: "4" }, { name: "", rating: "" }],
  certifications: ["C1", "", "N/A"], tools: ["T1", "T2"], managerialExperience: ["M1"], domains: ["D1"], languages: ["L1"],
};
const EMPTY_INTERNAL: InternalResume = {
  ...FULL_INTERNAL, experienceSummary: "", specialization: "N/A", projects: [], certifications: [""], tools: ["N/A"],
  managerialExperience: [" "], domains: [], languages: ["n/a"],
};
const FULL_EXTERNAL: ExternalResume = {
  name: "A", jobTitle: "B", experienceSummary: "8+ years", specialization: "Cloud", overview: "O",
  education: [{ year: "2014", qualification: "M.Sc." }], skills: ["S1", "", "S2"], tools: ["T1", "T2"], certifications: ["C1", "C2"],
  projects: [{ duration: "2020", client: "Acme", teamSize: "4", role: "Lead", description: "D", responsibilities: ["r1", ""] }],
  experience: [{ company: "Co", position: "Eng", duration: "2015", highlights: ["h1", "N/A"] }],
  achievements: [], customSections: [],
};
const EMPTY_EXTERNAL: ExternalResume = { ...FULL_EXTERNAL, experienceSummary: "N/A", specialization: "", tools: [], certifications: [""], projects: [], experience: [] };

test("internal: every flag is true when there is real content", () => {
  const d = prepareData("internal", FULL_INTERNAL);
  for (const flag of ["hasExperienceSummary", "hasSpecialization", "hasProjects", "hasCertifications", "hasTools", "hasManagerialExperience", "hasDomains", "hasLanguages"]) {
    assert.equal(d[flag], true, flag);
  }
});

test("internal: every flag is false when the section is empty, blank or N/A, and the value is emptied", () => {
  const d = prepareData("internal", EMPTY_INTERNAL);
  for (const flag of ["hasExperienceSummary", "hasSpecialization", "hasProjects", "hasCertifications", "hasTools", "hasManagerialExperience", "hasDomains", "hasLanguages"]) {
    assert.equal(d[flag], false, flag);
  }
  assert.equal(d.specialization, "");
  assert.deepEqual(d.certifications, []);
  assert.equal(d.tools, "");
});

test("internal: blank / N/A list items are dropped, lists are cleaned and joined", () => {
  const d = prepareData("internal", FULL_INTERNAL) as { certifications: string[]; tools: string; skills: unknown[]; projects: Record<string, unknown>[] };
  assert.deepEqual(d.certifications, ["C1"]);
  assert.equal(d.tools, "T1, T2");
  assert.deepEqual(d.skills, [{ name: "Go", rating: "4" }], "a skill without a name is dropped");
  assert.equal(d.projects[0].toolsAndTechnologies, "Go, Rust");
  assert.deepEqual(d.projects[0].responsibilities, ["r1", "r2"]);
});

test("internal: per-project flags follow each field", () => {
  const mk = (over: Partial<InternalResume["projects"][number]>) => (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], ...over }] }) as { projects: Record<string, unknown>[] }).projects[0];
  const full = mk({});
  assert.deepEqual([full.hasDuration, full.hasTech, full.hasTeamSize, full.hasRole, full.hasProjectLink, full.hasDescription, full.hasResponsibilities], [true, true, true, true, true, true, true]);
  assert.equal(mk({ duration: "N/A" }).hasDuration, false);
  assert.equal(mk({ toolsAndTechnologies: [""] }).hasTech, false);
  assert.equal(mk({ teamSize: "n/a" }).hasTeamSize, false);
  assert.equal(mk({ role: " " }).hasRole, false);
  assert.equal(mk({ projectLink: "" }).hasProjectLink, false);
  assert.equal(mk({ description: "N/A" }).hasDescription, false);
  assert.equal(mk({ responsibilities: ["", "N/A"] }).hasResponsibilities, false, "no bullets: no blank line before them either");
  assert.equal(mk({ role: "N/A" }).role, "", "an N/A value is emptied, never printed");
});

test("external: only a project with another one after it gets the gap after it (hasNext)", () => {
  const p = { ...FULL_EXTERNAL.projects[0] };
  const projects = (list: ExternalResume["projects"]) => (prepareData("external", { ...FULL_EXTERNAL, projects: list }) as { projects: { hasNext: boolean }[] }).projects;
  assert.deepEqual(projects([p]).map((x) => x.hasNext), [false]);
  assert.deepEqual(projects([p, p]).map((x) => x.hasNext), [true, false]);
});

test("internal: only a project with another one after it gets the blank line after it (hasNext)", () => {
  const empty = { ...FULL_INTERNAL.projects[0], duration: "", title: "", toolsAndTechnologies: [], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [] };
  const projects = (list: InternalResume["projects"]) => (prepareData("internal", { ...FULL_INTERNAL, projects: list }) as { projects: { hasNext: boolean }[] }).projects;
  const p = FULL_INTERNAL.projects[0];
  assert.deepEqual(projects([p]).map((x) => x.hasNext), [false]);
  assert.deepEqual(projects([p, p, p]).map((x) => x.hasNext), [true, true, false]);
  assert.deepEqual(projects([p, p, empty]).map((x) => x.hasNext), [true, false], "a dropped empty entry does not count as a next project");
});

test("projects: completely empty entries are dropped and the rest are numbered from 1", () => {
  const blank = { duration: "", title: "", toolsAndTechnologies: [""], teamSize: "N/A", role: "", projectLink: "", description: "", responsibilities: [""] };
  const d = prepareData("internal", { ...FULL_INTERNAL, projects: [blank, FULL_INTERNAL.projects[0], blank] }) as { projects: { number: number }[]; hasProjects: boolean };
  assert.equal(d.hasProjects, true);
  assert.deepEqual(d.projects.map((p) => p.number), [1]);
  assert.equal((prepareData("internal", { ...FULL_INTERNAL, projects: [blank] }) as { hasProjects: boolean }).hasProjects, false);
});

test("external: flags true with content, false when empty", () => {
  const full = prepareData("external", FULL_EXTERNAL);
  for (const flag of ["hasExperienceSummary", "hasSpecialization", "hasTools", "hasCertifications", "hasProjects", "hasExperience"]) assert.equal(full[flag], true, flag);
  const empty = prepareData("external", EMPTY_EXTERNAL);
  for (const flag of ["hasExperienceSummary", "hasSpecialization", "hasTools", "hasCertifications", "hasProjects", "hasExperience"]) assert.equal(empty[flag], false, flag);
  const employersOnly = prepareData("external", { ...FULL_EXTERNAL, projects: [] }) as { hasProjects: boolean; hasExperience: boolean };
  assert.deepEqual([employersOnly.hasProjects, employersOnly.hasExperience], [false, true], "employers alone: the shared Projects/Experience heading (hasProjects) is off, the Experience block is on");
  const projectsOnly = prepareData("external", { ...FULL_EXTERNAL, experience: [] }) as { hasProjects: boolean; hasExperience: boolean };
  assert.deepEqual([projectsOnly.hasProjects, projectsOnly.hasExperience], [true, false]);
});

test("external: per-entry flags and cleaned lists", () => {
  const d = prepareData("external", FULL_EXTERNAL) as { skills: string; projects: Record<string, unknown>[]; experience: Record<string, unknown>[] };
  assert.equal(d.skills, "S1, S2");
  assert.deepEqual(d.projects[0].responsibilities, ["r1"]);
  assert.deepEqual([d.projects[0].hasDuration, d.projects[0].hasTeamSize, d.projects[0].hasRole, d.projects[0].hasDescription, d.projects[0].hasResponsibilities], [true, true, true, true, true]);
  assert.deepEqual(d.experience[0].highlights, ["h1"]);
  assert.deepEqual([d.experience[0].hasPosition, d.experience[0].hasDuration, d.experience[0].hasHighlights], [true, true, true]);
  const sparse = prepareData("external", { ...FULL_EXTERNAL, projects: [{ duration: "", client: "Acme", teamSize: "", role: "", description: "N/A", responsibilities: [] }], experience: [{ company: "Co", position: "", duration: "N/A", highlights: [] }] }) as { projects: Record<string, unknown>[]; experience: Record<string, unknown>[] };
  assert.deepEqual([sparse.projects[0].hasDuration, sparse.projects[0].hasTeamSize, sparse.projects[0].hasRole, sparse.projects[0].hasDescription, sparse.projects[0].hasResponsibilities], [false, false, false, false, false]);
  assert.deepEqual([sparse.experience[0].hasPosition, sparse.experience[0].hasDuration, sparse.experience[0].hasHighlights], [false, false, false]);
});

test("internal page breaks: the first field a project has goes with its heading (firstX), the others follow (restX)", () => {
  type Flags = { projects: Record<string, unknown>[] };
  const flags = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => /^(first|rest)(Tech|TeamSize|Role|ProjectLink)$/.test(k)));
  const all = (prepareData("internal", FULL_INTERNAL) as Flags).projects[0];
  assert.deepEqual(flags(all), { firstTech: true, restTech: false, firstTeamSize: false, restTeamSize: true, firstRole: false, restRole: true, firstProjectLink: false, restProjectLink: true });
  const noTech = (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], toolsAndTechnologies: ["N/A"], teamSize: "" }] }) as Flags).projects[0];
  assert.deepEqual(flags(noTech), { firstTech: false, restTech: false, firstTeamSize: false, restTeamSize: false, firstRole: true, restRole: false, firstProjectLink: false, restProjectLink: true });
  const none = (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], toolsAndTechnologies: [], teamSize: "", role: "", projectLink: "" }] }) as Flags).projects[0];
  assert.ok(Object.values(flags(none)).every((v) => v === false));
  const two = (prepareData("internal", { ...FULL_INTERNAL, projects: [FULL_INTERNAL.projects[0], FULL_INTERNAL.projects[0]] }) as Flags).projects;
  assert.deepEqual(two.map((p) => p.isFirst), [true, false]);
});

test("internal page breaks: each sidebar list is split into its first item (with the heading) and the rest", () => {
  const d = prepareData("internal", { ...FULL_INTERNAL, certifications: ["N/A", "C1", "C2", "C3"], languages: ["L1"], domains: [] });
  // each item knows whether it is the last (the section's closing gap goes after it)
  assert.deepEqual([d.certificationsHead, d.certificationsRest], [[{ text: "C1", last: false }], [{ text: "C2", last: false }, { text: "C3", last: true }]]);
  assert.deepEqual([d.languagesHead, d.languagesRest], [[{ text: "L1", last: true }], []]);
  assert.deepEqual([d.domainsHead, d.domainsRest], [[], []]);
  assert.deepEqual(d.skillsHead, [{ name: "Go", rating: "4", last: true }]);
  assert.deepEqual(d.skillsRest, []);
});

test("page breaks: every unit ends with the gap to what is printed after it (never a gap at the top of a page)", () => {
  type P = { projects: Record<string, unknown>[] };
  const on = (p: Record<string, unknown>) => Object.keys(p).filter((k) => /Gap[A-Z]/.test(k) && p[k] === true).sort();
  // first unit (Tech) -> Team Size -> Role -> Project Link -> description -> bullets; not the last project: Next
  const [a, b] = (prepareData("internal", { ...FULL_INTERNAL, projects: [FULL_INTERNAL.projects[0], FULL_INTERNAL.projects[0]] }) as P).projects;
  assert.deepEqual(on(a), ["bulletsGapNext", "descriptionGapBullets", "firstGapLabel", "restProjectLinkGapDescription", "restRoleGapLabel", "restTeamSizeGapLabel"]);
  assert.deepEqual(on(b), ["descriptionGapBullets", "firstGapLabel", "restProjectLinkGapDescription", "restRoleGapLabel", "restTeamSizeGapLabel"], "the last project ends with no gap");
  assert.deepEqual(a.bulletUnits, [{ text: "r1", last: false }, { text: "r2", last: true }]);
  // only the name: the first unit goes straight to the next project
  const bare = { ...FULL_INTERNAL.projects[0], toolsAndTechnologies: [], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [] };
  assert.deepEqual(on((prepareData("internal", { ...FULL_INTERNAL, projects: [bare, bare] }) as P).projects[0]), ["firstGapNext"]);
  // external: the last project ends with the gap before Experience
  const ext = (prepareData("external", { ...FULL_EXTERNAL, projects: [{ ...FULL_EXTERNAL.projects[0], responsibilities: [] }] }) as P).projects[0];
  assert.deepEqual(on(ext), ["descriptionGapEnd", "firstGapLabel", "restRoleGapDescription"]);
  // sections: a closing gap only when another section follows
  const side = prepareData("internal", { ...FULL_INTERNAL, managerialExperience: [], domains: [], languages: [] });
  assert.deepEqual([side.skillsGapAfter, side.certificationsGapAfter, side.toolsGapAfter, side.managerialGapAfter], [true, true, false, false]);
  const extSections = prepareData("external", { ...FULL_EXTERNAL, tools: [], certifications: [], projects: [], experience: [] });
  assert.deepEqual([extSections.educationGapAfter, extSections.skillsGapAfter], [true, false]);
});

test("page breaks: a description of up to 6 lines is one unit; a longer one comes in head / body / tail pieces", () => {
  type P = { projects: Record<string, unknown>[] };
  const short = (prepareData("internal", FULL_INTERNAL) as P).projects[0];
  assert.deepEqual([short.descriptionWhole, short.descriptionLong], [true, false]);
  const text = Array.from({ length: 12 }, () => "Deliveries are grouped by postcode so each van makes fewer trips.").join(" ");
  const long = (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], description: text }] }) as P).projects[0];
  assert.deepEqual([long.descriptionWhole, long.descriptionLong], [false, true]);
  assert.equal(`${long.descriptionHead} ${long.descriptionBody} ${long.descriptionTail}`, text);
  const none = (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], description: "N/A" }] }) as P).projects[0];
  assert.deepEqual([none.descriptionWhole, none.descriptionLong], [false, false]);
});

// Page breaks: a project description stays whole up to 3 lines (and goes with the project's start); a longer one is cut into
// its first 2 lines, the middle (none for 4 lines) and its last 2. A custom section's description stays whole up to 6 lines.
test("page breaks: project descriptions whole up to 3 lines, cut 2 / middle / 2 above; custom sections up to 6", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of a fictional description.`).join("\n");
  const project = (n: number) => (prepareData("internal", { ...FULL_INTERNAL, projects: [{ ...FULL_INTERNAL.projects[0], description: lines(n) }] }).projects as Record<string, unknown>[])[0];
  assert.equal(project(3).descriptionWhole, true);
  assert.equal(project(3).descriptionLong, false);
  const four = project(4);
  assert.equal(four.descriptionLong, true);
  assert.equal(four.descriptionHasBody, false, "4 lines: 2 + 2, no middle paragraph");
  assert.equal(four.descriptionHead, "Line 1 of a fictional description.\nLine 2 of a fictional description.");
  assert.equal(four.descriptionTail, "Line 3 of a fictional description.\nLine 4 of a fictional description.");
  const five = project(5);
  assert.equal(five.descriptionHasBody, true);
  assert.equal(five.descriptionBody, "Line 3 of a fictional description.");
  const external = prepareData("external", {
    ...FULL_EXTERNAL,
    projects: [{ ...FULL_EXTERNAL.projects[0], description: lines(4) }],
    customSections: [{ title: "Talks", fields: [], description: lines(4) }],
  });
  assert.equal((external.projects as Record<string, unknown>[])[0].descriptionLong, true, "external projects follow the same 3-line rule");
  assert.equal((external.customSections as Record<string, unknown>[])[0].descriptionWhole, true, "a custom section's 4 lines stay whole");
});
