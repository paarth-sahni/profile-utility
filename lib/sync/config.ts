/**
 * Purpose: reads the Google Sheets settings from the environment and checks their SHAPE, so a typo is caught before any
 * network call. Errors name the variable only, never its value. Pure (takes the environment as an argument).
 *
 *   GOOGLE_SHEETS_SPREADSHEET_ID  the id, or the whole sheet link (the id is taken out of it)
 *   GOOGLE_SA_CLIENT_EMAIL        the service account address (...@...iam.gserviceaccount.com)
 *   GOOGLE_SA_PRIVATE_KEY         the PEM key on one line, with \n for the line breaks (real line breaks work too)
 *   SYNC_TAB_NAMES                optional: only these tabs (comma separated); default is every tab
 */
import { SyncError } from "./errors";
import { parseTabNames } from "./tabs";

export type SheetsConfig = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
  /** Restrict the read to these tabs, or null for every tab. */
  tabNames: string[] | null;
};

type Env = Record<string, string | undefined>;

/** The id out of a bare id or a full link ("https://docs.google.com/spreadsheets/d/<id>/edit?gid=1"). */
export function extractSpreadsheetId(value: string): string | null {
  const v = value.trim().replace(/^["']|["']$/g, "");
  const fromLink = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(v);
  if (fromLink) return fromLink[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : null;
}

/** Turns "\n" typed into one line back into real line breaks and drops wrapping quotes. */
export function normalizePrivateKey(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
}

export function loadSheetsConfig(env: Env = process.env): SheetsConfig {
  const need = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) throw new SyncError("CONFIG", `${name} is not set.`);
    return v;
  };

  const spreadsheetId = extractSpreadsheetId(need("GOOGLE_SHEETS_SPREADSHEET_ID"));
  if (!spreadsheetId) throw new SyncError("CONFIG", "GOOGLE_SHEETS_SPREADSHEET_ID is not a spreadsheet id or link.");

  const clientEmail = need("GOOGLE_SA_CLIENT_EMAIL").replace(/^["']|["']$/g, "");
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new SyncError("CONFIG", "GOOGLE_SA_CLIENT_EMAIL is not a service account address.");
  }

  const privateKey = normalizePrivateKey(need("GOOGLE_SA_PRIVATE_KEY"));
  if (!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\s*$/.test(privateKey)) {
    throw new SyncError("CONFIG", "GOOGLE_SA_PRIVATE_KEY is not a complete PEM private key.");
  }

  const tabNames = parseTabNames(env.SYNC_TAB_NAMES);
  return { spreadsheetId, clientEmail, privateKey, tabNames };
}
