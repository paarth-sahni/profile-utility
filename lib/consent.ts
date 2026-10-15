/**
 * Purpose: the consent a person gives on the Preview step before a profile is submitted, downloaded or opened in
 * Google Docs. Holds the exact wording (shown next to the checkbox and versioned, so the audit trail says which
 * wording was accepted) and the validation of the request that records it (POST /api/consent).
 * Pure (no server or browser imports), unit-tested in lib/consent.test.ts.
 */
import { z } from "zod";

/** The wording next to the checkbox. Change it only together with CONSENT_VERSION. */
export const CONSENT_TEXT = "I confirm the information in this profile is accurate and may be shared";

/** Bump when CONSENT_TEXT changes; stored with every consent row. */
export const CONSENT_VERSION = "1";

/** What the person was about to do when they gave consent. */
export const CONSENT_ACTIONS = ["submit", "download", "google_docs"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** Body of POST /api/consent. `accepted` must be the literal true: a consent request without it is refused. */
export const consentRequestSchema = z.object({
  template: z.enum(["internal", "external"]),
  action: z.enum(CONSENT_ACTIONS),
  accepted: z.literal(true),
});
export type ConsentRequest = z.infer<typeof consentRequestSchema>;

/** Parses an untrusted consent request; null when anything is off (no details leaked). */
export function parseConsentRequest(body: unknown): ConsentRequest | null {
  const r = consentRequestSchema.safeParse(body);
  return r.success ? r.data : null;
}

/** The audit_log row for a consent: metadata only, never profile content. */
export function consentAuditRow(userId: string, req: ConsentRequest) {
  return {
    actor_id: userId,
    action: `consent_${req.action}`,
    entity: "profile_preview",
    entity_id: null,
    detail: { template: req.template, consentVersion: CONSENT_VERSION },
  };
}
