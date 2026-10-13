/**
 * Purpose: route-level auth tests. Without a session, POST /api/extract, /api/profiles and /api/pdf must answer 401
 * and must not touch the LLM or the database. Calling a handler outside a Next request has no cookies, which is
 * exactly a signed-out caller. (proxy.ts also blocks these paths; the handlers must not rely on it alone.)
 * Run through `npm test` (it preloads scripts/stubServerOnly.cjs).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as extractPOST } from "../app/api/extract/route";
import { POST as profilesPOST } from "../app/api/profiles/route";
import { POST as pdfPOST } from "../app/api/pdf/route";

const jsonRequest = (body: unknown) =>
  new Request("http://localhost:3000/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("POST /api/profiles without a session returns 401 and a generic error", async () => {
  const res = await profilesPOST(
    jsonRequest({ template: "internal", kind: "base", label: "Base", source: "scratch", data: {}, profileId: null }),
  );
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("POST /api/profiles without a session returns 401 even for a malformed body (auth comes first)", async () => {
  const res = await profilesPOST(new Request("http://localhost:3000/api/profiles", { method: "POST", body: "not json" }));
  assert.equal(res.status, 401);
});

test("POST /api/extract without a session returns 401", async () => {
  const form = new FormData();
  form.set("file", new File(["hello"], "resume.txt", { type: "text/plain" }));
  form.set("templateId", "internal");
  const res = await extractPOST(new Request("http://localhost:3000/api/extract", { method: "POST", body: form }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("POST /api/extract without a session returns 401 even with no file at all", async () => {
  const res = await extractPOST(new Request("http://localhost:3000/api/extract", { method: "POST", body: new FormData() }));
  assert.equal(res.status, 401);
});

test("POST /api/pdf without a session returns 401 and makes no PDF", async () => {
  const res = await pdfPOST(
    new Request("http://localhost:3000/api/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: "internal", data: {} }) }),
  );
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("content-type")?.includes("application/pdf"), false);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UNAUTHENTICATED");
});
