/**
 * Purpose: small, pure auth helpers shared by the proxy, the OAuth callback and the login page.
 */

/** Only InfoBeans accounts may sign in. Mirrors the DB trigger (defence in depth). */
export const ALLOWED_EMAIL_DOMAIN = (process.env.AUTH_ALLOWED_DOMAIN ?? "infobeans.com").toLowerCase();

/** A sign-in is valid for at most one hour; after that the user must sign in with Google again. */
export const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

/** True once the user's last actual sign-in (not a token refresh) is older than SESSION_MAX_AGE_MS. */
export function sessionExpired(lastSignInAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSignInAt) return true;
  const t = Date.parse(lastSignInAt);
  return Number.isNaN(t) || now - t >= SESSION_MAX_AGE_MS;
}

/** Page shown after sign-in when no (valid) `next` is given. */
export const DEFAULT_AFTER_LOGIN = "/internal";

/** True if the email belongs to the allowed InfoBeans domain. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) return true;
  // Seeded local test users (supabase/seed.sql) only exist in development databases; never in production.
  const devOnly = process.env.NODE_ENV !== "production";
  return devOnly && e.endsWith("@example.test");
}

/**
 * Returns `next` only if it is a same-site relative path; otherwise the default.
 * Blocks open redirects such as `//evil.com`, `/\evil.com` and absolute URLs.
 */
export function safeNextPath(next: string | null | undefined, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  if (next.startsWith("/login") || next.startsWith("/auth")) return fallback;
  return next;
}

/** Friendly text for the `?error=` codes the login page can receive. */
export const LOGIN_ERRORS: Record<string, string> = {
  domain: "That Google account isn't an InfoBeans account. Please sign in with your @infobeans.com email.",
  cancelled: "Sign-in was cancelled. Please try again.",
  failed: "We couldn't sign you in. Please try again.",
  session: "Your session has expired. Please sign in again.",
};
