import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { SyncError } from "./sync/errors";
import { buildAuthUrl, exchangeCodeForRefreshToken, pkcePair, upsertEnvLine } from "./sync/userLogin";

// Fictional values only; no network.
test("PKCE: the challenge is the S256 of the verifier, and each pair is new", () => {
  const a = pkcePair();
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.notEqual(a.verifier, pkcePair().verifier);
  assert.ok(a.verifier.length >= 43);
});

test("the sign-in address asks for read-only spreadsheet access, a refresh token and PKCE only", () => {
  const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5555", state: "st", challenge: "ch" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/spreadsheets.readonly");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:5555");
  assert.equal(url.searchParams.get("state"), "st");
  assert.ok(!url.search.includes("secret"));
});

test("code exchange: sends the verifier and returns only the refresh token", async () => {
  let body = new URLSearchParams();
  const token = await exchangeCodeForRefreshToken(
    { clientId: "cid", clientSecret: "sec", code: "the-code", verifier: "ver", redirectUri: "http://127.0.0.1:5555" },
    async (_u, init) => {
      body = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "rt-1" }), { status: 200 });
    },
  );
  assert.equal(token, "rt-1");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "ver");
  assert.equal(body.get("code"), "the-code");
});

test("code exchange failures use fixed wording and never repeat Google's text or the secret", async () => {
  const p = { clientId: "cid", clientSecret: "TOP-SECRET", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:1" };
  const bad = (res: () => Promise<Response>) =>
    assert.rejects(exchangeCodeForRefreshToken(p, res), (e: unknown) => {
      assert.ok(e instanceof SyncError);
      for (const s of ["TOP-SECRET", "LEAKED-DETAIL"]) assert.ok(!e.message.includes(s));
      return true;
    });
  await bad(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "LEAKED-DETAIL" }), { status: 400 }));
  await bad(async () => new Response(JSON.stringify({ access_token: "a" }), { status: 200 })); // no refresh token
  await bad(async () => {
    throw new Error("net");
  });
  await bad(async () => new Response("not json", { status: 200 }));
});

test("upsertEnvLine: replaces the key line, keeps every other line and the file's line endings", () => {
  const lf = "A=1\nGOOGLE_OAUTH_REFRESH_TOKEN=old\nB=2\n";
  assert.equal(upsertEnvLine(lf, "GOOGLE_OAUTH_REFRESH_TOKEN", "new"), "A=1\nGOOGLE_OAUTH_REFRESH_TOKEN=new\nB=2\n");
  const crlf = "A=1\r\nGOOGLE_OAUTH_REFRESH_TOKEN=\r\nB=2\r\n";
  assert.equal(upsertEnvLine(crlf, "GOOGLE_OAUTH_REFRESH_TOKEN", "new"), "A=1\r\nGOOGLE_OAUTH_REFRESH_TOKEN=new\r\nB=2\r\n");
});

test("upsertEnvLine: appends when the key is absent, creates content for an empty file, never touches similar keys", () => {
  assert.equal(upsertEnvLine("A=1\n", "K", "v"), "A=1\nK=v\n");
  assert.equal(upsertEnvLine("A=1", "K", "v"), "A=1\nK=v\n");
  assert.equal(upsertEnvLine("", "K", "v"), "K=v\n");
  assert.equal(upsertEnvLine("KK=1\n#K=2\n", "K", "v"), "KK=1\n#K=2\nK=v\n");
});
