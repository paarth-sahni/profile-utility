/**
 * Purpose: tiny in-memory sliding-window rate limiter (per key). Good enough for a single server
 * instance; swap for a shared store if the app is ever scaled out.
 */
const hits = new Map<string, number[]>();

/** Records a hit for `key`; returns false if more than `limit` hits happened in the last `windowMs`. */
export function allowRequest(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Test helper. */
export function resetRateLimits(): void {
  hits.clear();
}
