/**
 * Purpose: decides whether a saved profile is complete enough to turn into a document, and says why not in
 * plain words. Shared by POST /api/pdf, the "Download PDF" and "Open in Google Docs" buttons on the saved-profile pages
 * (an incomplete draft must be finished on the Review screen first). Pure; unit-tested (lib/docxReady.test.ts).
 */
import { describeFieldPath, findNAIssues, schemaFor, type ResumeData, type TemplateId } from "./schemas";

export type DocxReady = { ok: true; data: ResumeData } | { ok: false; message: string };

/** Validates with the strict schema and the "N/A" check; returns the validated data or a friendly message. */
export function checkReadyForDocx(template: TemplateId, data: ResumeData): DocxReady {
  const parsed = schemaFor(template).safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? describeFieldPath(first.path as (string | number)[]) : "profile";
    return { ok: false, message: `Incomplete: ${where} — ${first.message}. Open in editor to finish it.` };
  }
  const na = findNAIssues(template, parsed.data);
  if (na.length > 0) return { ok: false, message: `Fix "${na[0].path}" in the editor before downloading.` };
  return { ok: true, data: parsed.data as ResumeData };
}


/** One part of a file name: spaces become "_", anything but letters, digits, "_" and "-" is removed. */
const fileNamePart = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

/** The PDF download name: "<Name>-<Job_title>-InfoBeans.pdf", e.g. "Abdul-Technology_Delivery_Manager-InfoBeans.pdf". */
export function pdfFileName({ name, jobTitle }: { name?: string; jobTitle?: string }): string {
  const parts = [fileNamePart(name) || "Profile", fileNamePart(jobTitle)].filter(Boolean);
  return `${parts.join("-")}-InfoBeans.pdf`;
}

/** How a saved profile is named in My Profiles and Manage: the PDF name without ".pdf", e.g. "Abdul-Technology_Delivery_Manager-InfoBeans". */
export function profileDisplayName(name: string, jobTitle: string): string {
  return pdfFileName({ name, jobTitle }).replace(/\.pdf$/, "");
}
