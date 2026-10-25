/**
 * Purpose: browser side of the PDF. Asks POST /api/pdf for the profile's PDF (the server fills the Word template and
 * converts it with LibreOffice) and saves a PDF Blob under its file name. The Preview step shows the very Blob that
 * Download PDF saves. Throws PdfRequestError with the HTTP status, so a caller can treat 401 as "session ended".
 */
import { saveAs } from "file-saver";
import type { ResumeData, TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Where the server found a registered client name (COMPLIANCE): the field path, the text and its position. */
export type PdfComplianceMatch = { path: string; start: number; end: number; matchedText: string };

export class PdfRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's error code (for example COMPLIANCE or REGISTRY_UNAVAILABLE). */
    readonly code?: string,
    readonly matches?: PdfComplianceMatch[],
  ) {
    super(message);
    this.name = "PdfRequestError";
  }
}

/** The profile as a PDF Blob, made by the server. */
export async function fetchProfilePdf(template: TemplateId, data: ResumeData): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, data }),
    });
  } catch {
    throw new PdfRequestError("We could not reach the server to create the PDF. Please check your connection and try again.", 0);
  }
  if (res.ok) {
    const bytes = await res.arrayBuffer();
    return new Blob([bytes], { type: "application/pdf" });
  }
  let message = "We could not create the PDF. Please try again.";
  let code: string | undefined;
  let matches: PdfComplianceMatch[] | undefined;
  try {
    const json = (await res.json()) as { error?: { message?: string; code?: string; matches?: PdfComplianceMatch[] } };
    if (json.error?.message) message = json.error.message;
    code = json.error?.code;
    if (Array.isArray(json.error?.matches)) matches = json.error.matches;
  } catch {
    /* keep the generic message */
  }
  throw new PdfRequestError(message, res.status, code, matches);
}

/** Hands a PDF Blob to the browser as a download. */
export function savePdf(blob: Blob, fileName: string): void {
  saveAs(blob, fileName);
}
