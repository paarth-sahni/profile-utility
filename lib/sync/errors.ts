/**
 * Purpose: the few ways a synchronisation can fail, as codes. The message of a SyncError is ALWAYS our own fixed text
 * (never a Google response body, a cell value, a key or a spreadsheet id), so it is safe to store in sync history, show
 * to an administrator and write to a log. Pure.
 * Retryable = worth trying again later (rate limit, outage). Everything else needs an operator.
 */
export type SyncErrorCode =
  | "CONFIG"
  | "SHEETS_AUTH"
  | "SHEETS_NOT_FOUND"
  | "SHEETS_RATE_LIMIT"
  | "SHEETS_UNAVAILABLE"
  | "SHEETS_PARSE"
  | "NO_TABS"
  | "EMPTY_SHEET"
  | "RUN_IN_PROGRESS"
  | "RUN_LIMIT"
  | "DB_ERROR"
  | "UNKNOWN";

const MESSAGES: Record<SyncErrorCode, string> = {
  CONFIG: "The synchronisation is not configured correctly.",
  SHEETS_AUTH: "Google rejected the service-account credentials or the sheet is not shared with it.",
  SHEETS_NOT_FOUND: "The spreadsheet was not found. Check the spreadsheet id and that it is shared with the service account.",
  SHEETS_RATE_LIMIT: "Google asked the application to slow down.",
  SHEETS_UNAVAILABLE: "Google could not be reached or had a temporary problem.",
  SHEETS_PARSE: "At least one tab does not have the expected layout.",
  NO_TABS: "No monthly tab was found in the allowed date range.",
  EMPTY_SHEET: "The tabs were read but contain no names, so nothing was concluded.",
  RUN_IN_PROGRESS: "A synchronisation is already running.",
  RUN_LIMIT: "A synchronisation is not allowed right now (cooldown, retry limit or already done).",
  DB_ERROR: "The registry database rejected or could not complete the update.",
  UNKNOWN: "The synchronisation failed for an unexpected reason.",
};

const RETRYABLE = new Set<SyncErrorCode>(["SHEETS_RATE_LIMIT", "SHEETS_UNAVAILABLE"]);

export const isRetryable = (code: string): boolean => RETRYABLE.has(code as SyncErrorCode);

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly retryable: boolean;
  /** `detail` is only for our own wording such as the NAME of a missing setting, never a value. */
  constructor(code: SyncErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code]);
    this.name = "SyncError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

/** Anything thrown becomes a SyncError whose message is safe to store. */
export function toSyncError(e: unknown, fallback: SyncErrorCode = "UNKNOWN"): SyncError {
  return e instanceof SyncError ? e : new SyncError(fallback);
}
