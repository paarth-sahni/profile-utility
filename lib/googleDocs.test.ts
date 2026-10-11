/** Purpose: unit tests for Open in Google Docs: error mapping, request building, and that the token goes nowhere but Google. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIVE_SCOPE, GoogleDocsError, buildMultipartBody, describeGoogleDocsError, mapDriveError, uploadAsGoogleDoc } from "./googleDocs";

const DOCX = new Blob(["PK-docx-bytes"], { type: "application/octet-stream" });
const TOKEN = "ya29.SECRET-TOKEN-VALUE";

/** A fetch stand-in that records the request and answers with a canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("only the drive.file scope is requested", () => {
  assert.equal(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.file");
});

test("mapDriveError: status and reason decide the code", () => {
  assert.equal(mapDriveError(401, null), "token_expired");
  assert.equal(mapDriveError(429, null), "rate_limited");
  assert.equal(mapDriveError(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }), "rate_limited");
  assert.equal(mapDriveError(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }), "api_disabled");
  assert.equal(mapDriveError(403, { error: { details: [{ reason: "SERVICE_DISABLED" }] } }), "api_disabled");
  assert.equal(mapDriveError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }), "access_denied");
  assert.equal(mapDriveError(403, null), "access_denied");
  assert.equal(mapDriveError(500, null), "upload_failed");
  assert.equal(mapDriveError(400, "weird"), "upload_failed");
});

test("every error code has a friendly message that never mentions tokens or raw errors", () => {
  const codes = ["script_failed", "popup_blocked", "popup_closed", "access_denied", "api_disabled", "token_expired", "rate_limited", "network", "upload_failed"] as const;
  for (const code of codes) {
    const text = describeGoogleDocsError(new GoogleDocsError(code));
    assert.ok(text.length > 20 && /[.]$/.test(text), code);
    assert.ok(!/token|oauth|401|403|undefined|\[object/i.test(text), `${code}: ${text}`);
  }
  assert.equal(describeGoogleDocsError(new Error("boom: ya29.x")), describeGoogleDocsError(new GoogleDocsError("upload_failed")));
  assert.equal(describeGoogleDocsError("not an error"), describeGoogleDocsError(new GoogleDocsError("upload_failed")));
});

test("buildMultipartBody: JSON metadata asks Drive to convert to a Google Doc, then the DOCX bytes", async () => {
  const text = await buildMultipartBody("Alex — internal profile", DOCX, "BOUND").text();
  assert.match(text, /^--BOUND\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n/);
  assert.ok(text.includes('"mimeType":"application/vnd.google-apps.document"'));
  assert.ok(text.includes('"name":"Alex — internal profile"'));
  assert.ok(text.includes("Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\nPK-docx-bytes"));
  assert.ok(text.endsWith("\r\n--BOUND--"));
});

test("uploadAsGoogleDoc: one request, to googleapis.com only, token only in the Authorization header", async () => {
  const { impl, calls } = fakeFetch(200, { id: "doc123", webViewLink: "https://docs.google.com/document/d/doc123/edit?usp=drivesdk" });
  const doc = await uploadAsGoogleDoc(TOKEN, "Title", DOCX, impl);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).hostname, "www.googleapis.com");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(headers["Content-Type"].startsWith("multipart/related; boundary="));
  assert.ok(!calls[0].url.includes(TOKEN), "the token must not be in the URL");
  assert.ok(!(await (calls[0].init.body as Blob).text()).includes(TOKEN), "the token must not be in the body");
  assert.deepEqual(doc, { id: "doc123", url: "https://docs.google.com/document/d/doc123/edit?usp=drivesdk" });
  assert.ok(!JSON.stringify(doc).includes(TOKEN), "the result must not carry the token");
});

test("uploadAsGoogleDoc: builds an edit link when Drive returns only an id", async () => {
  const { impl } = fakeFetch(200, { id: "abc" });
  assert.equal((await uploadAsGoogleDoc(TOKEN, "T", DOCX, impl)).url, "https://docs.google.com/document/d/abc/edit");
});

test("uploadAsGoogleDoc: failures become coded errors without leaking the token", async () => {
  for (const [status, body, code] of [
    [401, { error: { message: "Invalid Credentials" } }, "token_expired"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "api_disabled"],
    [429, {}, "rate_limited"],
    [503, {}, "upload_failed"],
  ] as const) {
    await assert.rejects(uploadAsGoogleDoc(TOKEN, "T", DOCX, fakeFetch(status, body).impl), (e: unknown) => {
      assert.ok(e instanceof GoogleDocsError);
      assert.equal(e.code, code);
      assert.ok(!e.message.includes(TOKEN) && !String(e.stack).includes(TOKEN));
      return true;
    });
  }
});

test("uploadAsGoogleDoc: a response without an id, and a network failure, are errors", async () => {
  await assert.rejects(uploadAsGoogleDoc(TOKEN, "T", DOCX, fakeFetch(200, {}).impl), (e: unknown) => e instanceof GoogleDocsError && e.code === "upload_failed");
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await assert.rejects(uploadAsGoogleDoc(TOKEN, "T", DOCX, offline), (e: unknown) => e instanceof GoogleDocsError && e.code === "network");
});
