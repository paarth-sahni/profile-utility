/**
 * Purpose: the decisions behind the scheduled sync route, kept pure so they are tested without a server. The timer calls the
 * route every 30 minutes; each call asks "is today a sync day, and is a (re)try due now?" and only then starts a run. The days
 * come from the database settings (the 5th and 20th by default), so they can change without a code change. "Today" is the date in
 * SYNC_TIMEZONE (default Asia/Kolkata), not the server's own clock zone. Also checks the shared secret and that the call came
 * straight from this machine (not through the public web server).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { shouldAttemptNow, type LastRun } from "./retry";
import type { SchedulerState } from "./types";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DAYS = [5, 20];
const DEFAULT_MAX_ATTEMPTS = 4;

/** The calendar date ("YYYY-MM-DD") and day of month in a time zone. A bad zone name falls back to the default zone. */
export function dayInTimezone(now: Date, timeZone: string = DEFAULT_TIMEZONE): { iso: string; dayOfMonth: number } {
  const format = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let iso: string;
  try {
    iso = format(timeZone);
  } catch {
    iso = format(DEFAULT_TIMEZONE);
  }
  return { iso, dayOfMonth: Number(iso.slice(8, 10)) };
}

export type ScheduledDecision = { run: boolean; day: string; reason: string };

/** Whether to start a scheduled run now. `state` null (settings missing) means the defaults. */
export function decideScheduledRun(state: SchedulerState | null, now: Date, timeZone: string = DEFAULT_TIMEZONE): ScheduledDecision {
  const today = dayInTimezone(now, timeZone);
  const days = state?.schedule_days ?? DEFAULT_DAYS;
  if (!days.includes(today.dayOfMonth)) return { run: false, day: today.iso, reason: "not a scheduled day" };
  const last: LastRun | null = state?.last_run_for_day ?? null;
  const d = shouldAttemptNow(last, now, state?.max_attempts ?? DEFAULT_MAX_ATTEMPTS);
  return { run: d.go, day: today.iso, reason: d.reason };
}

/** Constant-time comparison of the shared secret. False when no secret is configured or none was sent. */
export function secretMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True for a request made straight to the app (the timer on this machine). A request that came through the web server carries
 * forwarding headers and is refused, as defence in depth next to the web server's own block on this path.
 */
export function isDirectCall(headers: Headers): boolean {
  return !["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"].some((h) => headers.has(h));
}
