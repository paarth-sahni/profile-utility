/** Purpose: unit tests for the automatic version labels (lib/versionLabel.ts). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_LABEL, labelForVersion } from "./versionLabel";

test("labelForVersion: Base for the first version, then v<number>", () => {
  assert.equal(BASE_LABEL, "Base");
  assert.equal(labelForVersion(1), "Base");
  assert.equal(labelForVersion(2), "v2");
  assert.equal(labelForVersion(10), "v10");
});
