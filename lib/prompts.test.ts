/**
 * Purpose: guards the no-repetition rules in the extraction prompt (lib/prompts.ts): the conflicting old overview rule
 * stays gone, the new rules are present for both templates and seniority levels, and the few-shot examples themselves
 * follow the rules (an example that restates the header would teach the model to do it).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResumeAnalysis } from "./extract.types";
import { buildExtractionPrompt } from "./prompts";

const analysis = (seniority: ResumeAnalysis["seniority"]): ResumeAnalysis =>
  ({ documentType: "standard_resume", seniority, roleFamily: "other", projectsLayout: "separate_section", presentSections: [], hasMetrics: false, density: "normal", earliestProfessionalStart: "", notes: [] }) as unknown as ResumeAnalysis;

for (const template of ["internal", "external"] as const) {
  for (const seniority of ["fresher", "mid", "leadership"] as const) {
    test(`${template}/${seniority}: the overview must not restate the header, and the old 'start with the role' rule is gone`, () => {
      const p = buildExtractionPrompt(template, analysis(seniority), "2026-10-12");
      assert.ok(p.includes("must NOT restate any of them"), "new overview rule");
      assert.ok(p.includes("must NOT open with the job title or the years of experience"), "no opening with title / years");
      assert.ok(!/Start with the role or profile/.test(p), "the conflicting rule must be gone");
      assert.ok(!/Lead the overview with scope: years/.test(p), "the leadership module must not ask for years in the overview");
    });
  }
}

test("the no-repetition rules are all present", () => {
  const p = buildExtractionPrompt("internal", analysis("mid"), "2026-10-12");
  for (const rule of [
    "NO REPETITION",
    "does not list every skill or tool",
    "must not repeat or start with the project title",
    "Bullets must not repeat the description",
    "No two bullets in one entry may say the same thing",
    "Vary the opening verb",
    "Do not repeat a phrase within one field",
    "never add, upgrade or invent a fact just to avoid repeating something",
  ]) {
    assert.ok(p.includes(rule), `missing rule: ${rule}`);
  }
});

test("the few-shot examples follow the rules: the overview does not open with the job title or the years", () => {
  for (const template of ["internal", "external"] as const) {
    const p = buildExtractionPrompt(template, analysis("mid"), "2026-10-12");
    const m = p.match(/"jobTitle":"([^"]+)"[\s\S]*?"overview":"([^"]+)"/);
    assert.ok(m, `${template}: example not found`);
    const [, title, overview] = m;
    const first = overview.split(/(?<=[.!?])\s/)[0].toLowerCase();
    assert.ok(!first.includes(title.toLowerCase()), `${template} example opens with the job title`);
    assert.ok(!/\b\d+\s*\+?\s*years?\b/.test(first), `${template} example opens with the years of experience`);
  }
});

test("dates: every template asks for MMM YYYY, en-dash ranges and Present / Current, and its examples follow it", () => {
  for (const template of ["internal", "external"] as const) {
    const p = buildExtractionPrompt(template, analysis("mid"), "2026-10-12");
    assert.ok(p.includes('write every date as "MMM YYYY"') && p.includes('"Feb 2020 – Jun 2020"') && p.includes("Never invent a month"), template);
    for (const [, d] of p.matchAll(/"duration":\s*"([^"]+)"/g)) assert.match(d, /^[A-Z][a-z]{2} \d{4} – ([A-Z][a-z]{2} \d{4}|Present|Current)$/, `${template} example duration ${d}`);
  }
});

test("descriptions: at least 2 lines from the resume's own facts, never padded, flagged when the resume has too little", () => {
  for (const template of ["internal", "external"] as const) {
    const p = buildExtractionPrompt(template, analysis("mid"), "2026-10-12");
    assert.ok(p.includes("a description is at least 2 lines, about 25 words or more"), template);
    assert.ok(p.includes("ONLY with facts the resume states for that same project") && p.includes("Never add a fact, purpose or outcome the resume does not state"), template);
    assert.ok(p.includes("description under 2 lines: the resume has no more detail"), template);
    // the example teaches the length too
    for (const [, d] of p.matchAll(/"description":"([^"]+)"/g)) assert.ok(d.split(/\s+/).length >= 25, `${template} example description has ${d.split(/\s+/).length} words`);
  }
});

test("project names: the project's own name, never the client or a sentence; external 'client' holds the name", () => {
  for (const template of ["internal", "external"] as const) {
    const p = buildExtractionPrompt(template, analysis("mid"), "2026-10-12");
    assert.ok(p.includes("PROJECT NAME"), template);
    assert.ok(p.includes("NEVER use the client, customer or employer as the project name"), template);
    assert.ok(p.includes("NEVER use a sentence or the opening words of the description as the name"), template);
    assert.ok(p.includes('"project name not stated in the resume"'), template);
    assert.ok(!/use the client or project name as written/.test(p), `${template}: the old rule that invited the client name is gone`);
  }
  const external = buildExtractionPrompt("external", analysis("mid"), "2026-10-12");
  assert.ok(external.includes("holds the PROJECT'S NAME"));
  const exampleName = external.match(/"client":"([^"]+)"/)?.[1] ?? "";
  assert.ok(exampleName && !/\b(bank|inc|ltd|llc|corp|mutual)\b/i.test(exampleName), `the example names a project, not a company: ${exampleName}`);
  const embedded = buildExtractionPrompt("internal", { ...analysis("mid"), projectsLayout: "embedded_in_jobs" } as ResumeAnalysis, "2026-10-12");
  assert.ok(embedded.includes("named by its project name (see PROJECT NAME), never by the client"));
});
