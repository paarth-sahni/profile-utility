import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SyncError } from "./sync/errors";
import { runSync } from "./sync/runSync";
import type { SheetsClient, TabRead } from "./sync/sheetsClient";
import type { ApplyResult, BeginRunInput, FinishRunInput, SnapshotPayload, SyncDb } from "./sync/types";

// Fictional data only. The layout mirrors the real client list (header row, one client per row); every value is invented.
const E = "";
const HEADER = ["S.No", "Client Name", "Legal Name", "Friendly Name", "Client Group"];
const list = (...rows: [string, string, string, string][]): unknown[][] => [HEADER, ...rows.map((r, i) => [i + 1, ...r])];
const MAIN = list(
  ["Example Client One", "Example Client One Private Limited", "Example One", "Example Group"],
  ["Example Client Two", E, E, E],
);
const OTHER = list(["Example Client Three", E, E, E]);
const EMPTY: unknown[][] = [HEADER, [E, E, E, E, E]];

const OK_COUNTS: ApplyResult = { names_new: 3, names_updated: 0, occurrences: 4, missing_candidates: 0, complete: true, seen_again_but_deactivated: 0 };

function fakeSheets(opts: {
  titles?: string[];
  tabs?: Record<string, TabRead>;
  listError?: SyncError;
  readError?: SyncError;
}): SheetsClient {
  return {
    listTabs: async () => {
      if (opts.listError) throw opts.listError;
      return opts.titles ?? Object.keys(opts.tabs ?? {});
    },
    readTabs: async (titles) => {
      if (opts.readError) throw opts.readError;
      return new Map(titles.map((t) => [t, opts.tabs?.[t] ?? { rows: [] }]));
    },
  };
}

function fakeDb(o: { beginError?: SyncError; applyError?: SyncError; finishError?: boolean; apply?: ApplyResult } = {}) {
  const calls = { begin: [] as BeginRunInput[], apply: [] as { runId: string; snapshot: SnapshotPayload }[], finish: [] as FinishRunInput[] };
  const db: SyncDb = {
    beginRun: async (i) => {
      if (o.beginError) throw o.beginError;
      calls.begin.push(i);
      return { runId: "run-1", attempt: 1 };
    },
    applySnapshot: async (runId, snapshot) => {
      if (o.applyError) throw o.applyError;
      calls.apply.push({ runId, snapshot });
      return o.apply ?? OK_COUNTS;
    },
    finishRun: async (i) => {
      if (o.finishError) throw new Error("db down");
      calls.finish.push(i);
    },
  };
  return { db, calls };
}

const manual: BeginRunInput = { trigger: "manual", triggeredBy: "admin-1", scheduledFor: null };

test("runSync: the list tab read and parsed -> succeeded, complete snapshot, run closed", async () => {
  const { db, calls } = fakeDb();
  const sheets = fakeSheets({ titles: ["Sheet1", "Notes"], tabs: { Sheet1: { rows: MAIN }, Notes: { rows: [["whatever"]] } } });
  const r = await runSync(manual, { sheets, db, tabNames: ["Sheet1"] });
  assert.equal(r.status, "succeeded");
  assert.equal(r.errorCode, null);
  assert.deepEqual(r.ignoredTabs, ["Notes"]);
  assert.equal(calls.begin[0].triggeredBy, "admin-1");
  assert.equal(calls.apply.length, 1);
  assert.equal(calls.apply[0].snapshot.complete, true);
  const names = calls.apply[0].snapshot.names.map((n) => n.normalized);
  assert.ok(names.includes("example client one") && names.includes("example group") && names.includes("example client one private limited"));
  const fin = calls.finish[0];
  assert.equal(fin.status, "succeeded");
  assert.equal(fin.tabsDiscovered, 2);
  assert.equal(fin.tabsScanned, 1);
  assert.equal(fin.tabsFailed, 0);
  assert.equal(r.counts?.namesNew, 3);
  assert.equal(r.closeFailed, false);
});

test("runSync: every tab is read when no restriction is set", async () => {
  const { db, calls } = fakeDb();
  const r = await runSync(manual, { sheets: fakeSheets({ tabs: { Sheet1: { rows: MAIN }, Second: { rows: OTHER } } }), db });
  assert.equal(r.status, "succeeded");
  assert.equal(calls.finish[0].tabsScanned, 2);
  assert.ok(calls.apply[0].snapshot.names.some((n) => n.normalized === "example client three"));
});

test("runSync: an unparseable tab -> partial, nothing may be concluded as missing", async () => {
  const { db, calls } = fakeDb();
  const sheets = fakeSheets({ tabs: { Sheet1: { rows: MAIN }, Notes: { rows: [["nothing", "here"]] } } });
  const r = await runSync(manual, { sheets, db });
  assert.equal(r.status, "partial");
  assert.equal(r.errorCode, "SHEETS_PARSE");
  assert.equal(calls.apply[0].snapshot.complete, false);
  assert.equal(calls.finish[0].status, "partial");
  assert.equal(calls.finish[0].tabsFailed, 1);
  assert.equal(calls.finish[0].tabsScanned, 1);
});

test("runSync: a tab named in SYNC_TAB_NAMES that is not in the sheet -> partial, reported as missing (not retryable)", async () => {
  const { db, calls } = fakeDb();
  const r = await runSync(manual, { sheets: fakeSheets({ tabs: { Sheet1: { rows: MAIN } } }), db, tabNames: ["Sheet1", "Clients"] });
  assert.equal(r.status, "partial");
  assert.equal(r.errorCode, "SHEETS_PARSE");
  assert.equal(calls.apply[0].snapshot.complete, false);
  assert.deepEqual(r.tabs.find((t) => t.tab === "Clients")?.status, "missing");
  assert.equal(calls.finish[0].tabsFailed, 1);
});

test("runSync: a tab that could not be read this time -> partial with a retryable code", async () => {
  const { db, calls } = fakeDb();
  const sheets = fakeSheets({ tabs: { Sheet1: { rows: MAIN }, Second: { failed: new SyncError("SHEETS_RATE_LIMIT") } } });
  const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: "2026-11-05" }, { sheets, db });
  assert.equal(r.status, "partial");
  assert.equal(r.errorCode, "SHEETS_RATE_LIMIT");
  assert.equal(calls.apply[0].snapshot.complete, false);
  assert.equal(calls.begin[0].scheduledFor, "2026-11-05");
});

test("runSync: a list with a header but no names is never complete", async () => {
  const { db, calls } = fakeDb();
  const r = await runSync(manual, { sheets: fakeSheets({ tabs: { Sheet1: { rows: EMPTY } } }), db });
  assert.equal(r.status, "partial");
  assert.equal(r.errorCode, "EMPTY_SHEET");
  assert.equal(calls.apply[0].snapshot.complete, false);
});

test("runSync: no tab to read -> failed NO_TABS, run closed, nothing applied", async () => {
  const { db, calls } = fakeDb();
  const r = await runSync(manual, { sheets: fakeSheets({ titles: ["Notes"] }), db, tabNames: ["Sheet1"] });
  assert.equal(r.status, "failed");
  assert.equal(r.errorCode, "NO_TABS");
  assert.equal(calls.apply.length, 0);
  assert.equal(calls.finish.length, 1);
  assert.equal(calls.finish[0].status, "failed");
});

test("runSync: Google problems fail the run with a code and still close it", async () => {
  for (const code of ["SHEETS_AUTH", "SHEETS_NOT_FOUND", "SHEETS_UNAVAILABLE"] as const) {
    const { db, calls } = fakeDb();
    const r = await runSync(manual, { sheets: fakeSheets({ listError: new SyncError(code) }), db });
    assert.equal(r.status, "failed");
    assert.equal(r.errorCode, code);
    assert.equal(calls.finish[0].errorCode, code);
    assert.equal(calls.apply.length, 0);
  }
  const { db, calls } = fakeDb();
  await runSync(manual, { sheets: fakeSheets({ titles: ["Sheet1"], readError: new SyncError("SHEETS_AUTH") }), db });
  assert.equal(calls.finish[0].errorCode, "SHEETS_AUTH");
});

test("runSync: an unexpected exception becomes UNKNOWN with fixed text, never its own message", async () => {
  const { db, calls } = fakeDb();
  const sheets: SheetsClient = { listTabs: async () => { throw new Error("boom with Example Client One inside"); }, readTabs: async () => new Map() };
  const r = await runSync(manual, { sheets, db });
  assert.equal(r.errorCode, "UNKNOWN");
  assert.ok(!JSON.stringify(calls.finish).includes("Example Client One"));
});

test("runSync: the database rejecting the snapshot fails the run and closes it", async () => {
  const { db, calls } = fakeDb({ applyError: new SyncError("DB_ERROR") });
  const r = await runSync(manual, { sheets: fakeSheets({ tabs: { Sheet1: { rows: MAIN } } }), db });
  assert.equal(r.status, "failed");
  assert.equal(r.errorCode, "DB_ERROR");
  assert.equal(calls.finish[0].status, "failed");
});

test("runSync: a refused start (already running, cooldown) throws and leaves nothing to close", async () => {
  for (const code of ["RUN_IN_PROGRESS", "RUN_LIMIT"] as const) {
    const { db, calls } = fakeDb({ beginError: new SyncError(code) });
    await assert.rejects(runSync(manual, { sheets: fakeSheets({ tabs: {} }), db }), (e: unknown) => e instanceof SyncError && e.code === code);
    assert.equal(calls.finish.length, 0);
    assert.equal(calls.apply.length, 0);
  }
});

test("runSync: if even closing the run fails it says so (the next run closes it as stale)", async () => {
  const { db } = fakeDb({ finishError: true });
  const r = await runSync(manual, { sheets: fakeSheets({ tabs: { Sheet1: { rows: MAIN } } }), db });
  assert.equal(r.closeFailed, true);
  assert.equal(r.status, "succeeded");
});

test("runSync: what is stored in the run history is counts, tab titles and codes, never cell values", async () => {
  const { db, calls } = fakeDb();
  const sheets = fakeSheets({ tabs: { Sheet1: { rows: MAIN }, Notes: { rows: [["x", "y"]] } } });
  await runSync(manual, { sheets, db });
  const stored = JSON.stringify(calls.finish);
  for (const value of ["Example Client One", "Example Client One Private Limited", "Example One", "Example Group", "Example Client Two"]) assert.ok(!stored.includes(value), value);
  assert.ok(stored.includes("Sheet1"));
});

// ---- the service key is read in exactly one file --------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|cjs|js)$/.test(name) ? [p] : [];
  });
const files = [...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))), path.join(ROOT, "proxy.ts")];
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

test("the service-role key is only ever named in lib/sync/adminClient.ts (and tests)", () => {
  const offenders = files.filter((f) => !/\.test\.ts$/.test(f) && rel(f) !== "lib/sync/adminClient.ts" && readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.deepEqual(offenders.map(rel), []);
});

test("only the sync entry points may import adminClient, and no client component does", () => {
  const ALLOWED = new Set<string>(["lib/compliance/registry.ts", "lib/sync/runner.ts"]); // everything else goes through these two
  const importers = files.filter((f) => !/\.test\.ts$/.test(f) && rel(f) !== "lib/sync/adminClient.ts" && /from\s+["'](?:@\/lib\/sync\/adminClient|\.{1,2}\/(?:sync\/)?adminClient)["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map(rel).filter((f) => !ALLOWED.has(f)), []);
  assert.ok(readFileSync(path.join(ROOT, "lib/sync/adminClient.ts"), "utf8").includes('import "server-only"'));
  // the client never uses .from(): it cannot touch a table directly
  const code = readFileSync(path.join(ROOT, "lib/sync/adminClient.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/\.from\(/.test(code));
  assert.ok(/\.rpc\(/.test(code));
});

test("no browser code imports anything from lib/sync", () => {
  const client = files.filter((f) => /["']use client["']/.test(readFileSync(f, "utf8")));
  const bad = client.filter((f) => /from\s+["'][^"']*\/sync\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad.map(rel), []);
});

// ---- the inspect script prints structure only -----------------------------------------------------------------------
test("sync:inspect prints structure only: no cell values, no spreadsheet id, no key, no address", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const SHEET = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_QwEr";
  const EMAIL = "inspector@example-project.iam.gserviceaccount.com";
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  Object.assign(process.env, {
    GOOGLE_SHEETS_SPREADSHEET_ID: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
    GOOGLE_SA_CLIENT_EMAIL: EMAIL,
    GOOGLE_SA_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
    SYNC_TAB_NAMES: "Sheet1, Broken",
  });
  const tabs: Record<string, unknown[][]> = { Sheet1: MAIN, Broken: [["nothing", "here"]], Notes: [["Example Client One"]] };
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes("oauth2.googleapis.com")) return j({ access_token: "tok" });
    if (url.includes("batchGet")) {
      const ranges = new URL(url).searchParams.getAll("ranges");
      return j({ valueRanges: ranges.map((r) => ({ values: tabs[/^'(.*)'!A:E$/.exec(r)![1]] })) });
    }
    return j({ sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) });
  }) as typeof fetch;
  try {
    const { inspect } = await import("../scripts/sync-inspect");
    const lines: string[] = [];
    const code = await inspect((l) => lines.push(l));
    const out = lines.join("\n");
    assert.equal(code, 1, "one tab is unparseable, so the snapshot is not complete");
    assert.ok(out.includes("Sheet1: OK; header row 1; columns found: client_name, legal_name, friendly_name, client_group"));
    assert.ok(out.includes("Broken: UNPARSEABLE"));
    assert.ok(out.includes("Ignored tab titles: Notes"));
    for (const secret of ["Example Client One", "Example Group", "Example One", "Example Client Two", SHEET, EMAIL, "PRIVATE KEY", "tok"]) assert.ok(!out.includes(secret), `leaked: ${secret}`);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
