import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ComplianceResult } from "./complianceClient";
import { resubmitSaved } from "./resubmit";

function run(result: ComplianceResult, over: { consent?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const p = resubmitSaved({
    check: async () => (calls.push("check"), result),
    recordConsent: over.consent ?? (async () => void calls.push("consent")),
    markPrimary: async () => void calls.push("primary"),
  });
  return { p, calls };
}

test("re-submit of an unchanged saved version: check, then consent, then primary", async () => {
  const { p, calls } = run({ status: "ok", enforced: true, matches: [] });
  assert.deepEqual(await p, { kind: "done" });
  assert.deepEqual(calls, ["check", "consent", "primary"]);
});

test("re-submit while enforcement is dormant proceeds", async () => {
  const { p } = run({ status: "ok", enforced: false, matches: [] });
  assert.deepEqual(await p, { kind: "done" });
});

test("re-submit when the registry has since gained a name in the saved text: blocked, no consent, no primary", async () => {
  const { p, calls } = run({ status: "ok", enforced: true, matches: [{ path: "overview", start: 0, end: 3, matchedText: "abc" }] });
  const out = await p;
  assert.equal(out.kind, "blocked");
  assert.deepEqual(calls, ["check"]);
});

test("re-submit fails closed when the check is unavailable, failed or the session ended", async () => {
  for (const status of ["unavailable", "failed"] as const) {
    const { p, calls } = run({ status });
    assert.deepEqual(await p, { kind: "unavailable" });
    assert.deepEqual(calls, ["check"]);
  }
  const ended = run({ status: "unauthenticated" });
  assert.deepEqual(await ended.p, { kind: "ended" });
  assert.deepEqual(ended.calls, ["check"]);
});

test("a consent failure stops before primary", async () => {
  const calls: string[] = [];
  await assert.rejects(
    resubmitSaved({
      check: async () => ({ status: "ok", enforced: true, matches: [] }),
      recordConsent: async () => { throw new Error("db"); },
      markPrimary: async () => void calls.push("primary"),
    }),
  );
  assert.deepEqual(calls, []);
});

test("the re-submit path sends no profile content and creates no version (source check)", () => {
  const src = readFileSync(new URL("../components/ProfileWorkflow.tsx", import.meta.url), "utf8");
  const start = src.indexOf("const submitProfile = async");
  const reuse = src.slice(start, src.indexOf("const result = await persist", start));
  assert.match(reuse, /resubmitSaved/);
  assert.ok(!/persist\(/.test(reuse), "the unchanged path must not save");
  assert.ok(!/\/api\/profiles`,\s*\{[^}]*body/.test(reuse), "and must not post profile content");
});

// ProfileWorkflow is a React component and this repo has no DOM test tooling, so its wiring of resubmitSaved is pinned by reading the source.
test("ProfileWorkflow: consent and 'make primary' only run inside resubmitSaved, and every refusal throws before the success return", () => {
  const src = readFileSync(new URL("../components/ProfileWorkflow.tsx", import.meta.url), "utf8");
  const start = src.indexOf("const submitProfile = async");
  const block = src.slice(start, src.indexOf("const result = await persist", start));
  const call = block.indexOf("await resubmitSaved(");
  assert.ok(call > 0);
  const callEnd = block.indexOf("if (outcome.kind", call);
  assert.ok(callEnd > call);
  // nothing that records consent or marks primary happens outside the helper's callbacks
  const outside = block.slice(0, call) + block.slice(callEnd);
  assert.ok(!/recordConsent\(/.test(outside) && !/\/primary/.test(outside) && !/setPrimaryId/.test(outside), "consent / primary only via resubmitSaved");
  // the helper's order is check first: the check callback is the first one passed
  assert.ok(block.indexOf("check:", call) < block.indexOf("recordConsent:", call) && block.indexOf("recordConsent:", call) < block.indexOf("markPrimary:", call));
  // each non-success outcome throws, and all of that comes before the success return
  const success = block.indexOf("return { profileId: savedProfileId");
  for (const kind of ["ended", "unavailable", "blocked"]) {
    const at = block.indexOf(`outcome.kind === "${kind}"`);
    assert.ok(at > callEnd && at < success, `${kind} handled before the success return`);
    assert.match(block.slice(at, success), /throw new Error/, `${kind} ends in a throw`);
  }
  // a blocked outcome returns the person to editing with the places marked
  assert.match(block.slice(block.indexOf('outcome.kind === "blocked"'), success), /showComplianceMatches\(/);
});
