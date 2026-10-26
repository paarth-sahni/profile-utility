/** Purpose: unit tests for Open in Google Docs: error mapping, request building, and that the token goes nowhere but Google. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DRIVE_SCOPE,
  GoogleDocsError,
  buildMultipartBody,
  createdNotice,
  describeGoogleDocsError,
  docOpenUrl,
  mapDriveError,
  sameAccount,
  tokenHints,
  uploadAsGoogleDoc,
} from "./googleDocs";

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
  assert.deepEqual(doc, { id: "doc123", url: "https://docs.google.com/document/d/doc123/edit?usp=drivesdk", owner: null });
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

test("uploadAsGoogleDoc asks Drive for the file's owner and returns it", async () => {
  const { impl, calls } = fakeFetch(200, { id: "d1", webViewLink: "https://docs.google.com/document/d/d1/edit", owners: [{ emailAddress: " Sam.Lee@infobeans.com " }] });
  const doc = await uploadAsGoogleDoc(TOKEN, "T", DOCX, impl);
  assert.ok(new URL(calls[0].url).searchParams.get("fields")?.includes("owners(emailAddress)"));
  assert.equal(doc.owner, "Sam.Lee@infobeans.com");
  // an owner that is not an email address is ignored
  assert.equal((await uploadAsGoogleDoc(TOKEN, "T", DOCX, fakeFetch(200, { id: "d2", owners: [{ emailAddress: "nobody" }, {}] }).impl)).owner, null);
});

test("tokenHints: the popup is told the app user's email and Workspace domain; odd values give no hint", () => {
  assert.deepEqual(tokenHints("Sam.Lee@InfoBeans.com"), { hint: "Sam.Lee@InfoBeans.com", hd: "infobeans.com" });
  assert.deepEqual(tokenHints("  sam@infobeans.com "), { hint: "sam@infobeans.com", hd: "infobeans.com" });
  for (const bad of [undefined, null, "", "sam", "sam@", "@infobeans.com", "a b@infobeans.com"]) assert.deepEqual(tokenHints(bad), {}, String(bad));
});

test("sameAccount ignores case and spaces and never matches missing or invalid emails", () => {
  assert.ok(sameAccount("Sam@InfoBeans.com", " sam@infobeans.com"));
  assert.ok(!sameAccount("sam@infobeans.com", "pat@infobeans.com"));
  assert.ok(!sameAccount(null, null));
  assert.ok(!sameAccount("sam", "sam"));
});

test("docOpenUrl opens the document through Google's account chooser for that account", () => {
  const doc = "https://docs.google.com/document/d/abc/edit?usp=drivesdk";
  const url = new URL(docOpenUrl(doc, "sam.lee+x@infobeans.com"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/AccountChooser");
  assert.equal(url.searchParams.get("Email"), "sam.lee+x@infobeans.com");
  assert.equal(url.searchParams.get("continue"), doc);
  // without a usable email the document's own link is used
  assert.equal(docOpenUrl(doc, null), doc);
  assert.equal(docOpenUrl(doc, "not an email"), doc);
});

test("createdNotice names the account, says it is private and what to do on 'You need access'", () => {
  const same = createdNotice("sam@infobeans.com", "Sam@infobeans.com");
  assert.ok(same.includes("Google Drive of sam@infobeans.com") && same.includes("Only that account can open it") && same.includes("open the link as sam@infobeans.com"));
  assert.ok(!same.includes("different account"));
  const other = createdNotice("sam@gmail.com", "sam@infobeans.com");
  assert.ok(other.includes("Google Drive of sam@gmail.com") && other.includes("signed in to this app as sam@infobeans.com") && other.includes("different account") && other.includes("open the link as sam@gmail.com"));
  // Drive did not say who owns it: fall back to the signed-in email, then to a generic line
  assert.ok(createdNotice(null, "sam@infobeans.com").includes("open the link as sam@infobeans.com"));
  assert.ok(createdNotice(null, null).includes("open the link as that account"));
});

test("sign-in asks for no Google Drive access (only the Google Docs popup does)", () => {
  const login = readFileSync(new URL("../components/LoginCard.tsx", import.meta.url), "utf8");
  assert.ok(!/scopes\s*:/.test(login) && !/auth\/drive/.test(login.replace(/\/\/.*$/gm, "")), "LoginCard must not request a Drive scope");
});
