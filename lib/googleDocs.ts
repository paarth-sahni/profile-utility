/**
 * Purpose: "Open in Google Docs" without a server. The browser asks Google for a short-lived access token
 * (drive.file only: files this app creates), uploads the generated DOCX straight to Google Drive converting it
 * into a Google Doc, and opens the result. The token lives only in a local variable for that one call: it is
 * never stored and never sent to our server (the only request made here goes to www.googleapis.com).
 * This file is the pure part (error mapping, request building, upload); the Google sign-in popup is in
 * lib/googleTokenClient.ts. Unit-tested in lib/googleDocs.test.ts.
 */

/** The only scope requested: access to files this app creates itself, nothing else in the user's Drive. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export type GoogleDocsErrorCode =
  | "script_failed" // Google's sign-in script could not be loaded (offline, blocked)
  | "popup_blocked" // the browser blocked the Google sign-in window
  | "popup_closed" // the user closed it
  | "access_denied" // the user (or the organisation) did not grant access
  | "api_disabled" // the Google Drive API is not enabled for the project
  | "token_expired" // Google rejected the token
  | "rate_limited"
  | "network"
  | "upload_failed";

/** An error with a code that maps to a friendly message (see describeGoogleDocsError). Never carries a token. */
export class GoogleDocsError extends Error {
  constructor(public readonly code: GoogleDocsErrorCode) {
    super(code);
    this.name = "GoogleDocsError";
  }
}

const MESSAGES: Record<GoogleDocsErrorCode, string> = {
  script_failed: "Google sign-in could not be loaded. Check your connection or ad blocker and try again.",
  popup_blocked: "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
  popup_closed: "The Google window was closed before you finished. Try again when you are ready.",
  access_denied: "Google access was not granted, so nothing was created. You can try again and allow access to the files this app creates.",
  api_disabled: "Google Drive is not enabled for this app yet. Please ask your administrator to turn on the Google Drive API.",
  token_expired: "Your Google sign-in expired. Please try again.",
  rate_limited: "Google is busy right now. Please wait a minute and try again.",
  network: "We could not reach Google. Check your connection and try again.",
  upload_failed: "Google could not create the document. Please try again, or use Download PDF instead.",
};

/** Plain-language text for any error thrown while opening in Google Docs (unknown errors get the generic one). */
export function describeGoogleDocsError(error: unknown): string {
  return MESSAGES[error instanceof GoogleDocsError ? error.code : "upload_failed"];
}

/** Maps a failed Drive response (status + parsed JSON body, if any) to an error code. */
export function mapDriveError(status: number, body: unknown): GoogleDocsErrorCode {
  const reasons = driveReasons(body);
  if (status === 401) return "token_expired";
  if (status === 429 || reasons.some((r) => /ratelimit/i.test(r))) return "rate_limited";
  if (status === 403) {
    if (reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r))) return "api_disabled";
    return "access_denied";
  }
  return "upload_failed";
}

/** The machine-readable reasons in a Google API error body ({error:{errors:[{reason}], details:[{reason}]}}). */
function driveReasons(body: unknown): string[] {
  const out: string[] = [];
  const err = (body as { error?: { errors?: { reason?: unknown }[]; details?: { reason?: unknown }[]; status?: unknown } } | null)?.error;
  for (const e of err?.errors ?? []) if (typeof e.reason === "string") out.push(e.reason);
  for (const d of err?.details ?? []) if (typeof d.reason === "string") out.push(d.reason);
  if (typeof err?.status === "string") out.push(err.status);
  return out;
}

/** Builds the multipart/related request body: JSON metadata (name + target type) then the DOCX bytes. */
export function buildMultipartBody(name: string, docx: Blob, boundary: string): Blob {
  const metadata = JSON.stringify({ name, mimeType: GOOGLE_DOC_MIME });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${DOCX_MIME}\r\n\r\n`;
  return new Blob([head, docx, `\r\n--${boundary}--`]);
}

export interface CreatedGoogleDoc {
  id: string;
  /** Link that opens the document in Google Docs. */
  url: string;
}

/**
 * Uploads the DOCX to the user's Drive as a Google Doc (Drive converts it). `fetchImpl` is injectable for tests.
 * Throws GoogleDocsError; the token is used only in the Authorization header of this one request.
 */
export async function uploadAsGoogleDoc(
  accessToken: string,
  name: string,
  docx: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedGoogleDoc> {
  const boundary = `ib-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  let res: Response;
  try {
    res = await fetchImpl(UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: buildMultipartBody(name, docx, boundary),
    });
  } catch {
    throw new GoogleDocsError("network");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* a body is not guaranteed on errors */
  }
  if (!res.ok) throw new GoogleDocsError(mapDriveError(res.status, json));
  const file = json as { id?: unknown; webViewLink?: unknown } | null;
  if (typeof file?.id !== "string") throw new GoogleDocsError("upload_failed");
  const url = typeof file.webViewLink === "string" ? file.webViewLink : `https://docs.google.com/document/d/${file.id}/edit`;
  return { id: file.id, url };
}
