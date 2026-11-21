/**
 * Purpose: browser side of the PDF. Asks POST /api/pdf for the profile's PDF (the server fills the Word template and
 * converts it with LibreOffice) and saves a PDF Blob under its file name. The Preview step shows the very Blob that
 * Download PDF saves. Throws PdfRequestError with the HTTP status, so a caller can treat 401 as "session ended". A download
 * passes `consent: "download"`: the server records the consent only after its checks pass and the PDF is made.
 */
import { saveAs } from "file-saver";
import type { ResumeData, TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Where the server found a registered client name (COMPLIANCE): the field path, the text and its position. */
export type PdfComplianceMatch = { path: string; start: number; end: number; matchedText: string };

/** A field the server found incomplete (INCOMPLETE): its path and what to do. */
export type PdfFieldIssue = { path: string; message: string };

export class PdfRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's error code (for example COMPLIANCE or REGISTRY_UNAVAILABLE). */
    readonly code?: string,
    readonly matches?: PdfComplianceMatch[],
    readonly fields?: PdfFieldIssue[],
  ) {
    super(message);
    this.name = "PdfRequestError";
  }
}

/** The file name the server chose (Content-Disposition filename*), or null. */
function serverFileName(res: Response): string | null {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("Content-Disposition") ?? "");
  try {
    const name = m ? decodeURIComponent(m[1]) : "";
    return /^[^/\\]{1,200}\.pdf$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * The profile as a PDF, made by the server: a File named as the server named it (IBCode_FullName_Role.pdf when the owner has
 * an IB code; savePdf uses that name), or a plain Blob when it sent none. With `consent: "download"` the server also records
 * the download consent. `versionId`: a saved version, so the server names the file after that profile's owner.
 */
export async function fetchProfilePdf(template: TemplateId, data: ResumeData, options: { consent?: "download"; versionId?: string } = {}): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template,
        data,
        ...(options.consent ? { consent: { action: options.consent, accepted: true } } : {}),
        ...(options.versionId ? { versionId: options.versionId } : {}),
      }),
    });
  } catch {
    throw new PdfRequestError("We could not reach the server to create the PDF. Please check your connection and try again.", 0);
  }
  if (res.ok) {
    const bytes = await res.arrayBuffer();
    const name = serverFileName(res);
    return name ? new File([bytes], name, { type: "application/pdf" }) : new Blob([bytes], { type: "application/pdf" });
  }
  let message = "We could not create the PDF. Please try again.";
  let code: string | undefined;
  let matches: PdfComplianceMatch[] | undefined;
  let fields: PdfFieldIssue[] | undefined;
  try {
    const json = (await res.json()) as { error?: { message?: string; code?: string; matches?: PdfComplianceMatch[]; fields?: PdfFieldIssue[] } };
    if (json.error?.message) message = json.error.message;
    code = json.error?.code;
    if (Array.isArray(json.error?.matches)) matches = json.error.matches;
    if (Array.isArray(json.error?.fields)) fields = json.error.fields;
  } catch {
    /* keep the generic message */
  }
  throw new PdfRequestError(message, res.status, code, matches, fields);
}

/** Hands a PDF Blob to the browser as a download: under the server's name when it gave one, else `fileName`. */
export function savePdf(blob: Blob, fileName: string): void {
  saveAs(blob, typeof File !== "undefined" && blob instanceof File && blob.name ? blob.name : fileName);
}
