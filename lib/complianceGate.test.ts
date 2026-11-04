import assert from "node:assert/strict";
import { test } from "node:test";
import { checkProfile, complianceBody, complianceMode, gateResponse } from "./compliance/gate";
import { buildMatcher, type RegistryName } from "./compliance/match";
import { createRegistryCache, RegistryUnavailableError } from "./compliance/registryCache";
import { blankResume, type ExternalResume, type InternalResume } from "./schemas";

// Fictional names only.
const NAMES: RegistryName[] = [
  { id: "n1", name: "Example Client One", types: ["client", "friendly"] },
  { id: "n2", name: "Example Client One Private Limited", types: ["legal"] },
  { id: "n3", name: "Example Group", types: ["group"] },
  { id: "n4", name: "Project Aurora", types: ["project"] },
];
const matcher = buildMatcher(NAMES);
const getMatcher = async () => matcher;

const internal = (): InternalResume => ({ ...(blankResume("internal") as InternalResume) });
const external = (): ExternalResume => ({ ...(blankResume("external") as ExternalResume) });

test("mode: only COMPLIANCE_ENFORCE=on enforces; unset or anything else is dormant", () => {
  assert.equal(complianceMode({}), "off");
  assert.equal(complianceMode({ COMPLIANCE_ENFORCE: "" }), "off");
  assert.equal(complianceMode({ COMPLIANCE_ENFORCE: "off" }), "off");
  assert.equal(complianceMode({ COMPLIANCE_ENFORCE: "true" }), "off");
  assert.equal(complianceMode({ COMPLIANCE_ENFORCE: "on" }), "on");
  assert.equal(complianceMode({ COMPLIANCE_ENFORCE: " ON " }), "on");
});

test("dormant: nothing is checked and the registry is never even loaded", async () => {
  const d = internal();
  d.overview = "Built for Example Client One.";
  let loaded = 0;
  const out = await checkProfile("internal", d, { mode: "off", getMatcher: async () => { loaded++; return matcher; } });
  assert.deepEqual(out, { enforced: false, violations: [] });
  assert.equal(loaded, 0);
  assert.equal(await gateResponse("internal", d, { mode: "off", getMatcher: async () => { throw new RegistryUnavailableError(); } }), null);
});

test("enforcing: an internal profile naming a client is refused with 422 and exact positions", async () => {
  const d = internal();
  d.overview = "Delivered claims automation for Example Client One, cutting manual review.";
  const res = await gateResponse("internal", d, { mode: "on", getMatcher });
  assert.ok(res);
  assert.equal(res.status, 422);
  const body = (await res.json()) as { error: { code: string; message: string; matches: Record<string, unknown>[] } };
  assert.equal(body.error.code, "COMPLIANCE");
  assert.equal(body.error.matches.length, 1);
  const m = body.error.matches[0];
  assert.equal(m.path, "overview");
  assert.equal(m.matchedText, "Example Client One");
  assert.equal(d.overview.slice(m.start as number, m.end as number), "Example Client One");
  assert.deepEqual(m.types, ["client", "friendly"]);
});

test("internal only (Paarth/HR, 4 Nov 2026): the same registered name blocks an internal profile, not an external one", async () => {
  const name = "Example Client One Private Limited";
  const i = internal();
  i.projects = [{ ...i.projects[0], title: name, description: "ok" }];
  const blocked = await gateResponse("internal", i, { mode: "on", getMatcher });
  assert.equal(blocked?.status, 422);
  const e = external();
  e.projects = [{ ...e.projects[0], client: name, description: "ok" }];
  e.experience = [{ ...e.experience[0], company: "Example Group", highlights: ["fine"] }];
  let loaded = 0;
  const deps = { mode: "on" as const, getMatcher: async () => (loaded++, matcher) };
  assert.equal(await gateResponse("external", e, deps), null);
  assert.deepEqual(await checkProfile("external", e, deps), { enforced: false, violations: [] }); // the live check: no marks
  assert.equal(loaded, 0, "the registry is not even loaded for an external profile");
  // and an unavailable registry does not block an external profile either (it is not checked at all)
  assert.equal(await gateResponse("external", e, { mode: "on", getMatcher: async () => { throw new RegistryUnavailableError(); } }), null);
});

test("enforcing: a project name is caught on its own, and several fields are all reported", async () => {
  const d = internal();
  d.projects = [{ ...d.projects[0], title: "Project Aurora", responsibilities: ["Fine", "Worked with Example Group"] }];
  const out = await checkProfile("internal", d, { mode: "on", getMatcher });
  assert.deepEqual(out.violations.map((v) => v.path).sort(), ["projects.0.responsibilities.1", "projects.0.title"]);
});

test("enforcing: a clean profile passes (null = carry on)", async () => {
  const d = internal();
  d.overview = "AI-assisted workflow automation for insurance claims.";
  d.specialization = "N/A";
  assert.equal(await gateResponse("internal", d, { mode: "on", getMatcher }), null);
});

test("enforcing: every request is judged on its own body (changed after an earlier check, or reintroduced elsewhere)", async () => {
  const d = internal();
  d.overview = "For Example Client One";
  assert.ok(await gateResponse("internal", d, { mode: "on", getMatcher }));
  d.overview = "For a large insurer";
  assert.equal(await gateResponse("internal", d, { mode: "on", getMatcher }), null);
  d.jobTitle = "Lead, Example Group account";
  assert.ok(await gateResponse("internal", d, { mode: "on", getMatcher }));
});

test("enforcing: the answer holds only the text the caller typed, never registry data", async () => {
  const d = internal();
  d.overview = "For example client one limited of nothing";
  const res = await gateResponse("internal", d, { mode: "on", getMatcher });
  assert.ok(res);
  const text = JSON.stringify(await res.json());
  for (const forbidden of ["n1", "n2", "nameId", "Private Limited", "Example Group", "Project Aurora"]) assert.ok(!text.includes(forbidden), forbidden);
  assert.deepEqual(Object.keys(complianceBody([]).error).sort(), ["code", "matches", "message"]);
});

test("fail closed: with enforcement on and no registry the request is refused with 503", async () => {
  const res = await gateResponse("internal", internal(), { mode: "on", getMatcher: async () => { throw new RegistryUnavailableError(); } });
  assert.ok(res);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "REGISTRY_UNAVAILABLE");
});

test("an unexpected error is not swallowed as a pass", async () => {
  await assert.rejects(gateResponse("internal", internal(), { mode: "on", getMatcher: async () => { throw new Error("boom"); } }), /boom/);
});

// ---- the cache ---------------------------------------------------------------------------------------------------------
const clock = (start = 1_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

test("cache: loads once within the window and shares one load between concurrent callers", async () => {
  const c = clock();
  let loads = 0;
  const cache = createRegistryCache({ load: async () => { loads++; return NAMES; }, now: c.now, ttlMs: 60_000 });
  await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.equal(loads, 1);
  c.advance(59_000);
  await cache.get();
  assert.equal(loads, 1);
  c.advance(2_000);
  await cache.get();
  assert.equal(loads, 2, "reloaded after the window");
});

test("cache: a failed reload keeps serving the last copy (marked stale) until the stale limit, then fails closed", async () => {
  const c = clock();
  let fail = false;
  const cache = createRegistryCache({
    load: async () => { if (fail) throw new Error("db down"); return NAMES; },
    now: c.now, ttlMs: 60_000, staleMs: 3_600_000,
  });
  assert.equal((await cache.get()).stale, false);
  fail = true;
  c.advance(120_000);
  const h = await cache.get();
  assert.equal(h.stale, true);
  assert.equal(h.matcher.scan("Example Client One").length, 1, "still enforcing from the last copy");
  c.advance(3_600_000);
  await assert.rejects(cache.get(), RegistryUnavailableError);
  fail = false;
  assert.equal((await cache.get()).stale, false, "recovers when the registry is back");
});

test("cache: nothing ever loaded and the load fails -> unavailable; reset forgets the copy", async () => {
  const c = clock();
  const cache = createRegistryCache({ load: async () => { throw new Error("no key"); }, now: c.now });
  await assert.rejects(cache.get(), RegistryUnavailableError);
  let ok = true;
  const cache2 = createRegistryCache({ load: async () => { if (!ok) throw new Error("x"); return NAMES; }, now: c.now });
  await cache2.get();
  cache2.reset();
  ok = false;
  await assert.rejects(cache2.get(), RegistryUnavailableError);
});

test("cache: an empty registry is a valid registry (nothing to enforce yet) and enforces nothing", async () => {
  const cache = createRegistryCache({ load: async () => [] });
  const h = await cache.get();
  assert.equal(h.matcher.size, 0);
  assert.deepEqual(h.matcher.scan("Example Client One"), []);
});
