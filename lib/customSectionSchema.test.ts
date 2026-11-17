/**
 * Purpose: unit tests for the external profile's new data: the custom-section rules (title, "label: value" fields, description),
 * the Achievements list, that older data without the keys stays valid, that the keys survive draft restore and normalisation,
 * that the model is never asked for custom sections, and the labels used in error messages. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractionSchemaFor } from "./extract.types";
import { normalizeToShape } from "./normalize";
import { lenientSchemaFor } from "./profilePayload";
import { CUSTOM_LABEL_MAX, CUSTOM_TITLE_MAX, CUSTOM_VALUE_MAX, blankResume, describeFieldPath, externalResumeSchema, findNAIssues, type ExternalResume } from "./schemas";
import { toStrictJsonSchema } from "./strictSchema";

const MIN: ExternalResume = {
  name: "Sample Person", jobTitle: "Data Engineer", experienceSummary: "8+ Years of Industry Experience", specialization: "", overview: "An overview.",
  education: [{ year: "2016", qualification: "M.Sc." }], skills: ["Python"], tools: [], certifications: [], projects: [], experience: [],
  achievements: [], customSections: [],
};
const issues = (data: unknown): string[] => {
  const r = externalResumeSchema.safeParse(data);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};
const withSection = (s: Record<string, unknown>) => ({ ...MIN, customSections: [{ title: "", fields: [], description: "", ...s }] });

test("a complete section is valid, in all three shapes", () => {
  assert.deepEqual(issues(withSection({ title: "Languages", fields: [{ label: "Native", value: "Hindi" }], description: "Text." })), []);
  assert.deepEqual(issues(withSection({ title: "Languages", fields: [{ label: "Native", value: "Hindi" }] })), [], "fields only");
  assert.deepEqual(issues(withSection({ title: "Volunteering", description: "Mentors students." })), [], "description only");
});

test("no custom sections at all is valid, and so is an untouched empty one", () => {
  assert.deepEqual(issues(MIN), []);
  assert.deepEqual(issues(withSection({})), [], "an empty section is simply ignored");
});

test("anything filled needs a title", () => {
  assert.deepEqual(issues(withSection({ description: "Text." })), ["customSections.0.title: title is required"]);
  assert.deepEqual(issues(withSection({ fields: [{ label: "A", value: "B" }] })), ["customSections.0.title: title is required"]);
  assert.deepEqual(issues(withSection({ title: "---", description: "Text." })), ["customSections.0.title: Enter a valid section title"]);
});

test("a titled section needs a field or a description", () => {
  assert.deepEqual(issues(withSection({ title: "Empty one" })), ["customSections.0.description: Add a field or a description"]);
  assert.deepEqual(issues(withSection({ title: "Empty one", fields: [{ label: "", value: "" }] })), ["customSections.0.description: Add a field or a description"]);
});

test("a field needs BOTH a label and a value (a bare value would look vague)", () => {
  assert.deepEqual(issues(withSection({ title: "T", description: "D", fields: [{ label: "Only label", value: "" }] })), ["customSections.0.fields.0.value: Enter both a label and a value"]);
  assert.deepEqual(issues(withSection({ title: "T", description: "D", fields: [{ label: "", value: "Only value" }] })), ["customSections.0.fields.0.label: Enter both a label and a value"]);
  assert.deepEqual(issues(withSection({ title: "T", description: "D", fields: [{ label: "", value: "" }, { label: "A", value: "B" }] })), [], "a blank row is ignored");
});

test("the limits that keep headings and labels on one line", () => {
  assert.deepEqual(issues(withSection({ title: "x".repeat(CUSTOM_TITLE_MAX), description: "D" })), []);
  assert.equal(issues(withSection({ title: "x".repeat(CUSTOM_TITLE_MAX + 1), description: "D" })).length, 1);
  assert.equal(issues(withSection({ title: "T", fields: [{ label: "x".repeat(CUSTOM_LABEL_MAX + 1), value: "v" }] })).length, 1);
  assert.equal(issues(withSection({ title: "T", fields: [{ label: "l", value: "x".repeat(CUSTOM_VALUE_MAX + 1) }] })).length, 1);
});

test("data from before these sections existed still validates, and gets empty lists", () => {
  const { achievements: _a, customSections: _c, ...old } = MIN;
  void _a;
  void _c;
  const r = externalResumeSchema.safeParse(old);
  assert.ok(r.success);
  if (r.success) assert.deepEqual([r.data.achievements, r.data.customSections], [[], []]);
});

test("N/A left in Achievements or a custom section is not an error (the document leaves it out)", () => {
  assert.deepEqual(findNAIssues("external", { ...MIN, achievements: ["N/A"], customSections: [{ title: "T", fields: [{ label: "A", value: "n/a" }], description: "N/A" }] }), []);
});

test("blankResume: the external form starts with one blank Achievements row and no custom sections", () => {
  const b = blankResume("external") as ExternalResume;
  assert.deepEqual([b.achievements, b.customSections], [[""], []]);
  assert.equal("achievements" in (blankResume("internal") as object), false);
});

test("error labels name the new sections", () => {
  assert.equal(describeFieldPath(["customSections", 1, "fields", 0, "value"]), "Custom section 2 → Field 1 → Value");
  assert.equal(describeFieldPath(["customSections", 0, "title"]), "Custom section 1 → Title");
  assert.equal(describeFieldPath(["achievements", 2]), "Achievement 3");
});

test("the model is asked for Achievements but never for custom sections", () => {
  const props = Object.keys((toStrictJsonSchema(extractionSchemaFor("external")) as { properties: Record<string, unknown> }).properties);
  assert.ok(props.includes("achievements"));
  assert.ok(!props.includes("customSections"));
  const internalProps = Object.keys((toStrictJsonSchema(extractionSchemaFor("internal")) as { properties: Record<string, unknown> }).properties);
  assert.ok(!internalProps.includes("achievements") && !internalProps.includes("customSections"));
});

test("normalisation: Achievements follow the blank's shape; well-formed custom sections survive, junk is dropped, the model's are not needed", () => {
  const kept = normalizeToShape("external", {
    achievements: ["A", 5, null],
    customSections: [{ title: " T ", fields: [{ label: "L", value: 3 }, "junk"], description: "D" }, "junk", 7],
  }) as ExternalResume;
  assert.deepEqual(kept.achievements, ["A", "5", ""]);
  assert.deepEqual(kept.customSections, [{ title: "T", fields: [{ label: "L", value: "3" }], description: "D" }]);
  const none = normalizeToShape("external", { name: "A" }) as ExternalResume;
  assert.deepEqual([none.achievements, none.customSections], [[""], []]);
});

test("a saved draft restores the new sections, and an older draft without them still restores", () => {
  const lenient = lenientSchemaFor("external");
  const sections = [{ title: "T", fields: [{ label: "A", value: "B" }], description: "D" }];
  const r = lenient.safeParse({ ...MIN, achievements: ["A"], customSections: sections });
  assert.ok(r.success);
  if (r.success) assert.deepEqual([(r.data as ExternalResume).achievements, (r.data as ExternalResume).customSections], [["A"], sections]);
  const { achievements: _a, customSections: _c, ...old } = MIN;
  void _a;
  void _c;
  const o = lenient.safeParse(old);
  assert.ok(o.success);
  if (o.success) assert.deepEqual([(o.data as ExternalResume).achievements, (o.data as ExternalResume).customSections], [[], []]);
  // a draft with an over-long title still restores (the form then shows the error on that field instead of losing the draft)
  assert.ok(lenient.safeParse({ ...MIN, customSections: [{ title: "x".repeat(150), fields: [], description: "" }] }).success);
});
