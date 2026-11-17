/**
 * Purpose: end-to-end check (real template, real LibreOffice) that an external profile's Achievements and custom sections appear in
 * the PDF that Preview shows and Download saves (both come from POST /api/pdf, i.e. renderProfilePdf), in the right order, and that
 * what is left empty leaves no heading behind. Needs LibreOffice like lib/pdfRender.test.ts. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractText, getDocumentProxy } from "unpdf";
import { checkReadyForDocx } from "./docxReady";
import { renderProfilePdf } from "./pdfRender";
import type { ExternalResume } from "./schemas";

const BASE: ExternalResume = {
  name: "Casey Placeholder", jobTitle: "Senior Engineer", experienceSummary: "8+ Years of Industry Experience", specialization: "Data pipelines",
  overview: "Builds pipelines for retail analytics.", education: [{ year: "2014", qualification: "M.Sc., Example University" }],
  skills: ["Python"], tools: [], certifications: [], projects: [],
  experience: [{ company: "Example Corp", position: "Engineer", duration: "2015 - 2020", highlights: ["Built things", "Ran things"] }],
  achievements: [], customSections: [],
};
const textOf = async (data: ExternalResume) => (await extractText(await getDocumentProxy((await renderProfilePdf("external", data)).slice()), { mergePages: true })).text;
const at = (text: string, s: string) => {
  const i = text.indexOf(s);
  assert.ok(i >= 0, `missing "${s}"`);
  return i;
};

test("Achievements and custom sections are in the PDF, after Experience and in this order", async () => {
  const text = await textOf({
    ...BASE,
    achievements: ["Platform Excellence Award 2022", "Speaker at Cloud Summit 2021"],
    customSections: [
      { title: "Languages spoken", fields: [{ label: "Native", value: "Hindi" }, { label: "Fluent", value: "English" }], description: "Comfortable running workshops." },
      { title: "Volunteering", fields: [], description: "Mentors students every weekend." },
    ],
  });
  const order = ["Example Corp", "Achievements", "Platform Excellence Award 2022", "Speaker at Cloud Summit 2021", "Languages spoken", "Native", "Hindi", "Fluent", "English", "Comfortable running workshops.", "Volunteering", "Mentors students every weekend."].map((s) => at(text, s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "everything appears in this order");
});

test("nothing new means no Achievements heading and no custom heading", async () => {
  const text = await textOf(BASE);
  assert.ok(!text.includes("Achievements"));
  assert.ok(text.includes("Example Corp"));
});

test("an empty or half-filled custom section prints nothing, and not even its title", async () => {
  const text = await textOf({
    ...BASE,
    achievements: ["", "N/A"],
    customSections: [
      { title: "Ghost title", fields: [{ label: "Only label", value: "" }], description: "" },
      { title: "", fields: [], description: "" },
      { title: "Real one", fields: [{ label: "Half", value: "" }, { label: "Full", value: "Yes" }], description: "" },
    ],
  });
  assert.ok(!text.includes("Achievements") && !text.includes("Ghost title") && !text.includes("Only label") && !text.includes("Half"));
  for (const s of ["Real one", "Full", "Yes"]) assert.ok(text.includes(s), s);
});

test("special characters in a title, label or value are printed as typed, not broken or interpreted", async () => {
  const text = await textOf({ ...BASE, customSections: [{ title: "R&D <awards> {x}", fields: [{ label: "A & B", value: "<b>bold</b> {#loop}" }], description: "" }] });
  for (const s of ["R&D", "<awards>", "A & B", "<b>bold</b>"]) assert.ok(text.includes(s), s);
});

test("the server's own check accepts the new sections and refuses a section with no title", () => {
  const ok = checkReadyForDocx("external", { ...BASE, achievements: ["A"], customSections: [{ title: "T", fields: [{ label: "L", value: "V" }], description: "" }] });
  assert.equal(ok.ok, true);
  const bad = checkReadyForDocx("external", { ...BASE, customSections: [{ title: "", fields: [{ label: "L", value: "V" }], description: "" }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.issues.some((i) => i.path === "customSections.0.title"));
  // data from before these sections existed (no keys at all) is still valid
  const { achievements: _a, customSections: _c, ...old } = BASE;
  void _a;
  void _c;
  assert.equal(checkReadyForDocx("external", old as ExternalResume).ok, true);
});
