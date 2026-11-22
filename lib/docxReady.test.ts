/** Purpose: unit tests for the "is this saved profile complete enough to export?" check and the file name. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReadyForDocx, pdfFileName, profileDisplayName } from "./docxReady";
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

test("a profile with only the required fields is ready, and its empty optional sections are fine", () => {
  const r = checkReadyForDocx("internal", {
    ...COMPLETE,
    specialization: "",
    projects: [],
    certifications: [],
    tools: [""],
    managerialExperience: [],
    domains: ["N/A"],
    languages: [],
  });
  assert.equal(r.ok, true);
});

test("a profile without an experience summary is not ready", () => {
  assert.equal(checkReadyForDocx("internal", { ...COMPLETE, experienceSummary: "" }).ok, false);
});

test("an incomplete draft is not ready and the message points to Review", () => {
  const r = checkReadyForDocx("internal", { ...COMPLETE, name: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /^Incomplete: .* — .*Open in editor to finish it\.$/);
});


test("pdfFileName is NameSurname_Role_InfoBeans.pdf: each part one word, first letters upper-cased, only letters and digits", () => {
  assert.equal(pdfFileName({ ...COMPLETE, name: "Saumya Jain", jobTitle: "AI Intern" }), "SaumyaJain_AIIntern_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "saumya jain", jobTitle: "ai intern" }), "SaumyaJain_AiIntern_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Abdul", jobTitle: "Technology Delivery Manager" }), "Abdul_TechnologyDeliveryManager_InfoBeans.pdf");
  assert.equal(pdfFileName(COMPLETE), "TestyMcSample_SeniorEngineer_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Asha Rao", jobTitle: "Sr. Software-Engineer" }), "AshaRao_SrSoftwareEngineer_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: " José  O'Brien ", jobTitle: "QA / Test Lead: Cloud*" }), "JoséOBrien_QATestLeadCloud_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "../../etc/passwd", jobTitle: "a\\b" }), "EtcPasswd_AB_InfoBeans.pdf");
});

test("pdfFileName falls back to Profile and drops an empty job title", () => {
  assert.equal(pdfFileName({ ...COMPLETE, name: "  ", jobTitle: "" }), "Profile_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "???", jobTitle: "Lead" }), "Profile_Lead_InfoBeans.pdf");
});

test("profileDisplayName is the PDF name without .pdf (My Profiles and Profile Hub)", () => {
  assert.equal(profileDisplayName("Abdul", "Technology Delivery Manager"), "Abdul_TechnologyDeliveryManager_InfoBeans");
  assert.equal(profileDisplayName("Saumya Jain", "AI Intern", "7224"), "7224_SaumyaJain_AIIntern_InfoBeans");
  assert.equal(profileDisplayName("", ""), "Profile_InfoBeans");
  assert.equal(profileDisplayName("Ana", ""), "Ana_InfoBeans");
  // the list name and the download name can never differ
  const person = { name: "José O'Brien", jobTitle: "QA / Test Lead" };
  assert.equal(`${profileDisplayName(person.name, person.jobTitle)}.pdf`, pdfFileName(person));
  assert.equal(`${profileDisplayName(person.name, person.jobTitle, "IB12")}.pdf`, pdfFileName(person, "IB12"));
});

test("pdfFileName with the owner's IB code: IBCode_NameSurname_Role_InfoBeans.pdf, the code as given; an empty or unsafe code is left out", () => {
  assert.equal(pdfFileName({ ...COMPLETE, name: "Saumya Jain", jobTitle: "AI Intern" }, "7224"), "7224_SaumyaJain_AIIntern_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Asha Rao", jobTitle: "" }, " ib77 "), "ib77_AshaRao_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Asha Rao", jobTitle: "AI Intern" }, null), "AshaRao_AIIntern_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Asha Rao", jobTitle: "AI Intern" }, ""), "AshaRao_AIIntern_InfoBeans.pdf");
  assert.equal(pdfFileName({ ...COMPLETE, name: "Asha Rao", jobTitle: "AI Intern" }, "../IB1"), "AshaRao_AIIntern_InfoBeans.pdf");
});
