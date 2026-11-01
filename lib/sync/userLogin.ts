/**
 * Purpose: the pure parts of the one-time developer sign-in (scripts/sync-login.ts) that lets the local registry sync read a
 * Google Sheet as a person instead of as the service account. DEV ONLY (see config.ts). No server, no file access here, so it
 * is unit-tested: the authorisation URL (read-only scope, PKCE), the code-for-token exchange (fetch injected), and the edit of
 * one `KEY=value` line in an env file. Nothing here prints or logs a token or secret.
 */
import { createHash, randomBytes } from "node:crypto";
import { SyncError } from "./errors";
import { SHEETS_READONLY_SCOPE, TOKEN_URL, type FetchFn } from "./googleAuth";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** A PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The address the person opens to approve READ-ONLY access to their spreadsheets. */
export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: SHEETS_READONLY_SCOPE,
    access_type: "offline", // gives a refresh token
    prompt: "consent", // so a refresh token is issued again even if this account approved the client before
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** Exchanges the one-time code for a refresh token. Errors carry fixed wording only (never Google's text or any secret). */
export async function exchangeCodeForRefreshToken(
  p: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string },
  fetchFn: FetchFn,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code: p.code,
        code_verifier: p.verifier,
        redirect_uri: p.redirectUri,
      }).toString(),
    });
  } catch {
    throw new SyncError("SHEETS_UNAVAILABLE", "Could not reach Google to finish the sign-in.");
  }
  if (!res.ok) {
    throw new SyncError("SHEETS_AUTH", "Google refused the sign-in code. Check the OAuth client id and secret in .env.local (a Desktop app client) and try again.");
  }
  let token: unknown;
  try {
    token = ((await res.json()) as { refresh_token?: unknown }).refresh_token;
  } catch {
    throw new SyncError("SHEETS_UNAVAILABLE", "Google's answer could not be read.");
  }
  if (typeof token !== "string" || !token) {
    throw new SyncError("SHEETS_AUTH", "Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and run the sign-in again.");
  }
  return token;
}

/** The file content with `KEY=value` set: the existing KEY line is replaced (or appended when absent); other lines and the line ending style are kept. */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.length ? content.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // the final line break, re-added below
  const line = `${key}=${value}`;
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  return `${lines.join(eol)}${eol}`;
}
