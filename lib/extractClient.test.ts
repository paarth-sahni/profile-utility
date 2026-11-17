/**
 * Purpose: unit tests for the browser upload service's error mapping with a stubbed fetch: a gateway timeout (504, with
 * nginx's HTML page instead of our JSON) is a TIMEOUT with the friendly text; our own error bodies keep their code; an
 * HTML body on another status stays a plain failure. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { EXTRACT_ERROR_MESSAGES } from "./extract.types";
import { UploadError, uploadResume } from "./extractClient";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const file = () => new File(["x"], "r.pdf", { type: "application/pdf" });
const stub = (res: Response) => {
  globalThis.fetch = (async () => res) as typeof fetch;
};
const catchUpload = async () => {
  try {
    await uploadResume(file(), "external");
  } catch (e) {
    return e;
  }
  return null;
};

test("a 504 with an HTML body (nginx) is a TIMEOUT with the friendly text", async () => {
  stub(new Response("<html><h1>504 Gateway Time-out</h1></html>", { status: 504, headers: { "content-type": "text/html" } }));
  const e = await catchUpload();
  assert.ok(e instanceof UploadError && e.code === "TIMEOUT");
  assert.equal((e as UploadError).message, EXTRACT_ERROR_MESSAGES.TIMEOUT);
  assert.match((e as UploadError).message, /longer than usual/);
});

test("our own TIMEOUT body keeps its code and text", async () => {
  stub(new Response(JSON.stringify({ error: { code: "TIMEOUT", message: EXTRACT_ERROR_MESSAGES.TIMEOUT } }), { status: 504, headers: { "content-type": "application/json" } }));
  const e = await catchUpload();
  assert.ok(e instanceof UploadError && e.code === "TIMEOUT" && e.message === EXTRACT_ERROR_MESSAGES.TIMEOUT);
});

test("an HTML body on another status is still a plain failure, not a timeout", async () => {
  stub(new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
  const e = await catchUpload();
  assert.ok(e instanceof UploadError && e.code === "LLM_FAILED");
});

test("a network failure is a plain failure", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  const { error } = console;
  console.error = () => undefined;
  try {
    const e = await catchUpload();
    assert.ok(e instanceof UploadError && e.code === "LLM_FAILED");
  } finally {
    console.error = error;
  }
});
