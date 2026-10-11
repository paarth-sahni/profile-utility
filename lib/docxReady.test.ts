/** Purpose: unit tests for the "is this saved profile complete enough to export?" check and the file name. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReadyForDocx, docxFileName } from "./docxReady";
import type { InternalResume } from "./schemas";

const COMPLETE: InternalResume = {
  name: "Testy McSample",
  jobTitle: "Senior Engineer",
  experienceSummary: "8+ Years of Industry Experience",
  specialization: "Java and cloud",
  overview: "An overview.",
  education: [{ year: "2014", qualification: "B.E." }],
  projects: [
    {
      duration: "2020 - 2022",
      title: "Billing Platform",
      toolsAndTechnologies: ["Java"],
      teamSize: "4",
      role: "Lead",
      projectLink: "",
      description: "Built it.",
      responsibilities: ["Designed the schema"],
    },
  ],
  skills: [{ name: "Java", rating: "4" }],
  certifications: ["Sample Cloud Associate"],
  tools: ["Git"],
  managerialExperience: [],
  domains: ["Fintech"],
  languages: ["English"],
};

test("a complete profile is ready and comes back validated", () => {
  const r = checkReadyForDocx("internal", COMPLETE);
  assert.equal(r.ok, true);
});

test("an incomplete draft is not ready and the message points to Review", () => {
  const r = checkReadyForDocx("internal", { ...COMPLETE, name: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /^Incomplete: .* — .*Open in Review to finish it\.$/);
});

test("docxFileName uses underscores and falls back to resume", () => {
  assert.equal(docxFileName("internal", COMPLETE), "Testy_McSample_internal_profile.docx");
  assert.equal(docxFileName("external", { ...COMPLETE, name: "  " }), "resume_external_profile.docx");
});
