/**
 * Purpose: the server-side gate for the client-name rule. Routes call `complianceGate(data)` on the profile they are about to
 * turn into a PDF or store; it answers with the response to send when the profile must be refused, or null to carry on.
 *   COMPLIANCE_ENFORCE unset or not "on"  -> dormant: nothing is checked (code can ship before the registry exists)
 *   "on" + a registered name is found     -> 422 COMPLIANCE with where it is (field path, offsets, the text the caller typed)
 *   "on" + the registry cannot be loaded  -> 503 REGISTRY_UNAVAILABLE (fails CLOSED, after the 24 h stale copy is used up)
 * Every request judges only its own body, so a stale "it was fine a minute ago" can never let a change through.
 * `checkProfile` is pure and tested without a database; `complianceGate` wires it to the real registry. Responses carry only the
 * matched text the caller sent, never anything else from the registry.
 */
import { findViolations, toDto, COMPLIANCE_MESSAGE, type Violation, type ViolationDto } from "./check";
import type { Matcher } from "./match";
import { RegistryUnavailableError } from "./registryCache";
import type { ResumeData } from "../schemas";

export type ComplianceMode = "on" | "off";

export const complianceMode = (env: Record<string, string | undefined> = process.env): ComplianceMode =>
  env.COMPLIANCE_ENFORCE?.trim().toLowerCase() === "on" ? "on" : "off";

export type CheckOutcome =
  | { enforced: false; violations: [] }
  | { enforced: true; violations: Violation[] };

/** Pure: the decision, given the mode and a way to get the matcher. Throws RegistryUnavailableError when it cannot be loaded. */
export async function checkProfile(data: unknown, deps: { mode: ComplianceMode; getMatcher: () => Promise<Matcher> }): Promise<CheckOutcome> {
  if (deps.mode !== "on") return { enforced: false, violations: [] };
  const matcher = await deps.getMatcher();
  return { enforced: true, violations: findViolations(matcher, data as ResumeData) };
}

export const complianceBody = (violations: readonly Violation[]): { error: { code: "COMPLIANCE"; message: string; matches: ViolationDto[] } } => ({
  error: { code: "COMPLIANCE", message: COMPLIANCE_MESSAGE, matches: violations.map(toDto) },
});

const UNAVAILABLE = {
  error: { code: "REGISTRY_UNAVAILABLE", message: "The client-name check is not available right now, so this cannot be completed. Please try again shortly or contact support." },
};

/** The response a route must send, or null to continue. Pure given `deps`. */
export async function gateResponse(data: unknown, deps: { mode: ComplianceMode; getMatcher: () => Promise<Matcher> }): Promise<Response | null> {
  try {
    const out = await checkProfile(data, deps);
    if (out.enforced && out.violations.length > 0) return Response.json(complianceBody(out.violations), { status: 422 });
    return null;
  } catch (e) {
    if (e instanceof RegistryUnavailableError) {
      console.error("[compliance] registry unavailable: refusing (fail closed)"); // never the profile or any name
      return Response.json(UNAVAILABLE, { status: 503 });
    }
    throw e;
  }
}
