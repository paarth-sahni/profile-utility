import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { extractSpreadsheetId, loadSheetsConfig, normalizePrivateKey } from "./sync/config";
import { isRetryable, SyncError } from "./sync/errors";
import { getAccessToken, signJwt, SHEETS_READONLY_SCOPE, TOKEN_URL } from "./sync/googleAuth";
import { backoffMs, shouldAttemptNow, type LastRun } from "./sync/retry";
import { createSheetsClient, rangeFor } from "./sync/sheetsClient";

// Fictional values only. The key is generated for the test and means nothing.
const { privateKey: PEM, publicKey: PUB } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const EMAIL = "reader@example-project.iam.gserviceaccount.com";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD";

const goodEnv = () => ({
  GOOGLE_SHEETS_SPREADSHEET_ID: SHEET_ID,
  GOOGLE_SA_CLIENT_EMAIL: EMAIL,
  GOOGLE_SA_PRIVATE_KEY: JSON.stringify(PEM).slice(1, -1).replace(/\\n/g, "\\n"), // one line with literal \n
});

test("config: reads a good environment, with a bare id or a full link", () => {
  const c = loadSheetsConfig(goodEnv());
  assert.equal(c.spreadsheetId, SHEET_ID);
  assert.equal(c.clientEmail, EMAIL);
  assert.ok(c.privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n"));
  assert.equal(c.tabNames, null, "every tab by default");
  const link = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=2018897664#gid=2018897664`;
  assert.equal(loadSheetsConfig({ ...goodEnv(), GOOGLE_SHEETS_SPREADSHEET_ID: link }).spreadsheetId, SHEET_ID);
  assert.deepEqual(loadSheetsConfig({ ...goodEnv(), SYNC_TAB_NAMES: "Sheet1, Clients" }).tabNames, ["Sheet1", "Clients"]);
});

test("config: key with literal \\n, wrapping quotes or real line breaks all work", () => {
  assert.equal(normalizePrivateKey('"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"'), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  const real = loadSheetsConfig({ ...goodEnv(), GOOGLE_SA_PRIVATE_KEY: PEM });
  assert.ok(real.privateKey.includes("\n"));
});

test("config: errors name the variable and never contain a value", () => {
  const cases: [Record<string, string | undefined>, string][] = [
    [{ ...goodEnv(), GOOGLE_SHEETS_SPREADSHEET_ID: undefined }, "GOOGLE_SHEETS_SPREADSHEET_ID"],
    [{ ...goodEnv(), GOOGLE_SHEETS_SPREADSHEET_ID: "not an id!" }, "GOOGLE_SHEETS_SPREADSHEET_ID"],
    [{ ...goodEnv(), GOOGLE_SA_CLIENT_EMAIL: "someone@gmail.com" }, "GOOGLE_SA_CLIENT_EMAIL"],
    [{ ...goodEnv(), GOOGLE_SA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc" }, "GOOGLE_SA_PRIVATE_KEY"],
    [{ ...goodEnv(), GOOGLE_SA_PRIVATE_KEY: undefined }, "GOOGLE_SA_PRIVATE_KEY"],
  ];
  for (const [env, name] of cases) {
    assert.throws(
      () => loadSheetsConfig(env),
      (e: unknown) => {
        assert.ok(e instanceof SyncError && e.code === "CONFIG");
        assert.ok(e.message.includes(name), e.message);
        for (const secret of ["someone@gmail.com", "not an id!", "BEGIN PRIVATE KEY-----\\nabc"]) assert.ok(!e.message.includes(secret));
        return true;
      },
    );
  }
  assert.equal(extractSpreadsheetId("short"), null);
});

test("jwt: RS256 assertion has the right claims and verifies with the public key", () => {
  const now = 1_800_000_000;
  const jwt = signJwt(EMAIL, PEM, now);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.iss, EMAIL);
  assert.equal(claims.scope, SHEETS_READONLY_SCOPE);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets.readonly");
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(verify("RSA-SHA256", Buffer.from(`${h}.${c}`), createPublicKey(PUB), Buffer.from(s, "base64url")));
});

test("jwt: an unusable key is a CONFIG error that does not echo the key", () => {
  assert.throws(
    () => signJwt(EMAIL, "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----", 1),
    (e: unknown) => e instanceof SyncError && e.code === "CONFIG" && !e.message.includes("not-a-key"),
  );
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("token: sends the signed assertion, returns the token, maps failures to codes", async () => {
  let sent = "";
  const ok = await getAccessToken({ clientEmail: EMAIL, privateKey: PEM }, async (url, init) => {
    assert.equal(url, TOKEN_URL);
    sent = String(init?.body);
    return json(200, { access_token: "tok-1" });
  });
  assert.equal(ok, "tok-1");
  assert.ok(sent.includes("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"));

  const expect = async (res: () => Response | Promise<Response>, code: string) =>
    assert.rejects(getAccessToken({ clientEmail: EMAIL, privateKey: PEM }, async () => res()), (e: unknown) => e instanceof SyncError && e.code === code);
  await expect(() => json(400, { error: "invalid_grant", error_description: "secret detail" }), "SHEETS_AUTH");
  await expect(() => json(401, {}), "SHEETS_AUTH");
  await expect(() => json(429, {}), "SHEETS_RATE_LIMIT");
  await expect(() => json(503, {}), "SHEETS_UNAVAILABLE");
  await expect(() => json(200, {}), "SHEETS_UNAVAILABLE");
  await expect(() => { throw new Error("socket hang up"); }, "SHEETS_UNAVAILABLE");
});

/** A fake Google: token endpoint, tab list and batchGet answered from a map of tab title -> values. */
function fakeGoogle(tabs: Record<string, unknown[][] | undefined>, calls: string[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    if (url === TOKEN_URL) return json(200, { access_token: "tok" });
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer tok");
    const u = new URL(url);
    if (u.pathname.endsWith("/values:batchGet")) {
      const ranges = u.searchParams.getAll("ranges");
      assert.equal(u.searchParams.get("valueRenderOption"), "UNFORMATTED_VALUE");
      return json(200, {
        valueRanges: ranges.map((r) => {
          const title = /^'(.*)'!A:E$/.exec(r)![1].replace(/''/g, "'");
          return tabs[title] ? { range: r, values: tabs[title] } : { range: r };
        }),
      });
    }
    assert.equal(u.searchParams.get("fields"), "sheets.properties.title");
    return json(200, { sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) });
  };
}

const config = () => loadSheetsConfig(goodEnv());

test("sheets client: lists titles and reads only columns A:E", async () => {
  const calls: string[] = [];
  const client = createSheetsClient(config(), { fetchFn: fakeGoogle({ "October 2026": [["a", "b"]], Notes: [], "O'Brien 2026": [["x"]] }, calls) });
  assert.deepEqual(await client.listTabs(), ["October 2026", "Notes", "O'Brien 2026"]);
  const read = await client.readTabs(["October 2026", "O'Brien 2026", "Notes"]);
  assert.deepEqual(read.get("October 2026"), { rows: [["a", "b"]] });
  assert.deepEqual(read.get("O'Brien 2026"), { rows: [["x"]] });
  assert.deepEqual(read.get("Notes"), { rows: [] }); // a tab with no values at all
  assert.ok(calls.filter((c) => c.includes("batchGet")).every((c) => new URL(c).searchParams.getAll("ranges").every((r) => /!A:E$/.test(r)))); // never more than A:E
  assert.equal(rangeFor("O'Brien 2026"), "'O''Brien 2026'!A:E");
  assert.equal(calls.filter((c) => c === TOKEN_URL).length, 1, "one token for the whole run");
  assert.equal(calls.filter((c) => c.includes("batchGet")).length, 1, "one batchGet for a few tabs");
});

test("sheets client: many tabs are split into requests of 20", async () => {
  const tabs: Record<string, unknown[][]> = {};
  for (let i = 0; i < 45; i++) tabs[`Tab ${i}`] = [[`v${i}`]];
  const calls: string[] = [];
  const client = createSheetsClient(config(), { fetchFn: fakeGoogle(tabs, calls) });
  const read = await client.readTabs(Object.keys(tabs));
  assert.equal(read.size, 45);
  assert.equal(calls.filter((c) => c.includes("batchGet")).length, 3);
});

test("sheets client: HTTP failures become codes, text and ids never leak", async () => {
  const run = async (res: Response | (() => never), call: "list" | "read") => {
    const client = createSheetsClient(config(), {
      getToken: async () => "tok",
      fetchFn: async () => {
        if (typeof res === "function") res();
        return res as Response;
      },
    });
    return call === "list" ? client.listTabs() : client.readTabs(["October 2026"]);
  };
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      assert.ok(e instanceof SyncError);
      assert.ok(!e.message.includes(SHEET_ID) && !e.message.includes("leaky body"), e.message);
      return e.code;
    }
    return "no error";
  };
  assert.equal(await code(run(json(401, { error: "leaky body" }), "list")), "SHEETS_AUTH");
  assert.equal(await code(run(json(403, { error: { errors: [{ reason: "forbidden" }] } }), "list")), "SHEETS_AUTH");
  assert.equal(await code(run(json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }), "list")), "SHEETS_RATE_LIMIT");
  assert.equal(await code(run(json(404, { error: "leaky body" }), "list")), "SHEETS_NOT_FOUND");
  assert.equal(await code(run(json(429, {}), "list")), "SHEETS_RATE_LIMIT");
  assert.equal(await code(run(json(500, {}), "list")), "SHEETS_UNAVAILABLE");
  assert.equal(await code(run(json(400, {}), "list")), "SHEETS_PARSE");
  assert.equal(await code(run((() => { throw new Error("ECONNRESET leaky body"); }) as () => never, "list")), "SHEETS_UNAVAILABLE");
  assert.equal(await code(run(new Response("not json", { status: 200 }), "list")), "SHEETS_UNAVAILABLE");
  assert.equal(await code(run(json(200, {}), "list")), "SHEETS_UNAVAILABLE");
});

test("sheets client: a temporary failure while reading marks those tabs failed; a permanent one stops the run", async () => {
  const temporary = createSheetsClient(config(), { getToken: async () => "tok", fetchFn: async () => json(503, {}) });
  const read = await temporary.readTabs(["October 2026", "September 2026"]);
  for (const t of ["October 2026", "September 2026"]) {
    const got = read.get(t);
    assert.ok(got && "failed" in got && got.failed.code === "SHEETS_UNAVAILABLE");
  }
  const permanent = createSheetsClient(config(), { getToken: async () => "tok", fetchFn: async () => json(404, {}) });
  await assert.rejects(permanent.readTabs(["October 2026"]), (e: unknown) => e instanceof SyncError && e.code === "SHEETS_NOT_FOUND");
  // wrong number of ranges back = not trusted
  const short = createSheetsClient(config(), { getToken: async () => "tok", fetchFn: async () => json(200, { valueRanges: [] }) });
  const r = await short.readTabs(["October 2026"]);
  assert.ok("failed" in r.get("October 2026")!);
});

test("sheets client: a failed token request is not cached", async () => {
  let n = 0;
  const client = createSheetsClient(config(), {
    fetchFn: async (url) => {
      if (url === TOKEN_URL) return ++n === 1 ? json(503, {}) : json(200, { access_token: "tok" });
      return json(200, { sheets: [{ properties: { title: "October 2026" } }] });
    },
  });
  await assert.rejects(client.listTabs());
  assert.deepEqual(await client.listTabs(), ["October 2026"]);
});

test("errors: only rate limits and outages are retryable", () => {
  for (const c of ["SHEETS_RATE_LIMIT", "SHEETS_UNAVAILABLE"]) assert.equal(isRetryable(c), true, c);
  for (const c of ["SHEETS_AUTH", "SHEETS_NOT_FOUND", "SHEETS_PARSE", "NO_TABS", "EMPTY_SHEET", "CONFIG", "DB_ERROR", "RUN_LIMIT", "UNKNOWN"]) assert.equal(isRetryable(c), false, c);
});

test("retry: waits of 1, 5 and 20 minutes with +/-20% jitter", () => {
  assert.equal(backoffMs(1, () => 0.5), 60_000);
  assert.equal(backoffMs(2, () => 0.5), 300_000);
  assert.equal(backoffMs(3, () => 0.5), 1_200_000);
  assert.equal(backoffMs(9, () => 0.5), 1_200_000, "later attempts keep the longest wait");
  assert.equal(backoffMs(1, () => 0), 48_000);
  assert.equal(backoffMs(1, () => 1), 72_000);
  for (let i = 0; i < 50; i++) {
    const v = backoffMs(2);
    assert.ok(v >= 240_000 && v <= 360_000);
  }
});

test("retry: shouldAttemptNow gates a scheduled day", () => {
  const now = new Date("2026-11-05T03:10:00Z");
  const run = (o: Partial<LastRun>): LastRun => ({ status: "failed", attempt: 1, finished_at: "2026-11-05T03:00:00Z", error_code: "SHEETS_UNAVAILABLE", ...o });
  assert.equal(shouldAttemptNow(null, now, 4).go, true);
  assert.equal(shouldAttemptNow(run({ status: "succeeded", error_code: null }), now, 4).go, false);
  assert.equal(shouldAttemptNow(run({ status: "running", finished_at: null }), now, 4).go, false);
  assert.equal(shouldAttemptNow(run({}), now, 4).go, true, "10 minutes after a 1 minute wait");
  assert.equal(shouldAttemptNow(run({ finished_at: "2026-11-05T03:09:50Z" }), now, 4).go, false, "still waiting");
  assert.equal(shouldAttemptNow(run({ attempt: 4 }), now, 4).go, false, "limit reached");
  assert.equal(shouldAttemptNow(run({ error_code: "SHEETS_AUTH" }), now, 4).go, false, "needs a person");
  assert.equal(shouldAttemptNow(run({ status: "partial", error_code: "SHEETS_PARSE" }), now, 4).go, false);
  assert.equal(shouldAttemptNow(run({ status: "partial", error_code: "SHEETS_RATE_LIMIT" }), now, 4).go, true);
  assert.equal(shouldAttemptNow(run({ error_code: "STALE_RUN" }), now, 4).go, true, "a run that died is retried");
});

test("hints: a refused token request says what to fix, in our words only", async () => {
  const tokenErr = async (body: unknown, status = 400) => {
    try {
      await getAccessToken({ clientEmail: EMAIL, privateKey: PEM }, async () => json(status, body));
    } catch (e) {
      assert.ok(e instanceof SyncError && e.code === "SHEETS_AUTH");
      return e.message;
    }
    return "";
  };
  const sig = await tokenErr({ error: "invalid_grant", error_description: "Invalid JWT Signature. private_key_id abc123" });
  assert.match(sig, /private key does not match/);
  assert.doesNotMatch(sig, /abc123|private_key_id/);
  assert.match(await tokenErr({ error: "invalid_grant", error_description: "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe." }), /clock is off/);
  assert.match(await tokenErr({ error: "invalid_grant", error_description: "Invalid grant: account not found" }), /disabled, deleted or its address is wrong/);
  assert.match(await tokenErr({ error: "invalid_grant" }), /invalid_grant/);
  assert.match(await tokenErr({ error: "unauthorized_client" }), /does not accept/);
  assert.match(await tokenErr("not json"), /Google refused the request/);
});

test("hints: a refused Sheets call distinguishes 'not shared' from 'API not enabled'", async () => {
  const sheetsErr = async (status: number, body: unknown) => {
    const client = createSheetsClient(config(), { getToken: async () => "tok", fetchFn: async () => json(status, body) });
    try {
      await client.listTabs();
    } catch (e) {
      assert.ok(e instanceof SyncError && e.code === "SHEETS_AUTH");
      assert.ok(!e.message.includes(SHEET_ID) && !e.message.includes(EMAIL));
      return e.message;
    }
    return "";
  };
  const disabled = await sheetsErr(403, { error: { status: "PERMISSION_DENIED", message: "Google Sheets API has not been used in project 123456 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] } });
  assert.match(disabled, /Sheets API is not enabled/);
  assert.doesNotMatch(disabled, /123456/);
  assert.match(await sheetsErr(403, { error: { status: "PERMISSION_DENIED", message: "The caller does not have permission" } }), /Share the sheet with the service-account address as Viewer/);
  assert.match(await sheetsErr(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }), /access denied/);
  assert.match(await sheetsErr(401, { error: { message: "Invalid Credentials" } }), /did not accept the access token/);
  assert.match(await sheetsErr(403, "html"), /access denied/);
});
