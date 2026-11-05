/**
 * Purpose: decides whether a saved profile is complete enough to turn into a document, and says why not in
 * plain words. Shared by POST /api/pdf, the "Download PDF" and "Open in Google Docs" buttons on the saved-profile pages
 * (an incomplete draft must be finished on the Review screen first), and the Submit check on the server (lib/profileSave.ts).
 * Pure; unit-tested (lib/docxReady.test.ts).
 */
import { friendlyMessage, pathKey } from "./fieldErrors";
import { describeFieldPath, findNAIssues, schemaFor, type ResumeData, type TemplateId } from "./schemas";

/** A field that is not ready: its dot path ("projects.0.title", "" for the whole profile) and a short message. */
export type ReadyIssue = { path: string; message: string };

export type DocxReady = { ok: true; data: ResumeData } | { ok: false; message: string; issues: ReadyIssue[] };

/** Validates with the strict schema and the "N/A" check; returns the validated data or a friendly message and every field to fix. */
export function checkReadyForDocx(template: TemplateId, data: ResumeData): DocxReady {
  const parsed = schemaFor(template).safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? describeFieldPath(first.path as (string | number)[]) : "profile";
    const issues = parsed.error.issues.map((i) => ({ path: pathKey(i.path as (string | number)[]), message: friendlyMessage(i.message) }));
    return { ok: false, message: `Incomplete: ${where} — ${first.message}. Open in editor to finish it.`, issues };
  }
  const na = findNAIssues(template, parsed.data);
  if (na.length > 0) {
    const issues = na.map((n) => ({ path: n.key ?? "", message: 'Replace the placeholder "N/A" with the real value.' }));
    return { ok: false, message: `Fix "${na[0].path}" in the editor before downloading.`, issues };
  }
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

/**
 * The file name of every PDF download (Preview, My Profiles, Manage; both templates): "FullName_Role_InfoBeans.pdf" with
 * underscores between all parts and inside them, e.g. "Asha_Rao_AI_Intern_InfoBeans.pdf". The one place the format is
 * decided: the IB employee code can be added to `parts` here once it syncs from the Team app.
 */
export function pdfFileName({ name, jobTitle }: { name?: string; jobTitle?: string }): string {
  const parts = [fileNamePart(name) || "Profile", fileNamePart(jobTitle), "InfoBeans"].filter(Boolean);
  return `${parts.join("_")}.pdf`;
}

/** How a saved profile is named in the My Profiles and Manage lists, e.g. "Abdul-Technology_Delivery_Manager-InfoBeans". */
export function profileDisplayName(name: string, jobTitle: string): string {
  return `${[fileNamePart(name) || "Profile", fileNamePart(jobTitle)].filter(Boolean).join("-")}-InfoBeans`;
}
