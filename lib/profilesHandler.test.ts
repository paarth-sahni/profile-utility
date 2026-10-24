import assert from "node:assert/strict";
import { test } from "node:test";
import { gateResponse } from "./compliance/gate";
import { buildMatcher } from "./compliance/match";
import { RegistryUnavailableError } from "./compliance/registryCache";
import { redactMetadata } from "./compliance/redact";
import { handleProfilesPost, type ProfilesDeps } from "./profilesHandler";
import { blankResume, type InternalResume } from "./schemas";

// Fictional names only. These tests drive the real request handler of POST /api/profiles (parsing, ordering, answers) with
// fakes for the session, the registry, the audit insert and the database.
const matcher = buildMatcher([{ id: "n1", name: "Example Client One", types: ["client"] }]);

const profile = (overview = "Built a claims platform."): InternalResume => ({ ...(blankResume("internal") as InternalResume), overview });
const request = (extra: Record<string, unknown> = {}, data: unknown = profile()) =>
  new Request("http://localhost:3000/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: "internal", kind: "base", source: "scratch", data, ...extra }),
  });
const submit = { submit: true, consent: { accepted: true } };

function setup(over: Partial<ProfilesDeps<{ profileId: string }>> = {}, mode: "on" | "off" = "on") {
  const calls: string[] = [];
  const saved: unknown[] = [];
  const deps: ProfilesDeps<{ profileId: string }> = {
    getUserId: async () => "user-1",
    allow: () => true,
    gate: async (data) => {
      calls.push("gate");
      return gateResponse(data, { mode, getMatcher: async () => matcher });
    },
    sanitize: async (p) => {
      calls.push("sanitize");
      const { value } = redactMetadata(matcher, { reviewFlags: p.reviewFlags, analysis: p.analysis, promptPlan: p.promptPlan, label: p.label });
      return { ...p, ...value, label: value.label ?? p.label } as typeof p;
    },
    recordConsent: async (userId) => void calls.push(`consent:${userId}`),
    save: async (p) => {
      calls.push("save");
      saved.push(p);
      return { profileId: "p1" };
    },
    saveError: () => null,
    ...over,
  };
  return { deps, calls, saved };
}

test("not signed in: 401 and nothing runs", async () => {
  const { deps, calls } = setup({ getUserId: async () => null });
  const res = await handleProfilesPost(request(submit), deps);
  assert.equal(res.status, 401);
  assert.deepEqual(calls, []);
});

test("Submit with a registered name: 422, no consent record, nothing saved", async () => {
  const { deps, calls, saved } = setup();
  const res = await handleProfilesPost(request(submit, profile("Delivered for Example Client One.")), deps);
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "COMPLIANCE");
  assert.deepEqual(calls, ["gate"]);
  assert.equal(saved.length, 0);
});

test("Submit while the registry is unavailable: 503, no consent record, nothing saved", async () => {
  const { deps, calls, saved } = setup({
    gate: async (data) => {
      calls.push("gate");
      return gateResponse(data, { mode: "on", getMatcher: async () => { throw new RegistryUnavailableError(); } });
    },
  });
  const res = await handleProfilesPost(request(submit), deps);
  assert.equal(res.status, 503);
  assert.deepEqual(calls, ["gate"]);
  assert.equal(saved.length, 0);
});

test("Submit without the consent tick: 400, nothing runs", async () => {
  const { deps, calls } = setup();
  const res = await handleProfilesPost(request({ submit: true }), deps);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CONSENT_REQUIRED");
  assert.deepEqual(calls, []);
});

test("consent that cannot be recorded: 500 and the profile is not saved", async () => {
  const { deps, calls, saved } = setup({ recordConsent: async () => { throw new Error("db down"); } });
  const res = await handleProfilesPost(request(submit), deps);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CONSENT_FAILED");
  assert.ok(!calls.includes("save"));
  assert.equal(saved.length, 0);
});

test("a clean Submit: gate, sanitize, consent (for the signed-in user), save, in that order", async () => {
  const { deps, calls } = setup();
  const res = await handleProfilesPost(request(submit), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { profileId: "p1" });
  assert.deepEqual(calls, ["gate", "sanitize", "consent:user-1", "save"]);
});

test("a plain save (no Submit) saves without any consent record, and is still gated", async () => {
  const ok = setup();
  assert.equal((await handleProfilesPost(request(), ok.deps)).status, 200);
  assert.deepEqual(ok.calls, ["gate", "sanitize", "save"]);
  const blocked = setup();
  assert.equal((await handleProfilesPost(request({}, profile("Example Client One")), blocked.deps)).status, 422);
  assert.deepEqual(blocked.calls, ["gate"]);
});

test("enforcement off: a Submit naming a registered client is not refused (dormant) and consent is recorded", async () => {
  const { deps, calls } = setup({}, "off");
  const res = await handleProfilesPost(request(submit, profile("Example Client One")), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["gate", "sanitize", "consent:user-1", "save"]);
});

test("external profiles are refused before anything else, even with a consent tick", async () => {
  const { deps, calls } = setup();
  const res = await handleProfilesPost(request({ template: "external", ...submit }), deps);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "EXTERNAL_NOT_SAVED");
  assert.deepEqual(calls, []);
});

test("a malformed body and a rate-limited caller are refused before any check", async () => {
  const a = setup();
  assert.equal((await handleProfilesPost(new Request("http://localhost/api/profiles", { method: "POST", body: "not json" }), a.deps)).status, 400);
  const b = setup({ allow: () => false });
  assert.equal((await handleProfilesPost(request(submit), b.deps)).status, 429);
  assert.deepEqual([...a.calls, ...b.calls], []);
});

test("a save failure maps through saveError (e.g. not found) and an unexpected one is a generic 500", async () => {
  const notFound = setup({ save: async () => { throw new Error("x"); }, saveError: () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }) });
  assert.equal((await handleProfilesPost(request(submit), notFound.deps)).status, 404);
  const generic = setup({ save: async () => { throw new Error("secret detail"); } });
  const res = await handleProfilesPost(request(submit), generic.deps);
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(await res.json()).includes("secret detail"));
});

test("stored metadata is cleaned before saving, and unrelated flags, notes, label and plan entries survive", async () => {
  const { deps, saved } = setup();
  const res = await handleProfilesPost(
    request({
      ...submit,
      label: "Example Client One v2",
      reviewFlags: [
        { path: "overview", reason: "Inferred near Example Client One" },
        { path: "tools.0", reason: "Not stated in the resume" },
      ],
      analysis: {
        documentType: "standard_resume",
        seniority: "mid",
        roleFamily: "backend",
        projectsLayout: "none",
        presentSections: ["summary"],
        density: "normal",
        hasMetrics: true,
        earliestProfessionalStart: "Jan 2015",
        notes: ["Example Client One header", "Two-column layout"],
      },
      promptPlan: ["base", "Example Client One module", "backend"],
    }),
    deps,
  );
  assert.equal(res.status, 200);
  const p = saved[0] as { label: string; reviewFlags: { path: string; reason: string }[]; analysis: { notes: string[]; seniority: string; hasMetrics: boolean; earliestProfessionalStart: string }; promptPlan: string[] };
  assert.equal(p.label, "");
  assert.ok(!JSON.stringify(p).includes("Example Client One"));
  assert.deepEqual(p.reviewFlags[1], { path: "tools.0", reason: "Not stated in the resume" });
  assert.equal(p.reviewFlags[0].path, "overview");
  assert.equal(p.analysis.notes[1], "Two-column layout");
  assert.equal(p.analysis.seniority, "mid");
  assert.equal(p.analysis.hasMetrics, true);
  assert.equal(p.analysis.earliestProfessionalStart, "Jan 2015");
  assert.deepEqual(p.promptPlan, ["base", "backend"]);
});

test("unknown extra fields are not kept or scanned: they never reach the save", async () => {
  const { deps, saved } = setup();
  await handleProfilesPost(request({ ...submit, secretNote: "Example Client One" }), deps);
  assert.ok(!("secretNote" in (saved[0] as object)));
});
