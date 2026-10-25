/**
 * Purpose: keeps the compiled matcher in memory so a profile request does not hit the database every time. The list is
 * reloaded after `ttlMs`; if a reload fails the previous copy keeps serving for up to `staleMs` (so a short database or key
 * problem does not stop all profile work), and after that, or when nothing was ever loaded, it throws
 * RegistryUnavailableError (the routes then FAIL CLOSED). Concurrent callers share one load. Pure apart from the injected
 * loader and clock, so it is unit-tested. Per-process, like the app's rate limits (the app runs as one instance).
 */
import { buildMatcher, type Matcher, type RegistryName } from "./match";

export class RegistryUnavailableError extends Error {
  constructor() {
    super("The client-name registry is not available.");
    this.name = "RegistryUnavailableError";
  }
}

export type RegistryCacheOptions = {
  load: () => Promise<RegistryName[]>;
  now?: () => number;
  /** Reload after this long (default 60 s). */
  ttlMs?: number;
  /** A failed reload may reuse the last copy for this long (default 24 h). */
  staleMs?: number;
};

export type RegistryHandle = { matcher: Matcher; loadedAt: number; stale: boolean };

export function createRegistryCache(opts: RegistryCacheOptions): { get: () => Promise<RegistryHandle>; reset: () => void } {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? 60_000;
  const staleMs = opts.staleMs ?? 24 * 60 * 60 * 1000;
  let current: { matcher: Matcher; loadedAt: number } | null = null;
  let inflight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const names = await opts.load();
      current = { matcher: buildMatcher(names), loadedAt: now() };
    } catch {
      /* keep the previous copy, if any; get() decides whether it is still acceptable */
    }
  }

  return {
    async get() {
      const t = now();
      if (!current || t - current.loadedAt >= ttlMs) {
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        await inflight;
      }
      if (!current) throw new RegistryUnavailableError();
      const age = now() - current.loadedAt;
      if (age >= staleMs) throw new RegistryUnavailableError();
      return { matcher: current.matcher, loadedAt: current.loadedAt, stale: age >= ttlMs };
    },
    reset() {
      current = null;
      inflight = null;
    },
  };
}
