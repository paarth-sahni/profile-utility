/**
 * Purpose: "Submit again with nothing changed" on Preview. No profile content is sent and no version is created: the unchanged saved
 * version is reused, so all that can happen is a consent record and, if asked, marking that saved profile as primary. Because no save
 * request exists, the server's save gate is not reached, so this path asks the server's client-name check first (the registry may have
 * changed since the version was saved). Order: check -> consent -> primary. Anything but a clean, enforced-or-dormant answer stops
 * here (fails closed), and a stopped re-submit writes no consent record. Pure: the caller supplies the three actions.
 */
import type { ComplianceMatch, ComplianceResult } from "./complianceClient";

export type ResubmitOutcome =
  | { kind: "done" }
  | { kind: "blocked"; matches: ComplianceMatch[] }
  | { kind: "unavailable" } // the check could not be completed: nothing is recorded
  | { kind: "ended" }; // the sign-in ended

export async function resubmitSaved(deps: {
  check: () => Promise<ComplianceResult>;
  recordConsent: () => Promise<void>;
  markPrimary: () => Promise<void>;
}): Promise<ResubmitOutcome> {
  const r = await deps.check();
  if (r.status === "unauthenticated") return { kind: "ended" };
  if (r.status !== "ok") return { kind: "unavailable" };
  if (r.enforced && r.matches.length > 0) return { kind: "blocked", matches: r.matches };
  await deps.recordConsent();
  await deps.markPrimary();
  return { kind: "done" };
}
