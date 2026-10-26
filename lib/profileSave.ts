/**
 * Purpose: the order of events when a profile is saved (POST /api/profiles), kept in one pure function so it can be tested
 * with fakes and so the order cannot drift:
 *   1. the client-name gate (422 / 503 end the request here)
 *   2. registered names are removed from the stored extraction metadata (never blocks, see compliance/redact.ts)
 *   3. for Submit: the consent record is written (if that fails nothing is saved)
 *   4. the version is saved
 * A refused request therefore never leaves a consent record behind. The only way to have a consent row without a saved
 * version is a database failure in step 4, which was a real attempt to submit.
 */
import type { SavePayload } from "./profilePayload";

export type SaveDeps<R> = {
  /** The gate: a response to send (422 / 503), or null to carry on. */
  gate: (data: unknown) => Promise<Response | null>;
  /** The payload with registered names removed from its metadata. */
  sanitize: (p: SavePayload) => Promise<SavePayload>;
  /** Writes the Submit consent; throws on failure. */
  recordConsent: () => Promise<void>;
  save: (p: SavePayload) => Promise<R>;
};

export type SaveOutcome<R> = { kind: "response"; response: Response } | { kind: "saved"; result: R };

const error = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export async function processSave<R>(payload: SavePayload, deps: SaveDeps<R>): Promise<SaveOutcome<R>> {
  if (payload.submit && !payload.consent) {
    return { kind: "response", response: error(400, "CONSENT_REQUIRED", "Please confirm the statement to submit.") };
  }
  const blocked = await deps.gate(payload.data);
  if (blocked) return { kind: "response", response: blocked };
  const clean = await deps.sanitize(payload);
  if (payload.submit) {
    try {
      await deps.recordConsent();
    } catch {
      console.error("[profiles] could not record consent");
      return { kind: "response", response: error(500, "CONSENT_FAILED", "We could not record your confirmation. Please try again.") };
    }
  }
  return { kind: "saved", result: await deps.save(clean) };
}
