/**
 * Purpose: tests the REAL wiring of POST /api/profiles (app/api/profiles/route.ts) with no network and no database. Only the
 * outside world is stubbed, by intercepting module loading: the signed-in user (lib/auth), the user-session Supabase client that
 * receives the audit insert (lib/supabase/server), the database save (lib/db/profiles) and the registry's source of names
 * (lib/sync/adminClient). Everything between them is the real code: the route, the handler, the gate, the registry cache, the
 * metadata clean-up, the consent row builder and the rate limit. Fictional names only.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const M = Module as unknown as { _load: Loader; _resolveFilename: (r: string, p: unknown) => string };

// ---- the stubbed outside world -------------------------------------------------------------------------------------
const state = {
  user: { id: "u-1" } as { id: string } | null,
  names: [{ id: "n1", name: "Example Client One", types: ["client"] }] as { id: string; name: string; types: string[] }[] | "down",
  auditInserts: [] as Record<string, unknown>[],
  auditError: null as Error | null,
  saves: [] as Record<string, unknown>[],
  events: [] as string[],
  saveThrows: null as Error | null,
};
class ExternalNotSavedError extends Error {}
class ProfileNotFoundError extends Error {}

const STUBS: Record<string, unknown> = {
  "lib/auth.ts": { getCurrentUser: async () => state.user },
  "lib/supabase/server.ts": {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          state.events.push(`insert:${table}`);
          if (state.auditError) return { error: state.auditError };
          state.auditInserts.push(row);
          return { error: null };
        },
      }),
    }),
  },
  "lib/db/profiles.ts": {
    ExternalNotSavedError,
    ProfileNotFoundError,
    saveVersion: async (p: Record<string, unknown>) => {
      state.events.push("save");
      if (state.saveThrows) throw state.saveThrows;
      state.saves.push(p);
      return { profileId: "p1", versionId: "v1", versionNo: 1, isPrimary: false };
    },
  },
  "lib/sync/adminClient.ts": {
    createRegistrySource: () => ({
      fetchNames: async () => {
        state.events.push("registry");
        if (state.names === "down") throw new Error("down");
        return state.names;
      },
    }),
  },
};

const original = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.startsWith("@/lib/") || request.startsWith("./") || request.startsWith("../")) {
    try {
      const file = M._resolveFilename(request, parent).split(path.sep).join("/");
      for (const [suffix, stub] of Object.entries(STUBS)) if (file.endsWith(`/${suffix}`)) return stub;
    } catch {
      /* not resolvable here: let the real loader report it */
    }
  }
  return original.call(this, request, parent, isMain);
};
after(() => {
  M._load = original;
});

// ---- helpers -------------------------------------------------------------------------------------------------------
const route = import("../app/api/profiles/route");
const registry = import("./compliance/registry");
let userCounter = 0;

const overview = (text: string) => ({
  name: "",
  jobTitle: "",
  experienceSummary: "",
  specialization: "",
  overview: text,
  education: [],
  projects: [],
  skills: [],
  certifications: [],
  tools: [],
  managerialExperience: [],
  domains: [],
  languages: [],
});
const post = async (extra: Record<string, unknown> = {}, text = "Built a claims platform.") =>
  (await route).POST(
    new Request("http://localhost:3000/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: "internal", kind: "base", source: "scratch", data: overview(text), ...extra }),
    }),
  );
const submit = { submit: true, consent: { accepted: true } };

beforeEach(async () => {
  process.env.COMPLIANCE_ENFORCE = "on";
  state.user = { id: `u-${++userCounter}` }; // a fresh user each test: the real rate limit is per user
  state.names = [{ id: "n1", name: "Example Client One", types: ["client"] }];
  state.auditInserts = [];
  state.auditError = null;
  state.saves = [];
  state.events = [];
  state.saveThrows = null;
  (await registry).resetRegistryCache();
});
after(() => {
  delete process.env.COMPLIANCE_ENFORCE;
});

// ---- tests ---------------------------------------------------------------------------------------------------------
test("signed out: 401, and neither the registry, the audit log nor the database is touched", async () => {
  state.user = null;
  const res = await post(submit);
  assert.equal(res.status, 401);
  assert.deepEqual(state.events, []);
});

test("Submit naming a registered client: 422 with the position, no consent row, nothing saved", async () => {
  const res = await post(submit, "Delivered for Example Client One.");
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { code: string; matches: { path: string; matchedText: string }[] } };
  assert.equal(body.error.code, "COMPLIANCE");
  assert.equal(body.error.matches[0].path, "overview");
  assert.equal(body.error.matches[0].matchedText, "Example Client One");
  assert.deepEqual(state.auditInserts, []);
  assert.deepEqual(state.saves, []);
  assert.ok(!state.events.includes("insert:audit_log") && !state.events.includes("save"));
});

test("Submit while the registry cannot be loaded: 503 (fails closed), no consent row, nothing saved", async () => {
  state.names = "down";
  const res = await post(submit);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "REGISTRY_UNAVAILABLE");
  assert.deepEqual(state.auditInserts, []);
  assert.deepEqual(state.saves, []);
});

test("Submit without the consent tick: 400, the registry is not even read, nothing recorded or saved", async () => {
  const res = await post({ submit: true });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CONSENT_REQUIRED");
  assert.deepEqual(state.events, []);
});

test("an audit-log failure on the consent row: 500 and the profile is not saved", async () => {
  state.auditError = new Error("rls");
  const res = await post(submit);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CONSENT_FAILED");
  assert.deepEqual(state.saves, []);
});

test("a clean Submit: registry read, consent row for the signed-in user, then the save, in that order", async () => {
  const userId = state.user!.id;
  const res = await post(submit);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { profileId: string }).profileId, "p1");
  assert.deepEqual(state.events, ["registry", "insert:audit_log", "save"]);
  assert.equal(state.auditInserts.length, 1);
  const row = state.auditInserts[0];
  assert.equal(row.actor_id, userId);
  assert.equal(row.action, "consent_submit");
  assert.equal(row.entity, "profile_preview");
  assert.deepEqual(row.detail, { template: "internal", consentVersion: "1" });
  assert.equal(state.saves.length, 1);
});

test("the consent row never contains profile content", async () => {
  await post(submit, "Private text that must not be copied.");
  assert.ok(!JSON.stringify(state.auditInserts).includes("Private text"));
});

test("a plain save: gated, no consent row", async () => {
  assert.equal((await post()).status, 200);
  assert.deepEqual(state.auditInserts, []);
  assert.equal(state.saves.length, 1);
  assert.equal((await post({}, "Example Client One")).status, 422);
  assert.equal(state.saves.length, 1);
});

test("enforcement off (the default): nothing is checked, the registry is never read, consent is still recorded on Submit", async () => {
  delete process.env.COMPLIANCE_ENFORCE;
  const res = await post(submit, "Delivered for Example Client One.");
  assert.equal(res.status, 200);
  assert.ok(!state.events.includes("registry"));
  assert.equal(state.auditInserts.length, 1);
});

test("stored metadata is cleaned by the real clean-up before the save", async () => {
  const res = await post({
    ...submit,
    label: "Example Client One v2",
    reviewFlags: [{ path: "overview", reason: "Seen at Example Client One" }, { path: "tools.0", reason: "Not stated" }],
    promptPlan: ["base", "Example Client One module"],
  });
  assert.equal(res.status, 200);
  const saved = state.saves[0] as { label: string; reviewFlags: { path: string; reason: string }[]; promptPlan: string[] };
  assert.ok(!JSON.stringify(saved).includes("Example Client One"));
  assert.equal(saved.label, "");
  assert.deepEqual(saved.reviewFlags[1], { path: "tools.0", reason: "Not stated" });
  assert.deepEqual(saved.promptPlan, ["base"]);
});

test("the save errors are mapped by the real route: external -> 400, not found -> 404, anything else -> generic 500", async () => {
  state.saveThrows = new ExternalNotSavedError();
  assert.equal((await post(submit)).status, 400);
  state.saveThrows = new ProfileNotFoundError();
  assert.equal((await post(submit)).status, 404);
  state.saveThrows = new Error("internal detail");
  const res = await post(submit);
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(await res.json()).includes("internal detail"));
});

test("an external profile is refused before anything else", async () => {
  const res = await post({ template: "external", ...submit });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "EXTERNAL_NOT_SAVED");
  assert.deepEqual(state.events, []);
});

test("the real rate limit applies per user (61st save in the window is refused)", async () => {
  let last = 200;
  for (let i = 0; i < 61; i++) last = (await post()).status;
  assert.equal(last, 429);
});
