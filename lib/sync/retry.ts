/**
 * Purpose: when and whether to try a failed scheduled synchronisation again. The timer calls the sync route often on a
 * scheduled day; this decides if now is a good moment. Bounded: at most `maxAttempts` per scheduled day (also enforced by
 * the database), with growing waits and jitter so retries do not hit Google in lockstep. Only transient failures are
 * retried: a wrong key, a missing sheet or an unreadable tab needs a person. Pure.
 */
import { isRetryable } from "./errors";

/** Waits after the 1st, 2nd, 3rd failed attempt (minutes). Later attempts keep the last wait. */
const WAITS_MINUTES = [1, 5, 20];
const JITTER = 0.2;

/** Milliseconds to wait after failed attempt number `attempt` (1-based). `rand` is 0..1 (injectable for tests). */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = WAITS_MINUTES[Math.min(Math.max(attempt, 1), WAITS_MINUTES.length) - 1] * 60_000;
  return Math.round(base * (1 - JITTER + 2 * JITTER * rand()));
}

export type LastRun = {
  status: "running" | "succeeded" | "partial" | "failed";
  attempt: number;
  finished_at: string | null;
  error_code: string | null;
};

export type AttemptDecision = { go: boolean; reason: string };

/**
 * Should a scheduled run for a day be started now, given the latest run of that day (null = none yet)?
 * `maxAttempts` comes from compliance_settings; the database refuses attempts beyond it as well.
 */
export function shouldAttemptNow(last: LastRun | null, now: Date, maxAttempts: number, rand: () => number = () => 0.5): AttemptDecision {
  if (!last) return { go: true, reason: "no run yet for this day" };
  if (last.status === "succeeded") return { go: false, reason: "already succeeded" };
  if (last.status === "running") return { go: false, reason: "a run is in progress" };
  if (last.attempt >= maxAttempts) return { go: false, reason: "retry limit reached, an administrator must look" };
  // STALE_RUN = a run that died without finishing (e.g. a restart): safe to try again
  if (last.error_code && last.error_code !== "STALE_RUN" && !isRetryable(last.error_code)) return { go: false, reason: `needs an administrator (${last.error_code})` };
  if (!last.finished_at) return { go: false, reason: "previous run has no end time" };
  const readyAt = new Date(last.finished_at).getTime() + backoffMs(last.attempt, rand);
  return now.getTime() >= readyAt ? { go: true, reason: "retry due" } : { go: false, reason: "waiting before the next retry" };
}
