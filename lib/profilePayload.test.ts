/**
 * Purpose: unit tests for the save-request rules (lib/profilePayload.ts): only INTERNAL profiles can be saved;
 * "external" is refused. (The route turns that into HTTP 400 EXTERNAL_NOT_SAVED; app/api/profiles/route.ts, checked
 * end to end in scripts/e2e-ui.mjs because the route answers 401 before it looks at the body.)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isExternalSave, parseSavePayload } from "./profilePayload";

const internalData = {
  name: "Testy McSample", jobTitle: "Engineer", experienceSummary: "", specialization: "", overview: "o",
  education: [{ year: "2014", qualification: "B.E." }], projects: [], skills: [{ name: "Java", rating: "4" }],
  certifications: [], tools: [], managerialExperience: [], domains: [], languages: [],
};
const externalData = {
  name: "Testy McSample", jobTitle: "Engineer", experienceSummary: "", specialization: "", overview: "o",
  education: [{ year: "2014", qualification: "B.E." }], projects: [], experience: [], skills: ["Java"], tools: [], certifications: [],
};
const body = (template: string, data: unknown) => ({ template, kind: "base", label: "Base", source: "scratch", data, reviewFlags: [], promptPlan: [] });

test("an internal profile parses", () => {
  const p = parseSavePayload(body("internal", internalData));
  assert.ok(p);
  assert.equal(p.template, "internal");
});

test("an external profile is refused, however complete it is", () => {
  assert.equal(parseSavePayload(body("external", externalData)), null);
  assert.equal(parseSavePayload(body("external", internalData)), null);
});

test("unknown templates and missing templates are refused too", () => {
  assert.equal(parseSavePayload(body("other", internalData)), null);
  assert.equal(parseSavePayload({ ...body("internal", internalData), template: undefined }), null);
  assert.equal(parseSavePayload(null), null);
});

test("isExternalSave recognises exactly the external case (for the specific 400 message)", () => {
  assert.equal(isExternalSave(body("external", externalData)), true);
  assert.equal(isExternalSave(body("internal", internalData)), false);
  assert.equal(isExternalSave({ template: "External" }), false);
  assert.equal(isExternalSave(null), false);
  assert.equal(isExternalSave("external"), false);
});
