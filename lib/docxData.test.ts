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
