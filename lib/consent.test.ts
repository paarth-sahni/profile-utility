/** Purpose: unit tests for the consent request validation and the audit row it produces (lib/consent.ts). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONSENT_TEXT, CONSENT_VERSION, consentAuditRow, parseConsentRequest } from "./consent";

test("the consent wording is the agreed sentence", () => {
  assert.equal(CONSENT_TEXT, "I confirm the information in this profile is accurate and may be shared");
});

test("a valid request is accepted for every action and both templates", () => {
  for (const action of ["submit", "download", "google_docs"]) {
    for (const template of ["internal", "external"]) {
      assert.deepEqual(parseConsentRequest({ template, action, accepted: true }), { template, action, accepted: true });
    }
  }
});

test("a request without accepted:true is refused (false, missing, or a truthy string)", () => {
  assert.equal(parseConsentRequest({ template: "internal", action: "submit", accepted: false }), null);
  assert.equal(parseConsentRequest({ template: "internal", action: "submit" }), null);
  assert.equal(parseConsentRequest({ template: "internal", action: "submit", accepted: "true" }), null);
});

test("unknown actions, templates and non-objects are refused", () => {
  assert.equal(parseConsentRequest({ template: "internal", action: "delete", accepted: true }), null);
  assert.equal(parseConsentRequest({ template: "other", action: "submit", accepted: true }), null);
  assert.equal(parseConsentRequest(null), null);
  assert.equal(parseConsentRequest("yes"), null);
});

test("extra fields never reach the audit row (no profile content can be smuggled in)", () => {
  const req = parseConsentRequest({ template: "external", action: "download", accepted: true, data: { name: "Secret" } });
  assert.ok(req);
  const row = consentAuditRow("11111111-1111-1111-1111-111111111111", req);
  assert.deepEqual(row, {
    actor_id: "11111111-1111-1111-1111-111111111111",
    action: "consent_download",
    entity: "profile_preview",
    entity_id: null,
    detail: { template: "external", consentVersion: CONSENT_VERSION },
  });
  assert.ok(!JSON.stringify(row).includes("Secret"));
});
