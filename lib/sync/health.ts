/**
 * Purpose: one plain-language answer to "is the registry up to date?" for the admin page: never synced, the latest run failed,
 * or the last success is older than the allowed age. Pure.
 */
export type HealthLevel = "ok" | "never" | "failing" | "stale";

export type RegistryHealth = { level: HealthLevel; message: string; daysSinceSuccess: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;

export function registryHealth(input: {
  lastSuccessAt: string | null;
  latestRunStatus: "running" | "succeeded" | "partial" | "failed" | null;
  staleAfterDays: number;
  now?: Date;
}): RegistryHealth {
  const now = input.now ?? new Date();
  if (!input.lastSuccessAt) {
    return { level: "never", message: "The registry has never been synchronised successfully.", daysSinceSuccess: null };
  }
  const days = Math.floor((now.getTime() - new Date(input.lastSuccessAt).getTime()) / DAY_MS);
  if (days >= input.staleAfterDays) {
    return { level: "stale", message: `The last successful synchronisation was ${days} days ago (limit ${input.staleAfterDays}).`, daysSinceSuccess: days };
  }
  if (input.latestRunStatus === "failed" || input.latestRunStatus === "partial") {
    return { level: "failing", message: `The latest synchronisation did not fully succeed (${input.latestRunStatus}). The last full success was ${days} day${days === 1 ? "" : "s"} ago.`, daysSinceSuccess: days };
  }
  return { level: "ok", message: `Up to date: the last successful synchronisation was ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}.`, daysSinceSuccess: days };
}

/** Whole calendar months since the service-account key was created (GOOGLE_SA_KEY_CREATED, "YYYY-MM-DD"), or null when unset or invalid. */
export function keyAgeMonths(created: string | undefined, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((created ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}`))) return null;
  const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - mo) - (now.getUTCDate() < d ? 1 : 0);
  return Math.max(months, 0);
}
