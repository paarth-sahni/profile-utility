/**
 * Purpose: wires the compliance gate to the real registry. Server-only. The list is read through the service-role
 * client in lib/sync/adminClient.ts (the only code that holds that key) and cached in memory (see registryCache.ts).
 * Routes use `complianceGate(data)`.
 */
import "server-only";
import { createRegistrySource } from "@/lib/sync/adminClient";
import { complianceMode, gateResponse } from "./gate";
import { createRegistryCache } from "./registryCache";
import type { Matcher } from "./match";
import { redactMetadata } from "./redact";
import type { SavePayload } from "../profilePayload";

let cache: ReturnType<typeof createRegistryCache> | null = null;

/** The cached matcher for the registry (throws RegistryUnavailableError when it cannot be loaded). */
export function getRegistryMatcher(): Promise<Matcher> {
  // created on first use, only when enforcement is on, so a dormant deployment never needs the service key
  cache ??= createRegistryCache({ load: () => createRegistrySource().fetchNames() });
  return cache.get().then((h) => h.matcher);
}

/** The response to send when the profile must be refused (422 / 503), or null to carry on. */
export const complianceGate = (data: unknown): Promise<Response | null> => gateResponse(data, { mode: complianceMode(), getMatcher: getRegistryMatcher });

/** Removes registered names from the free-text metadata stored with a version (no-op while enforcement is off). */
export async function sanitizeSaveMetadata(p: SavePayload): Promise<SavePayload> {
  if (complianceMode() !== "on") return p;
  const { value } = redactMetadata(await getRegistryMatcher(), { reviewFlags: p.reviewFlags, analysis: p.analysis, promptPlan: p.promptPlan, label: p.label });
  return { ...p, reviewFlags: value.reviewFlags, analysis: value.analysis, promptPlan: value.promptPlan, label: value.label ?? p.label };
}

/** Drops the cached list (used by the manual sync so a fresh sync takes effect at once). */
export const resetRegistryCache = (): void => cache?.reset();
