/**
 * Purpose: unit tests for the upload time limit setting: 60 s by default, EXTRACT_TIMEOUT_MS changes it, a nonsense or
 * too-small value is ignored. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getServerConfig } from "./serverConfig";

const saved = { key: process.env.GROQ_API_KEY, ms: process.env.EXTRACT_TIMEOUT_MS };
afterEach(() => {
  if (saved.key === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = saved.key;
  if (saved.ms === undefined) delete process.env.EXTRACT_TIMEOUT_MS;
  else process.env.EXTRACT_TIMEOUT_MS = saved.ms;
});

test("the upload time limit is 60 seconds unless EXTRACT_TIMEOUT_MS says otherwise", () => {
  process.env.GROQ_API_KEY = "test-key";
  delete process.env.EXTRACT_TIMEOUT_MS;
  assert.equal(getServerConfig().extractTimeoutMs, 60_000);
  process.env.EXTRACT_TIMEOUT_MS = "90000";
  assert.equal(getServerConfig().extractTimeoutMs, 90_000);
  for (const bad of ["", "abc", "0", "-5", "500", "NaN"]) {
    process.env.EXTRACT_TIMEOUT_MS = bad;
    assert.equal(getServerConfig().extractTimeoutMs, 60_000, `"${bad}" is ignored`);
  }
});
