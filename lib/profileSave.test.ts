import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildMatcher } from "./compliance/match";
import { REDACTED_TEXT, redactMetadata } from "./compliance/redact";
import { parseSavePayload, type SavePayload } from "./profilePayload";
import { processSave, type SaveDeps } from "./profileSave";
import { blankResume } from "./schemas";

// Fictional names only.
const matcher = buildMatcher([{ id: "n1", name: "Example Client One", types: ["client"] }]);

const body = (extra: Record<string, unknown> = {}) => ({
  template: "internal",
  kind: "base",
  source: "scratch",
  data: blankResume("internal"),
  ...extra,
});
const payload = (extra: Record<string, unknown> = {}): SavePayload => {
  const p = parseSavePayload(body(extra));
  assert.ok(p, "payload should parse");
  return p;
};

function deps(over: Partial<SaveDeps<string>> = {}) {
  const calls: string[] = [];
  const d: SaveDeps<string> = {
    gate: async () => (calls.push("gate"), null),
    sanitize: async (p) => (calls.push("sanitize"), p),
    recordConsent: async () => void calls.push("consent"),
    save: async () => (calls.push("save"), "saved"),
    ...over,
  };
  return { d, calls };
}

test("Submit: order is gate, sanitize, consent, save", async () => {
  const { d, calls } = deps();
  const out = await processSave(payload({ submit: true, consent: { accepted: true } }), d);
  assert.equal(out.kind, "saved");
  assert.deepEqual(calls, ["gate", "sanitize", "consent", "save"]);
});

test("Submit refused by the gate (422): no consent record, nothing saved", async () => {
  const { d, calls } = deps({ gate: async () => Response.json({ error: { code: "COMPLIANCE" } }, { status: 422 }) });
  const out = await processSave(payload({ submit: true, consent: { accepted: true } }), d);
  assert.equal(out.kind === "response" && out.response.status, 422);
  assert.deepEqual(calls, []);
});

test("Submit while the registry is unavailable (503): no consent record, nothing saved", async () => {
  const { d, calls } = deps({ gate: async () => Response.json({ error: { code: "REGISTRY_UNAVAILABLE" } }, { status: 503 }) });
  const out = await processSave(payload({ submit: true, consent: { accepted: true } }), d);
  assert.equal(out.kind === "response" && out.response.status, 503);
  assert.deepEqual(calls, []);
});

test("Submit without the consent tick is refused 400 before anything runs", async () => {
  const { d, calls } = deps();
  const out = await processSave(payload({ submit: true }), d);
  assert.equal(out.kind === "response" && out.response.status, 400);
  assert.deepEqual(calls, []);
});

test("a consent record that cannot be written stops the save", async () => {
  const { d, calls } = deps({ recordConsent: async () => { throw new Error("db"); } });
  const out = await processSave(payload({ submit: true, consent: { accepted: true } }), d);
  assert.equal(out.kind === "response" && out.response.status, 500);
  assert.ok(!calls.includes("save"));
});

test("a plain save (not Submit) records no consent and still passes the gate", async () => {
  const { d, calls } = deps();
  const out = await processSave(payload(), d);
  assert.equal(out.kind, "saved");
  assert.deepEqual(calls, ["gate", "sanitize", "save"]);
});

test("consent must be the literal true", () => {
  assert.equal(parseSavePayload(body({ submit: true, consent: { accepted: false } })), null);
});

test("the stored copy is the sanitised one", async () => {
  let saved: SavePayload | null = null;
  const { d } = deps({
    sanitize: async (p) => ({ ...p, promptPlan: [] }),
    save: async (p) => { saved = p; return "ok"; },
  });
  await processSave(payload({ promptPlan: ["a"] }), d);
  assert.deepEqual((saved as SavePayload | null)?.promptPlan, []);
});

test("the Submit button does not record consent before the save request (source check)", () => {
  const src = readFileSync(new URL("../components/PreviewStep.tsx", import.meta.url), "utf8");
  const submitFn = src.slice(src.indexOf("const submit = async"), src.indexOf("const buttonBase"));
  assert.ok(!/record\("submit"\)/.test(submitFn), "Submit must not call /api/consent itself");
  assert.match(submitFn, /blocked/);
});

// ---- redaction of the stored metadata ----

const analysis = {
  documentType: "standard_resume",
  seniority: "mid",
  roleFamily: "other",
  projectsLayout: "none",
  presentSections: [],
  density: "normal",
  hasMetrics: false,
  earliestProfessionalStart: "Jan 2015",
  notes: ["Worked at Example Client One", "fine"],
};

test("redaction: flag reasons, flag paths, notes, earliest start and prompt plan are cleaned; the rest is untouched", () => {
  const input = {
    reviewFlags: [
      { path: "overview", reason: "Inferred from Example Client One header" },
      { path: "Example Client One", reason: "ok" },
      { path: "tools.0", reason: "not stated" },
    ],
    analysis: { ...analysis, earliestProfessionalStart: "since Example Client One" },
    promptPlan: ["base", "module for Example Client One"],
  };
  const { value, redacted } = redactMetadata(matcher, input as never);
  assert.equal(redacted, 5);
  assert.equal(value.reviewFlags[0].reason, REDACTED_TEXT);
  assert.equal(value.reviewFlags[0].path, "overview");
  assert.equal(value.reviewFlags[1].path, "");
  assert.deepEqual(value.reviewFlags[2], { path: "tools.0", reason: "not stated" });
  assert.deepEqual(value.analysis?.notes, [REDACTED_TEXT, "fine"]);
  assert.equal(value.analysis?.earliestProfessionalStart, "");
  assert.equal((value.analysis as typeof analysis).seniority, "mid");
  assert.deepEqual(value.promptPlan, ["base"]);
  assert.equal(input.reviewFlags[0].reason, "Inferred from Example Client One header", "input not mutated");
});

test("redaction: clean metadata is returned as is; an empty registry changes nothing", () => {
  const clean = { reviewFlags: [{ path: "overview", reason: "ok" }], analysis: { ...analysis, notes: ["fine"] }, promptPlan: ["base"] };
  const r = redactMetadata(matcher, clean as never);
  assert.equal(r.redacted, 0);
  assert.equal(r.value, clean as never);
  const dirty = { reviewFlags: [{ path: "", reason: "Example Client One" }], analysis: null, promptPlan: [] };
  assert.equal(redactMetadata(buildMatcher([]), dirty).redacted, 0);
});
