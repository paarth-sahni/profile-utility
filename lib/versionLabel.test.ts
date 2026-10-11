/** Purpose: unit tests for the version-label defaults and the role-specific naming rule. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LABEL_LENGTH, defaultLabel, resolveLabel } from "./versionLabel";

test("defaultLabel: Base before the first save, then the next version number", () => {
  assert.equal(defaultLabel({ lastSavedNo: null, roleSpecific: false }), "Base");
  assert.equal(defaultLabel({ lastSavedNo: 1, roleSpecific: false }), "v2");
  assert.equal(defaultLabel({ lastSavedNo: 9, roleSpecific: false }), "v10");
});

test("defaultLabel: a role-specific version has no default, it must be named", () => {
  assert.equal(defaultLabel({ lastSavedNo: null, roleSpecific: true }), "");
  assert.equal(defaultLabel({ lastSavedNo: 3, roleSpecific: true }), "");
});

test("resolveLabel: a typed label is kept (trimmed)", () => {
  assert.deepEqual(resolveLabel("  Q4 refresh ", { lastSavedNo: 1, roleSpecific: false }), { ok: true, label: "Q4 refresh" });
});

test("resolveLabel: a blank label on a normal version falls back to the default", () => {
  assert.deepEqual(resolveLabel("   ", { lastSavedNo: null, roleSpecific: false }), { ok: true, label: "Base" });
  assert.deepEqual(resolveLabel("", { lastSavedNo: 2, roleSpecific: false }), { ok: true, label: "v3" });
});

test("resolveLabel: a role-specific version must be named", () => {
  const r = resolveLabel("   ", { lastSavedNo: 2, roleSpecific: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /name/);
  assert.deepEqual(resolveLabel("Java Backend", { lastSavedNo: 2, roleSpecific: true }), { ok: true, label: "Java Backend" });
});

test("resolveLabel: over-long labels are cut to the database limit", () => {
  const r = resolveLabel("x".repeat(100), { lastSavedNo: null, roleSpecific: false });
  assert.ok(r.ok && r.label.length === MAX_LABEL_LENGTH);
});
