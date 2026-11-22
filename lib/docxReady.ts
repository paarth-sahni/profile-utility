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


/**
 * One word of the name: split at spaces and punctuation, each word's first letter upper-cased (the rest kept as typed), then
 * everything but letters and digits removed: "AI Intern" -> "AIIntern", "saumya jain" -> "SaumyaJain",
 * "Sr. Software-Engineer" -> "SrSoftwareEngineer", "O'Brien" -> "OBrien".
 */
export const nameWord = (value: string | undefined): string =>
  (value ?? "")
    .replace(/['\u2019]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => {
      const [first = "", ...rest] = [...w];
      return first.toUpperCase() + rest.join("");
    })
    .join("");

/** An IB code as it comes from TeamMemberCode (trimmed), or "" when there is none or it holds unsafe characters. */
const safeIbCode = (ibCode: string | null | undefined): string => {
  const code = (ibCode ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(code) ? code : "";
};

/**
 * The name of a profile, the one place the format is decided: "<IBCode>_<NameSurname>_<Role>_InfoBeans", e.g.
 * "7224_SaumyaJain_AIIntern_InfoBeans"; without an IB code "SaumyaJain_AIIntern_InfoBeans". Used for the PDF download
 * (pdfFileName) and the saved-profile name in My Profiles and Profile Hub. The IB code is the profile OWNER's, from the
 * Teams data (looked up on the server: lib/pdfOwner.ts, lib/ownerCodes.ts). No name -> "Profile"; no role -> left out.
 */
export function profileDisplayName(name: string, jobTitle: string, ibCode?: string | null): string {
  return [safeIbCode(ibCode), nameWord(name) || "Profile", nameWord(jobTitle), "InfoBeans"].filter(Boolean).join("_");
}

/** The file name of every PDF download (Preview, My Profiles, Profile Hub; both templates): the profile name + ".pdf". */
export function pdfFileName({ name, jobTitle }: { name?: string; jobTitle?: string }, ibCode?: string | null): string {
  return `${profileDisplayName(name ?? "", jobTitle ?? "", ibCode)}.pdf`;
}
