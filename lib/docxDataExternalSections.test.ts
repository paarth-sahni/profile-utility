/**
 * Purpose: unit tests for the external profile's two new sections in lib/docxData.ts: Achievements (a list that goes under the
 * fixed heading "Achievements") and the user's custom sections (title, "label: value" fields, description): what is cleaned
 * away, how each section is split into page-break units, and which gap closes which unit. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareData } from "./docxData";
import type { ExternalResume } from "./schemas";

const BASE: ExternalResume = {
  name: "A", jobTitle: "B", experienceSummary: "8+ years", specialization: "Cloud", overview: "O",
  education: [{ year: "2014", qualification: "M.Sc." }], skills: ["S1"], tools: [], certifications: [],
  projects: [], experience: [{ company: "Co", position: "Eng", duration: "2015", highlights: ["h1", "h2", "h3"] }],
  achievements: [], customSections: [],
};
const ext = (over: Partial<ExternalResume>) => prepareData("external", { ...BASE, ...over }) as Record<string, unknown> & {
  experience: { headerCloseGap: boolean; highlightsHead: { text: string; closeGap: boolean }[]; highlightsRest: { text: string; closeGap: boolean }[] }[];
  customSections: Record<string, unknown>[];
};
const section = (over: Record<string, unknown> = {}) => ({ title: "Languages spoken", fields: [{ label: "Native", value: "Hindi" }, { label: "Fluent", value: "English" }], description: "Works across teams.", ...over });

test("achievements: the first item goes with the heading, the rest are units, the last ends the section", () => {
  const d = ext({ achievements: ["Award A", "", "N/A", "Award B", "Award C"] });
  assert.equal(d.hasAchievements, true);
  assert.deepEqual(d.achievementsHead, [{ text: "Award A", last: false }]);
  assert.deepEqual(d.achievementsRest, [{ text: "Award B", last: false }, { text: "Award C", last: true }]);
  const one = ext({ achievements: ["Only one"] });
  assert.deepEqual([one.achievementsHead, one.achievementsRest], [[{ text: "Only one", last: true }], []]);
});

test("achievements: blank or N/A only means the section is left out", () => {
  const d = ext({ achievements: ["", " ", "n/a"] });
  assert.equal(d.hasAchievements, false);
  assert.deepEqual([d.achievementsHead, d.achievementsRest], [[], []]);
});

test("custom sections: a field needs both label and value; a section needs a title and a field or a description", () => {
  const d = ext({
    customSections: [
      section({ fields: [{ label: "Native", value: "Hindi" }, { label: "", value: "orphan value" }, { label: "orphan label", value: "" }, { label: "", value: "" }] }),
      section({ title: "", description: "No title" }), // dropped: no title
      section({ title: "Title only", fields: [{ label: "", value: "" }], description: "" }), // dropped: nothing to print
      section({ title: "Only a description", fields: [], description: "Text." }),
    ],
  });
  assert.equal(d.hasCustomSections, true);
  assert.deepEqual(d.customSections.map((s) => s.title), ["Languages spoken", "Only a description"]);
  const first = d.customSections[0] as { firstField: { label: string; value: string }[]; restFields: unknown[] };
  assert.deepEqual(first.firstField.map((f) => [f.label, f.value]), [["Native", "Hindi"]]);
  assert.deepEqual(first.restFields, [], "the half-filled rows are not printed");
});

test("custom sections: nothing usable means no sections at all", () => {
  const d = ext({ customSections: [section({ title: "", fields: [], description: "" })] });
  assert.equal(d.hasCustomSections, false);
  assert.deepEqual(d.customSections, []);
});

test("custom sections: the title goes with the first field, or with the description when there are no fields", () => {
  const withFields = ext({ customSections: [section()] }).customSections[0] as Record<string, unknown>;
  assert.deepEqual([withFields.hasFields, withFields.noFields, withFields.hasDescription], [true, false, true]);
  assert.equal((withFields.firstField as unknown[]).length, 1);
  assert.equal((withFields.restFields as unknown[]).length, 1);
  const noFields = ext({ customSections: [section({ fields: [] })] }).customSections[0] as Record<string, unknown>;
  assert.deepEqual([noFields.hasFields, noFields.noFields, noFields.descriptionWhole], [false, true, true]);
  assert.deepEqual([noFields.firstField, noFields.restFields], [[], []]);
});

test("custom sections: a long description comes in head / body / tail pieces, a short one whole", () => {
  const long = Array.from({ length: 14 }, () => "Deliveries are grouped by postcode so each van makes fewer trips.").join(" ");
  const s = ext({ customSections: [section({ description: long })] }).customSections[0] as Record<string, unknown>;
  assert.deepEqual([s.descriptionWhole, s.descriptionLong], [false, true]);
  assert.equal(`${s.descriptionHead} ${s.descriptionBody} ${s.descriptionTail}`, long);
  const short = ext({ customSections: [section()] }).customSections[0] as Record<string, unknown>;
  assert.deepEqual([short.descriptionWhole, short.descriptionLong], [true, false]);
});

test("custom sections: each field knows which gap follows it, and the last section ends with none", () => {
  const d = ext({ customSections: [section(), section({ title: "Second", description: "" }), section({ title: "Third", fields: [], description: "Last." })] });
  type F = { gapLabel: boolean; gapDescription: boolean; gapSection: boolean };
  const gaps = (f: F) => [f.gapLabel, f.gapDescription, f.gapSection];
  const [a, b, c] = d.customSections as unknown as { firstField: F[]; restFields: F[]; sectionGap: boolean }[];
  assert.deepEqual(gaps(a.firstField[0]), [true, false, false], "another field follows");
  assert.deepEqual(gaps(a.restFields[0]), [false, true, false], "the description follows");
  assert.equal(a.sectionGap, true, "the description ends the section and another section follows");
  assert.deepEqual(gaps(b.restFields[0]), [false, false, true], "no description: the last field ends the section, another follows");
  assert.equal(c.sectionGap, false, "the very last section ends with no gap (no blank page)");
});

test("page breaks: the last employer's last unit closes with the gap when Achievements or custom sections follow", () => {
  const none = ext({});
  assert.equal(none.experience[0].highlightsRest.some((h) => h.closeGap) || none.experience[0].highlightsHead.some((h) => h.closeGap) || none.experience[0].headerCloseGap, false);
  const withAch = ext({ achievements: ["A"] });
  assert.deepEqual(withAch.experience[0].highlightsRest.map((h) => h.closeGap), [false, true], "the last highlight carries the gap");
  assert.equal(withAch.experience[0].highlightsHead[0].closeGap, false);
  const withCustom = ext({ customSections: [section()] });
  assert.equal(withCustom.experience[0].highlightsRest[1].closeGap, true);
  const oneHighlight = ext({ achievements: ["A"], experience: [{ company: "Co", position: "", duration: "", highlights: ["only"] }] });
  assert.deepEqual([oneHighlight.experience[0].highlightsHead[0].closeGap, oneHighlight.experience[0].highlightsRest], [true, []]);
  const noHighlights = ext({ achievements: ["A"], experience: [{ company: "Co", position: "Eng", duration: "", highlights: [] }] });
  assert.equal(noHighlights.experience[0].headerCloseGap, true, "no highlights: the employer's first unit carries it");
  const twoEmployers = ext({ achievements: ["A"], experience: [{ company: "One", position: "", duration: "", highlights: ["x"] }, { company: "Two", position: "", duration: "", highlights: ["y"] }] });
  assert.deepEqual(twoEmployers.experience.map((e) => e.highlightsHead[0].closeGap), [false, true], "only the last employer");
});

test("page breaks: every section ends with a gap exactly when a later section is printed", () => {
  // "gap after X" asks "is anything printed after X?" and is only read inside X's own block, so it does not depend on X being printed
  const onlyAch = ext({ experience: [], achievements: ["A"] });
  assert.deepEqual([onlyAch.skillsGapAfter, onlyAch.certificationsGapAfter, onlyAch.projectsGapAfter, onlyAch.experienceGapAfter, onlyAch.achievementsGapAfter], [true, true, true, true, false]);
  const achThenCustom = ext({ achievements: ["A"], customSections: [section()] });
  assert.deepEqual([achThenCustom.experienceGapAfter, achThenCustom.achievementsGapAfter, achThenCustom.customGapAfter], [true, true, false]);
  const nothingAfter = ext({});
  assert.deepEqual([nothingAfter.experienceGapAfter, nothingAfter.skillsGapAfter], [false, true], "Skills is followed by Experience");
  const projectsOnly = ext({ experience: [], projects: [{ duration: "", client: "Acme", teamSize: "", role: "", description: "D", responsibilities: [] }], customSections: [section()] });
  assert.equal(projectsOnly.projectsGapAfter, true, "projects, then a custom section with no Experience between them");
});

test("the internal template is untouched by any of this", () => {
  const d = prepareData("internal", {
    name: "A", jobTitle: "B", experienceSummary: "", specialization: "", overview: "O", education: [{ year: "2014", qualification: "x" }],
    projects: [], skills: [{ name: "Go", rating: "4" }], certifications: [], tools: [], managerialExperience: [], domains: [], languages: [],
  });
  assert.equal("hasAchievements" in d, false);
  assert.equal("customSections" in d, false);
});
