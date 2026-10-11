/**
 * Purpose: decides whether a saved profile is complete enough to turn into a document, and says why not in
 * plain words. Shared by the "Download DOCX" and "Open in Google Docs" buttons on the saved-profile pages
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
    return { ok: false, message: `Incomplete: ${where} — ${first.message}. Open in Review to finish it.` };
  }
  const na = findNAIssues(template, parsed.data);
  if (na.length > 0) return { ok: false, message: `Fix "${na[0].path}" in Review before downloading.` };
  return { ok: true, data: parsed.data as ResumeData };
}

/** The file name used for downloads: "<Candidate_Name>_<template>_profile.docx". */
export function docxFileName(template: TemplateId, data: ResumeData): string {
  const who = (data as { name?: string }).name?.trim().replace(/\s+/g, "_") || "resume";
  return `${who}_${template}_profile.docx`;
}
