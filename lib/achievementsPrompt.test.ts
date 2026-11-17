/**
 * Purpose: guards the achievements part of the extraction prompt (lib/prompts.ts): the external prompt carries the verbatim
 * rule, the schema entry and the exact block the code detector found; the internal prompt carries none of it. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResumeAnalysis } from "./extract.types";
import { buildExtractionPrompt, describePromptPlan } from "./prompts";

const analysis = (over: Record<string, unknown> = {}): ResumeAnalysis =>
  ({ documentType: "standard_resume", seniority: "mid", roleFamily: "other", projectsLayout: "separate_section", presentSections: [], hasMetrics: false, density: "normal", earliestProfessionalStart: "", notes: [], achievementsHeadings: [], ...over }) as unknown as ResumeAnalysis;

const sections = [{ heading: "Awards & Recognition", tier: 1 as const, bulleted: true, items: ["Employee of the Year 2021", "Speaker at DevCon 2020"] }];

test("the external prompt has the verbatim rule, the schema entry and the block the detector found", () => {
  const a = analysis({ achievementsHeadings: ["Awards & Recognition"], presentSections: ["achievements"] });
  const p = buildExtractionPrompt("external", a, "2026-11-17", sections);
  assert.ok(p.includes("- achievements: ONLY the items of a dedicated achievements-type section"));
  assert.ok(p.includes('"achievements": [string]'));
  assert.ok(p.includes('Section headed "Awards & Recognition" (2 items)'));
  assert.ok(p.includes('Copy EVERY item of it into "achievements"'));
  assert.ok(p.includes("Do NOT apply the bullet writing standard"));
  assert.deepEqual(describePromptPlan(a, sections).filter((n) => n === "achievements-section"), ["achievements-section"]);
});

test("the internal prompt carries none of it, even when the analysis saw an achievements section", () => {
  const p = buildExtractionPrompt("internal", analysis({ achievementsHeadings: ["Awards"], presentSections: ["achievements"] }), "2026-11-17", sections);
  assert.ok(!p.includes("achievements-type section"));
  assert.ok(!p.includes("Employee of the Year 2021"));
  assert.ok(!p.includes('"achievements": [string]'));
});

test("with only the model's own sighting the prompt says to look for it; with neither there is no module", () => {
  const seen = buildExtractionPrompt("external", analysis({ achievementsHeadings: ["Honours"] }), "2026-11-17");
  assert.ok(seen.includes('appears to have an achievements-type section headed "Honours"'));
  const none = buildExtractionPrompt("external", analysis(), "2026-11-17");
  assert.ok(!none.includes("appears to have an achievements-type section"));
  assert.ok(!none.includes("The resume has an achievements-type section."));
  assert.deepEqual(describePromptPlan(analysis()).includes("achievements-section"), false);
});

test("an analysis stored before the field existed still builds a prompt", () => {
  const old = analysis();
  delete (old as unknown as Record<string, unknown>).achievementsHeadings;
  assert.doesNotThrow(() => buildExtractionPrompt("external", old, "2026-11-17"));
});

test("a Highlights-style section tells the model to return [] when it only summarises the career", () => {
  const weak = [{ heading: "Key Highlights", tier: 2 as const, bulleted: true, items: ["Ten years in insurance technology"] }];
  const p = buildExtractionPrompt("external", analysis(), "2026-11-17", weak);
  assert.ok(p.includes("return [] for \"achievements\" and add a reviewFlag"));
});
