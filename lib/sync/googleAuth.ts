/**
 * Purpose: gets a short-lived, read-only Google access token for the service account (JWT bearer flow), with no Google
 * library: the token request is signed with Node's crypto. The token and the key live in memory only and are never logged;
 * failures become our own SyncError codes (never Google's response text). `fetch` is injected so tests never touch Google.
 */
import { createSign } from "node:crypto";
import { SyncError } from "./errors";
import { tokenHint } from "./hints";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_LIFETIME_SECONDS = 3600;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const b64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/** The signed assertion Google exchanges for an access token. Exported so tests can verify its shape. */
export function signJwt(clientEmail: string, privateKey: string, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SHEETS_READONLY_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    }),
  );
  const signingInput = `${header}.${claims}`;
  try {
    const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
    return `${signingInput}.${b64url(signature)}`;
  } catch {
    // an unreadable key is a configuration problem, and the error must not echo any of the key
    throw new SyncError("CONFIG", "GOOGLE_SA_PRIVATE_KEY could not be used to sign.");
  }
}

/** Maps an HTTP status from Google to our codes (shared with the Sheets client). */
export function codeForStatus(status: number): "SHEETS_AUTH" | "SHEETS_NOT_FOUND" | "SHEETS_RATE_LIMIT" | "SHEETS_UNAVAILABLE" | "SHEETS_PARSE" {
  if (status === 401 || status === 403) return "SHEETS_AUTH";
  if (status === 404) return "SHEETS_NOT_FOUND";
  if (status === 429) return "SHEETS_RATE_LIMIT";
  if (status >= 500) return "SHEETS_UNAVAILABLE";
  return "SHEETS_PARSE";
}

export async function getAccessToken(
  creds: { clientEmail: string; privateKey: string },
  fetchFn: FetchFn,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const assertion = signJwt(creds.clientEmail, creds.privateKey, nowSeconds);
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
  } catch {
    throw new SyncError("SHEETS_UNAVAILABLE");
  }
  if (!res.ok) {
    // a rejected token request (bad or revoked key, disabled account) is an authentication problem, not "bad input".
    // Google's text is read only to pick one of our fixed hints and is then dropped.
    const code = res.status === 400 || res.status === 401 || res.status === 403 ? "SHEETS_AUTH" : codeForStatus(res.status);
    if (code === "SHEETS_AUTH") throw new SyncError(code, tokenHint(await res.text().catch(() => "")));
    throw new SyncError(code);
  }
  let token: unknown;
  try {
    token = ((await res.json()) as { access_token?: unknown }).access_token;
  } catch {
    throw new SyncError("SHEETS_UNAVAILABLE");
  }
  if (typeof token !== "string" || !token) throw new SyncError("SHEETS_UNAVAILABLE");
  return token;
}
