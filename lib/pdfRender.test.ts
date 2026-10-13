/**
 * Purpose: tests for the server-side PDF (lib/pdfRender.ts) with the real templates and the real LibreOffice
 * (`soffice` must be installed, as on the server): the PDF holds the profile, uses the real brand fonts (not the
 * mislabelled embedded copies), leaves no temporary files behind, and a missing converter gives a clear error.
 * Fictional data only. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { extractText, getDocumentProxy } from "unpdf";
import { PdfError, convertDocxToPdf, renderProfileDocx, renderProfilePdf, withoutEmbeddedFonts } from "./pdfRender";
import type { ExternalResume, InternalResume } from "./schemas";

const INTERNAL: InternalResume = {
  name: "Robin Example",
  jobTitle: "Technology Delivery Manager",
  experienceSummary: "12+ Years of Industry Experience",
  specialization: "Cloud delivery",
  overview: "A fictional overview used only by the tests.",
  education: [{ year: "2010", qualification: "B.E. (Fictional University)" }],
  projects: [
    {
      duration: "2021 - 2023",
      title: "Sample Billing Platform",
      toolsAndTechnologies: ["Java", "Postgres"],
      teamSize: "6",
      role: "Delivery Lead",
      projectLink: "",
      description: "A made-up project.",
      responsibilities: ["Planned the releases", "Ran the reviews"],
    },
  ],
  skills: [{ name: "Delivery management", rating: "4.5" }],
  certifications: ["Sample Cloud Associate"],
  tools: ["Git"],
  managerialExperience: ["Team building"],
  domains: ["Fintech"],
  languages: ["English"],
};

const EXTERNAL: ExternalResume = {
  name: "Casey Placeholder",
  jobTitle: "Senior Engineer",
  experienceSummary: "8+ Years of Industry Experience",
  specialization: "Data pipelines",
  overview: "Another fictional overview.",
  education: [{ year: "2014", qualification: "M.Sc." }],
  skills: ["Python", "SQL"],
  tools: ["Airflow"],
  certifications: [],
  projects: [],
  experience: [{ company: "Example Corp", position: "Engineer", duration: "2015 - 2020", highlights: ["Built things"] }],
};

const tempDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("profile-pdf-")).sort();
const textOf = async (pdf: Uint8Array) => (await extractText(await getDocumentProxy(pdf.slice()), { mergePages: true })).text;
const latin1 = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");

test("an internal profile becomes a PDF with its content, in the real Lexend fonts", async () => {
  const before = tempDirs();
  const fontFiles = readdirSync("public/fonts").sort();
  const pdf = await renderProfilePdf("internal", INTERNAL);
  assert.equal(latin1(pdf.slice(0, 5)), "%PDF-");
  const text = await textOf(pdf);
  for (const s of ["Robin Example", "Technology Delivery Manager", "Sample Billing Platform", "Planned the releases", "Fintech"]) assert.ok(text.includes(s), `missing "${s}"`);
  const raw = latin1(pdf);
  assert.match(raw, /\+Lexend-Light\b/, "body text must use the real Lexend Light, not the mislabelled embedded copy");
  assert.match(raw, /\+Lexend-Medium\b/);
  assert.deepEqual(tempDirs(), before, "the temporary directory must be deleted");
  assert.deepEqual(readdirSync("public/fonts").sort(), fontFiles, "nothing (e.g. a fontconfig .uuid) may be written into public/fonts");
});

test("an external profile becomes a PDF too", async () => {
  const text = await textOf(await renderProfilePdf("external", EXTERNAL));
  for (const s of ["Casey Placeholder", "Senior Engineer", "Example Corp"]) assert.ok(text.includes(s), `missing "${s}"`);
});

test("withoutEmbeddedFonts removes the font files and every reference to them", async () => {
  const zip = withoutEmbeddedFonts(await renderProfileDocx("internal", INTERNAL));
  assert.equal(Object.keys(zip.files).filter((n) => n.startsWith("word/fonts/")).length, 0);
  assert.doesNotMatch(zip.file("word/fontTable.xml")!.asText(), /<w:embed/);
  assert.doesNotMatch(zip.file("word/_rels/fontTable.xml.rels")?.asText() ?? "", /<Relationship\b/);
  assert.doesNotMatch(zip.file("word/settings.xml")!.asText(), /embedTrueTypeFonts/);
});

test("a missing LibreOffice gives CONVERTER_MISSING and still cleans up", async () => {
  const before = tempDirs();
  const saved = process.env.SOFFICE_PATH;
  process.env.SOFFICE_PATH = "/nonexistent/soffice";
  try {
    await assert.rejects(convertDocxToPdf(new Uint8Array([1, 2, 3])), (e: unknown) => e instanceof PdfError && e.code === "CONVERTER_MISSING");
  } finally {
    if (saved === undefined) delete process.env.SOFFICE_PATH;
    else process.env.SOFFICE_PATH = saved;
  }
  assert.deepEqual(tempDirs(), before);
});
