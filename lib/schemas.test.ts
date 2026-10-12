/**
 * Purpose: unit tests for what is REQUIRED and what is OPTIONAL in a profile (lib/schemas.ts). Required: name, job
 * title, overview, one education entry, at least one skill. Everything else may be empty, and blank / "N/A" items
 * inside optional lists do not count.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { blankResume, findNAIssues, schemaFor, type ExternalResume, type InternalResume } from "./schemas";

const MIN_INTERNAL: InternalResume = {
  name: "Testy McSample",
  jobTitle: "Engineer",
  experienceSummary: "",
  specialization: "",
  overview: "An overview.",
  education: [{ year: "2014", qualification: "B.E." }],
  projects: [],
  skills: [{ name: "Java", rating: "4" }],
  certifications: [],
  tools: [],
  managerialExperience: [],
  domains: [],
  languages: [],
};

const MIN_EXTERNAL: ExternalResume = {
  name: "Sample Person",
  jobTitle: "Data Engineer",
  experienceSummary: "",
  specialization: "",
  overview: "An overview.",
  education: [{ year: "2016", qualification: "M.Sc." }],
  skills: ["Python"],
  tools: [],
  certifications: [],
  projects: [],
  experience: [],
};

const clone = <T,>(v: T): T => structuredClone(v);
const paths = (id: "internal" | "external", data: unknown): string[] => {
  const r = schemaFor(id).safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

test("a profile with only the required fields is valid (internal and external)", () => {
  assert.equal(schemaFor("internal").safeParse(MIN_INTERNAL).success, true);
  assert.equal(schemaFor("external").safeParse(MIN_EXTERNAL).success, true);
});

test("each required field is still required", () => {
  for (const [id, base] of [["internal", MIN_INTERNAL], ["external", MIN_EXTERNAL]] as const) {
    for (const key of ["name", "jobTitle", "overview"] as const) {
      assert.deepEqual(paths(id, { ...clone(base), [key]: "  " }), [key], `${id}.${key}`);
    }
    assert.ok(paths(id, { ...clone(base), education: [] }).includes("education"), `${id}: education missing`);
    assert.ok(paths(id, { ...clone(base), education: [{ year: "", qualification: "B.E." }] }).includes("education.0.year"));
    assert.ok(paths(id, { ...clone(base), education: [{ year: "2014", qualification: "" }] }).includes("education.0.qualification"));
    assert.ok(paths(id, { ...clone(base), education: [base.education[0], base.education[0]] }).includes("education"), `${id}: two education entries`);
    assert.ok(paths(id, { ...clone(base), skills: [] }).includes("skills"), `${id}: at least one skill`);
  }
  assert.ok(paths("internal", { ...clone(MIN_INTERNAL), skills: [{ name: "Java", rating: "" }] }).includes("skills.0.rating"));
  assert.ok(paths("external", { ...clone(MIN_EXTERNAL), skills: [""] }).includes("skills.0"));
});

test("optional lists and header lines may be empty, blank or N/A", () => {
  const internal = {
    ...clone(MIN_INTERNAL),
    experienceSummary: "N/A",
    specialization: "N/A",
    certifications: [""],
    tools: ["", "N/A"],
    managerialExperience: [" "],
    domains: ["n/a"],
    languages: [""],
  };
  assert.equal(schemaFor("internal").safeParse(internal).success, true);
  assert.equal(schemaFor("external").safeParse({ ...clone(MIN_EXTERNAL), tools: [""], certifications: ["NA"], experienceSummary: "N/A" }).success, true);
});

test("specialization is still capped at 5 words when it is filled in", () => {
  assert.ok(paths("internal", { ...clone(MIN_INTERNAL), specialization: "one two three four five six" }).includes("specialization"));
  assert.equal(schemaFor("internal").safeParse({ ...clone(MIN_INTERNAL), specialization: "one two three four five" }).success, true);
});

test("a completely empty project / experience entry is ignored, not an error", () => {
  const emptyProject = { duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""] };
  assert.equal(schemaFor("internal").safeParse({ ...clone(MIN_INTERNAL), projects: [emptyProject] }).success, true);
  assert.equal(schemaFor("internal").safeParse({ ...clone(MIN_INTERNAL), projects: [{ ...emptyProject, role: "N/A", teamSize: "N/A" }] }).success, true, "N/A does not count as content");
  const emptyExternalProject = { duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""] };
  assert.equal(schemaFor("external").safeParse({ ...clone(MIN_EXTERNAL), projects: [emptyExternalProject], experience: [{ company: "", position: "", duration: "", highlights: [""] }] }).success, true);
});

test("a project that has any real content must be named; its other fields stay optional", () => {
  const onlyRole = { duration: "", title: "", toolsAndTechnologies: [], teamSize: "", role: "Lead", projectLink: "", description: "", responsibilities: [] };
  assert.deepEqual(paths("internal", { ...clone(MIN_INTERNAL), projects: [onlyRole] }), ["projects.0.title"]);
  const onlyTitle = { ...onlyRole, role: "", title: "Billing" };
  assert.equal(schemaFor("internal").safeParse({ ...clone(MIN_INTERNAL), projects: [onlyTitle] }).success, true);
  const extNoClient = { duration: "2020", client: "", teamSize: "", role: "", description: "", responsibilities: [] };
  assert.deepEqual(paths("external", { ...clone(MIN_EXTERNAL), projects: [extNoClient] }), ["projects.0.client"]);
  assert.equal(schemaFor("external").safeParse({ ...clone(MIN_EXTERNAL), projects: [{ ...extNoClient, client: "Acme" }] }).success, true);
});

test("an experience entry that has any real content must name the company", () => {
  assert.deepEqual(paths("external", { ...clone(MIN_EXTERNAL), experience: [{ company: "", position: "Engineer", duration: "", highlights: [] }] }), ["experience.0.company"]);
  assert.equal(schemaFor("external").safeParse({ ...clone(MIN_EXTERNAL), experience: [{ company: "Acme", position: "", duration: "", highlights: [] }] }).success, true);
});

test("findNAIssues: N/A in required fields is flagged, in optional places it is not", () => {
  const flagged = (id: "internal" | "external", data: InternalResume | ExternalResume) => findNAIssues(id, data).map((i) => i.path);
  assert.deepEqual(flagged("internal", { ...clone(MIN_INTERNAL), name: "N/A" }), ["Name"]);
  assert.deepEqual(flagged("internal", { ...clone(MIN_INTERNAL), overview: "n/a" }), ["Overview"]);
  assert.equal(flagged("internal", { ...clone(MIN_INTERNAL), education: [{ year: "N/A", qualification: "B.E." }] }).length, 1);
  assert.equal(flagged("internal", { ...clone(MIN_INTERNAL), skills: [{ name: "N/A", rating: "4" }] }).length, 1);
  assert.deepEqual(flagged("internal", { ...clone(MIN_INTERNAL), experienceSummary: "N/A", specialization: "N/A", tools: ["N/A"], certifications: ["N/A"], domains: ["N/A"], languages: ["N/A"], managerialExperience: ["N/A"] }), []);
  const project = { duration: "N/A", title: "Billing", toolsAndTechnologies: ["N/A"], teamSize: "N/A", role: "N/A", projectLink: "N/A", description: "N/A", responsibilities: ["N/A"] };
  assert.deepEqual(flagged("internal", { ...clone(MIN_INTERNAL), projects: [project] }), [], "everything but the project name is optional");
  assert.equal(flagged("internal", { ...clone(MIN_INTERNAL), projects: [{ ...project, title: "N/A" }] }).length, 1, "the project name is not");
  assert.deepEqual(flagged("external", { ...clone(MIN_EXTERNAL), experience: [{ company: "Acme", position: "N/A", duration: "N/A", highlights: ["N/A"] }] }), []);
});

test("blankResume has a placeholder entry everywhere and becomes valid once only the required fields are filled", () => {
  const blank = blankResume("internal") as InternalResume;
  assert.ok(paths("internal", blank).length > 0, "a blank form is not valid yet");
  const filled: InternalResume = { ...blank, name: "A", jobTitle: "B", overview: "C", education: [{ year: "2014", qualification: "B.E." }], skills: [{ name: "Java", rating: "4" }] };
  assert.equal(schemaFor("internal").safeParse(filled).success, true, "optional placeholders (blank lists and a blank project) are fine");
  const blankExt = blankResume("external") as ExternalResume;
  const filledExt: ExternalResume = { ...blankExt, name: "A", jobTitle: "B", overview: "C", education: [{ year: "2016", qualification: "M.Sc." }], skills: ["Python"] };
  assert.equal(schemaFor("external").safeParse(filledExt).success, true);
});
