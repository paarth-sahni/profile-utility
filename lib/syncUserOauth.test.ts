import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isLoopbackUrl, loadSheetsConfig } from "./sync/config";
import { SyncError } from "./sync/errors";
import { accessTokenFor, getUserAccessToken, TOKEN_URL } from "./sync/googleAuth";
import { userTokenHint } from "./sync/hints";

// Fictional values only. The dev-only "user_oauth" mode reads the sheet as a person; nothing here touches the network.
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD";
const env = (over: Record<string, string | undefined> = {}) => ({
  SYNC_AUTH_MODE: "user_oauth",
  GOOGLE_SHEETS_SPREADSHEET_ID: SHEET_ID,
  GOOGLE_OAUTH_CLIENT_ID: "client-id-123.apps.example",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-xyz",
  GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-token-abc",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  ...over,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("user mode: a complete local environment gives the user credentials", () => {
  const c = loadSheetsConfig(env({ SYNC_TAB_NAMES: "Sheet1" }));
  assert.equal(c.mode, "user_oauth");
  if (c.mode !== "user_oauth") return;
  assert.equal(c.clientId, "client-id-123.apps.example");
  assert.equal(c.refreshToken, "refresh-token-abc");
  assert.deepEqual(c.tabNames, ["Sheet1"]);
});

test("user mode is refused in a production build", () => {
  assert.throws(() => loadSheetsConfig(env({ NODE_ENV: "production" })), (e: unknown) => e instanceof SyncError && e.code === "CONFIG" && /production/.test(e.message));
});

test("user mode is refused when the database is not local (hosted URL, or a look-alike host)", () => {
  for (const url of ["https://abcd.supabase.co", "http://127.0.0.1.evil.example", "http://localhost.evil.example:54321", "not a url"]) {
    assert.throws(() => loadSheetsConfig(env({ NEXT_PUBLIC_SUPABASE_URL: url })), (e: unknown) => e instanceof SyncError && e.code === "CONFIG" && /local/.test(e.message), url);
  }
  assert.equal(loadSheetsConfig(env({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).mode, "user_oauth");
});

test("the explicit production opt-in lifts both guards, and only the exact value yes does", () => {
  const prod = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" };
  assert.equal(loadSheetsConfig(env({ ...prod, SYNC_ALLOW_USER_OAUTH_IN_PRODUCTION: "yes" })).mode, "user_oauth");
  for (const v of ["", "no", "true", "1", "YES"]) {
    assert.throws(() => loadSheetsConfig(env({ ...prod, SYNC_ALLOW_USER_OAUTH_IN_PRODUCTION: v })), (e: unknown) => e instanceof SyncError && e.code === "CONFIG", v);
  }
});

test("user mode: a missing variable is named, and no value is repeated", () => {
  for (const name of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"]) {
    assert.throws(
      () => loadSheetsConfig(env({ [name]: undefined })),
      (e: unknown) => {
        assert.ok(e instanceof SyncError && e.code === "CONFIG" && e.message.includes(name));
        for (const secret of ["client-secret-xyz", "refresh-token-abc"]) assert.ok(!e.message.includes(secret));
        return true;
      },
    );
  }
});

test("without SYNC_AUTH_MODE the service account is still required (the user variables are ignored)", () => {
  const { SYNC_AUTH_MODE: _ignored, ...rest } = env();
  void _ignored;
  assert.throws(() => loadSheetsConfig(rest), (e: unknown) => e instanceof SyncError && /GOOGLE_SA_CLIENT_EMAIL/.test(e.message));
});

test("isLoopbackUrl accepts only this computer", () => {
  assert.ok(isLoopbackUrl("http://127.0.0.1:54321") && isLoopbackUrl("http://localhost:3000") && isLoopbackUrl("http://[::1]:54321"));
  assert.ok(!isLoopbackUrl("https://x.supabase.co") && !isLoopbackUrl("") && !isLoopbackUrl("127.0.0.1"));
});

test("refresh-token grant: posts the grant to the token URL and returns the access token", async () => {
  let seen: { url: string; body: URLSearchParams } | null = null;
  const token = await getUserAccessToken({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" }, async (url, init) => {
    seen = { url, body: new URLSearchParams(String(init?.body)) };
    return json(200, { access_token: "ya29.test", expires_in: 3600 });
  });
  assert.equal(token, "ya29.test");
  assert.equal(seen!.url, TOKEN_URL);
  assert.equal(seen!.body.get("grant_type"), "refresh_token");
  assert.equal(seen!.body.get("refresh_token"), "rt");
  assert.equal(seen!.body.get("client_id"), "cid");
});

test("accessTokenFor picks the credential set by mode", async () => {
  const c = loadSheetsConfig(env());
  const body = await accessTokenFor(c, async (_u, init) => json(200, { access_token: String(init?.body).includes("refresh_token") ? "user-token" : "other" }));
  assert.equal(body, "user-token");
});

test("a rejected refresh becomes SHEETS_AUTH with a fixed hint that repeats nothing from Google", async () => {
  const leak = "SECRET-DETAIL-FROM-GOOGLE-client-secret-xyz";
  for (const [status, error, expect] of [
    [400, "invalid_grant", /sync:login/],
    [401, "invalid_client", /OAuth client/],
    [400, "something_else", /refused/],
  ] as const) {
    await assert.rejects(
      getUserAccessToken({ clientId: "cid", clientSecret: "client-secret-xyz", refreshToken: "refresh-token-abc" }, async () => json(status, { error, error_description: leak })),
      (e: unknown) => {
        assert.ok(e instanceof SyncError && e.code === "SHEETS_AUTH");
        assert.match(e.message, expect);
        for (const s of [leak, "client-secret-xyz", "refresh-token-abc"]) assert.ok(!e.message.includes(s));
        return true;
      },
    );
  }
  assert.match(userTokenHint("not json"), /refused/);
});

test("token endpoint trouble: network error and 5xx are unavailable, an empty token is unavailable", async () => {
  const creds = { clientId: "c", clientSecret: "s", refreshToken: "r" };
  await assert.rejects(getUserAccessToken(creds, async () => { throw new Error("net"); }), (e: unknown) => e instanceof SyncError && e.code === "SHEETS_UNAVAILABLE");
  await assert.rejects(getUserAccessToken(creds, async () => json(503, {})), (e: unknown) => e instanceof SyncError && e.code === "SHEETS_UNAVAILABLE");
  await assert.rejects(getUserAccessToken(creds, async () => json(200, { access_token: "" })), (e: unknown) => e instanceof SyncError && e.code === "SHEETS_UNAVAILABLE");
});

test("the OAuth variables are read only by the config loader and the login script", () => {
  const root = path.resolve(__dirname, "..");
  // hints.ts only NAMES the variables in a fixed sentence; it never reads them
  const allowed = new Set(["lib/sync/config.ts", "lib/sync/hints.ts", "scripts/sync-login.ts", "lib/syncUserOauth.test.ts", "lib/syncUserLogin.test.ts"]);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".next", ".git", "supabase"].includes(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name) && /GOOGLE_OAUTH_(CLIENT_SECRET|REFRESH_TOKEN)/.test(readFileSync(full, "utf8"))) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (!allowed.has(rel)) hits.push(rel);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
