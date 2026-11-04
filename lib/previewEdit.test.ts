import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_ITEM_MESSAGE, cleanText, editableOnPreview, emptyItemIssues, getAt, previewFields, previewLayout, setAt } from "./previewEdit";
import type { InternalResume } from "./schemas";

// Fictional profile. The first project is empty (not printed, not counted); some list items are blank or "N/A".
const BASE: InternalResume = {
  name: "Asha Rao",
  jobTitle: "Engineer",
  experienceSummary: "6+ Years of Industry Experience",
  specialization: "",
  overview: "Builds things.",
  education: [{ year: "2016", qualification: "B.E." }],
  projects: [
    { duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""] },
    { duration: "Jan 2022 – Dec 2022", title: "Ledger", toolsAndTechnologies: ["Go", "", "Postgres"], teamSize: "4", role: "Lead", projectLink: "", description: "A ledger.", responsibilities: ["One", "N/A", "Two"] },
    { duration: "", title: "Portal", toolsAndTechnologies: [], teamSize: "", role: "Dev", projectLink: "NDA", description: "", responsibilities: [] },
  ],
  skills: [{ name: "Go", rating: "4" }, { name: "", rating: "" }, { name: "SQL", rating: "3.5" }],
  certifications: ["", "Cert A"],
  tools: ["Git", "Jira"],
  managerialExperience: [],
  domains: ["Fintech"],
  languages: ["English", "Hindi"],
};

test("layout: only what the PDF prints, numbered as printed, with paths into the same data the Edit page uses", () => {
  const layout = previewLayout(BASE);
  assert.equal(layout.projects.length, 2, "the empty project is not shown");
  const [p1, p2] = layout.projects;
  assert.deepEqual([p1.number, p1.dates?.path, p1.name?.path], [1, "projects.1.duration", "projects.1.title"]);
  assert.deepEqual(p1.tools.map((f) => [f.path, f.label]), [["projects.1.toolsAndTechnologies.0", "Project 1, tool 1"], ["projects.1.toolsAndTechnologies.2", "Project 1, tool 2"]]);
  assert.deepEqual(p1.bullets.map((f) => f.path), ["projects.1.responsibilities.0", "projects.1.responsibilities.2"], "blank and N/A items are not printed");
  assert.equal(p1.link, null, "an empty optional field is not shown (nothing is added on Preview)");
  assert.equal(p1.role?.label, "Project 1, role");
  assert.equal(p1.description?.kind, "multiline");
  assert.equal(p1.dates?.kind, "date");
  assert.deepEqual([p2.number, p2.dates, p2.link?.path, p2.link?.label], [2, null, "projects.2.projectLink", "Project 2, link"]);
  assert.deepEqual(layout.skills.map((s) => [s.name.path, s.name.label, s.rating.path, s.rating.kind]), [
    ["skills.0.name", "Skill 1, name", "skills.0.rating", "rating"],
    ["skills.2.name", "Skill 2, name", "skills.2.rating", "rating"],
  ]);
  assert.deepEqual(layout.certifications.map((f) => [f.path, f.label]), [["certifications.1", "Certification 1"]]);
  assert.deepEqual(layout.managerialExperience, []);
  assert.deepEqual(layout.education.map((e) => [e.year.label, e.qualification.path]), [["Education, year", "education.0.qualification"]]);
});

test("layout: every field in the order of the PDF, the header and labels are not fields", () => {
  const fields = previewFields(previewLayout(BASE));
  assert.deepEqual(fields.map((f) => f.path), [
    "overview", "education.0.year", "education.0.qualification",
    "projects.1.duration", "projects.1.title", "projects.1.toolsAndTechnologies.0", "projects.1.toolsAndTechnologies.2",
    "projects.1.teamSize", "projects.1.role", "projects.1.description", "projects.1.responsibilities.0", "projects.1.responsibilities.2",
    "projects.2.title", "projects.2.role", "projects.2.projectLink",
    "skills.0.name", "skills.0.rating", "skills.2.name", "skills.2.rating",
    "certifications.1", "tools.0", "tools.1", "domains.0", "languages.0", "languages.1",
  ]);
  assert.ok(!fields.some((f) => /^(name|jobTitle|experienceSummary|specialization)$/.test(f.path)));
  assert.ok(editableOnPreview(previewLayout(BASE), "projects.1.role"));
  assert.ok(!editableOnPreview(previewLayout(BASE), "name"), "the header is not editable here: a refusal about it goes back to Edit");
  assert.ok(!editableOnPreview(previewLayout(BASE), "projects.1.projectLink"), "not printed, so not shown");
});

test("getAt / setAt: one value by path, nothing else changed or copied", () => {
  assert.equal(getAt(BASE, "projects.1.responsibilities.2"), "Two");
  assert.equal(getAt(BASE, "skills.2.rating"), "3.5");
  assert.equal(getAt(BASE, "projects.9.title"), "");
  const next = setAt(BASE, "projects.1.responsibilities.2", "Two, rewritten");
  assert.equal(getAt(next, "projects.1.responsibilities.2"), "Two, rewritten");
  assert.equal(getAt(BASE, "projects.1.responsibilities.2"), "Two", "the original is not mutated");
  assert.equal(next.projects[1].responsibilities.length, 3, "no item is added or removed");
  assert.equal(next.projects[2], BASE.projects[2], "untouched branches are shared");
  assert.equal(next.skills, BASE.skills);
  assert.equal(setAt(BASE, "overview", "New.").overview, "New.");
  assert.equal(setAt(BASE, "skills.0.rating", "4.5").skills[0].rating, "4.5");
});

test("cleanText: plain text only; line breaks only where allowed", () => {
  assert.equal(cleanText("A​b‌c‍d⁠e﻿f", false), "Abcdef", "zero-width characters go");
  assert.equal(cleanText("a\u0000b\u0007c\u001Bd\u007Fe\u0085f", false), "abcdef", "control characters go");
  assert.equal(cleanText("one\ttwo", false), "one two");
  assert.equal(cleanText("line one\r\nline two\n\nline three", false), "line one line two line three", "single-line: breaks become one space");
  assert.equal(cleanText("line one  \n  line two", false), "line one line two");
  assert.equal(cleanText("para one\r\npara two\rthree", true), "para one\npara two\nthree", "multiline keeps breaks, normalised to \\n");
  assert.equal(cleanText("Plain – text, “quotes” & é", false), "Plain – text, “quotes” & é", "ordinary punctuation and accents stay");
});

test("empty-item rule: a shown list item emptied on Preview blocks; cleared optional fields and unshown blanks do not", () => {
  const layout = previewLayout(BASE);
  assert.deepEqual(emptyItemIssues(layout, BASE), [], "blank items that were never shown (dropped by the template) are fine");
  let d = setAt(BASE, "projects.1.responsibilities.2", "   ");
  d = setAt(d, "tools.1", "");
  d = setAt(d, "skills.2.name", "");
  d = setAt(d, "projects.2.projectLink", ""); // an optional single field may be cleared, as on Edit
  d = setAt(d, "projects.1.duration", "");
  assert.deepEqual(emptyItemIssues(layout, d), [
    { key: "projects.1.responsibilities.2", message: EMPTY_ITEM_MESSAGE },
    { key: "skills.2.name", message: EMPTY_ITEM_MESSAGE },
    { key: "tools.1", message: EMPTY_ITEM_MESSAGE },
  ]);
  assert.equal(EMPTY_ITEM_MESSAGE, "This item is empty: fill it in, or remove it on Edit");
});
