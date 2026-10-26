/**
 * Purpose: turns a refused Google request into ONE of a few fixed, human sentences, so "SHEETS_AUTH" can say what to fix
 * (share the sheet, enable the API, replace the key, check the clock) without ever repeating Google's own text, the
 * spreadsheet id, the address or any key. The sentence is chosen by matching Google's machine-readable codes; the response
 * text itself is thrown away. Pure.
 */

/** Hint for a refused token request (the JWT exchange at oauth2.googleapis.com). */
export function tokenHint(body: string): string {
  let error = "";
  let description = "";
  try {
    const j = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    error = typeof j.error === "string" ? j.error : "";
    description = typeof j.error_description === "string" ? j.error_description : "";
  } catch {
    /* not JSON: fall through to the generic sentence */
  }
  if (/signature/i.test(description)) return "While getting the access token: the private key does not match the service-account address (wrong, replaced or deleted key). Create a new key and update the environment.";
  if (/short-lived|\biat\b|\bexp\b|timeframe|clock/i.test(description)) return "While getting the access token: Google says this computer's clock is off. Fix the system time.";
  if (/disabled|deleted|not found|unknown/i.test(description)) return "While getting the access token: the service account is disabled, deleted or its address is wrong.";
  if (error === "invalid_grant") return "While getting the access token: Google rejected the key (invalid_grant). Check the address and key belong together, or create a new key.";
  if (error === "invalid_client" || error === "unauthorized_client") return "While getting the access token: Google does not accept this service account.";
  return "While getting the access token: Google refused the request.";
}

/** Hint for a refused Sheets API call (status 401 or 403). */
export function sheetsHint(status: number, body: string): string {
  let reasons = "";
  let apiStatus = "";
  let message = "";
  try {
    const e = (JSON.parse(body) as { error?: Record<string, unknown> }).error ?? {};
    apiStatus = typeof e.status === "string" ? e.status : "";
    message = typeof e.message === "string" ? e.message : "";
    const details = Array.isArray(e.details) ? (e.details as { reason?: unknown }[]) : [];
    const errors = Array.isArray(e.errors) ? (e.errors as { reason?: unknown }[]) : [];
    reasons = [...details, ...errors].map((d) => (typeof d?.reason === "string" ? d.reason : "")).join(" ");
  } catch {
    /* not JSON */
  }
  if (/SERVICE_DISABLED/.test(reasons) || /has not been used in project|API has not been enabled|is disabled/i.test(message)) {
    return "While reading the sheet: the Google Sheets API is not enabled in the service account's Google Cloud project. Enable it, wait a minute, then try again.";
  }
  if (/SCOPE_INSUFFICIENT/.test(reasons)) return "While reading the sheet: the access token does not have read access to spreadsheets.";
  if (status === 403 || apiStatus === "PERMISSION_DENIED") {
    return "While reading the sheet: access denied. Share the sheet with the service-account address as Viewer (or confirm the owner has done it).";
  }
  return "While reading the sheet: Google did not accept the access token.";
}
