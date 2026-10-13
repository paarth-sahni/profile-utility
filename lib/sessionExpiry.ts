/**
 * Purpose: pure rules for the "your session is ending" banner. The server computes how many milliseconds
 * are left of the hard sign-in limit (SESSION_MAX_AGE_MS, counted from the last sign-in); the browser counts
 * down from that, so a wrong laptop clock cannot show the banner too early or too late.
 * No DOM, React or server imports: safe for client components and unit tests (lib/sessionExpiry.test.ts).
 */
import { SESSION_MAX_AGE_MS } from "./authRules";

/** The banner appears this long before the session ends. */
export const EXPIRY_WARNING_MS = 5 * 60 * 1000;

/** Milliseconds left of the sign-in limit (0 when over or when the sign-in time is unknown/invalid). */
export function sessionRemainingMs(lastSignInAt: string | null | undefined, now: number = Date.now()): number {
  if (!lastSignInAt) return 0;
  const t = Date.parse(lastSignInAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, t + SESSION_MAX_AGE_MS - now);
}

/** What the banner should show for a given time left. */
export type ExpiryPhase = "none" | "warning" | "expired";

export function expiryPhase(remainingMs: number): ExpiryPhase {
  if (remainingMs <= 0) return "expired";
  return remainingMs <= EXPIRY_WARNING_MS ? "warning" : "none";
}

/** Whole minutes left, rounded up (4m01s -> 5), so the text never claims less time than there is. */
export function minutesLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 60_000));
}

/**
 * The banner text, or null when there is nothing to show. `canSave` is true when there is unsaved work:
 * then the text asks the user to Submit (or download); otherwise it only says the work is already safe.
 * `saves` is false for external profiles, which are never saved: the text then asks for a download instead and
 * never claims anything is saved.
 */
export function expiryMessage(remainingMs: number, canSave: boolean, saves: boolean = true): string | null {
  const phase = expiryPhase(remainingMs);
  if (phase === "none") return null;
  if (!saves) {
    if (phase === "expired") {
      return canSave
        ? "Your session has ended. Sign in again to continue; your work is kept in this tab so you can restore it."
        : "Your session has ended. Sign in again to continue.";
    }
    const m = minutesLeft(remainingMs);
    const when = remainingMs < 60_000 ? "in less than a minute" : m === 1 ? "in 1 minute" : `in ${m} minutes`;
    return canSave ? `Your session ends ${when} — download your PDF now. External profiles are not saved.` : `Your session ends ${when}.`;
  }
  if (phase === "expired") {
    return canSave
      ? "Your session has ended. Sign in again to continue; your unsaved changes are kept in this tab so you can restore them."
      : "Your session has ended. Sign in again to continue.";
  }
  const m = minutesLeft(remainingMs);
  const when = remainingMs < 60_000 ? "in less than a minute" : m === 1 ? "in 1 minute" : `in ${m} minutes`;
  return canSave
    ? `Your session ends ${when} — go to Preview and Submit to save your profile (or download your PDF).`
    : `Your session ends ${when}. Your latest changes are saved.`;
}
