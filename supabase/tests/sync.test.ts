/**
 * Purpose: proves the REAL sync path against the LOCAL database: runSync (with a fake Google Sheet) -> the service-role
 * client in lib/sync/adminClient.ts -> the three service_role-only functions -> the registry tables. It also proves who can
 * NOT do this: signed-in users (even an admin), anon, and the service key itself on the tables.
 *
 * Requires the local stack with the seed (`npm run db:start && npm run db:reset`) and the compliance migrations applied.
 * Run: `npm run test:sync` (reads .env.local.localdb: the LOCAL stack's demo keys). It REFUSES to run unless the API URL is
 * a loopback address. Fictional data only; no Google call is made. The registry is insert-only by design, so this test leaves
 * its rows behind: clean the local database with
 *   docker exec supabase_db_profile psql -U postgres -c "truncate compliance_name_sources, compliance_names, compliance_sync_runs"
 * (local only, never on a hosted database). Names carry a random suffix so repeated runs never collide.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createRegistrySource, createSchedulerSource, createSyncDb } from "../../lib/sync/adminClient";
import { buildMatcher } from "../../lib/compliance/match";
import { gateResponse } from "../../lib/compliance/gate";
import { blankResume, type InternalResume } from "../../lib/schemas";
import { SyncError } from "../../lib/sync/errors";
import { runSync } from "../../lib/sync/runSync";
import type { SheetsClient, TabRead } from "../../lib/sync/sheetsClient";
import type { SyncDb } from "../../lib/sync/types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSWORD = "password123";

const plain = (key: string): SupabaseClient =>
  createClient(URL_, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function signedIn(email: string): Promise<{ client: SupabaseClient; id: string }> {
  const client = plain(PUBLISHABLE);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`Sign-in as ${email} failed. Did you run npm run db:reset?`);
  return { client, id: data.user.id };
}

const SUFFIX = randomBytes(3).toString("hex");
const CLIENT = `Synctest Client ${SUFFIX}`;
const LEGAL = `Synctest Client ${SUFFIX} Private Limited`;
const FRIENDLY = `Synctest Friendly ${SUFFIX}`;
const GROUP = `Synctest Group ${SUFFIX}`;
const OTHER = `Synctest Other ${SUFFIX}`;
const E = "";
const HEADER = ["S.No", "Client Name", "Legal Name", "Friendly Name", "Client Group"];
/** The client list layout: a header row, then one client per row (S.No first). */
const list = (...rows: [string, string, string, string][]): unknown[][] => [HEADER, ...rows.map((r, i) => [i + 1, ...r])];

function sheets(tabs: Record<string, TabRead>): SheetsClient {
  return { listTabs: async () => Object.keys(tabs), readTabs: async (t) => new Map(t.map((x) => [x, tabs[x]])) };
}

/** A random far-future scheduled day nobody else uses, so repeated test runs never hit "retry limit / already succeeded". */
const usedDays = new Set<string>();
function uniqueDay(): string {
  for (;;) {
    const day = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 27)).padStart(2, "0")}`;
    if (!usedDays.has(day)) {
      usedDays.add(day);
      return day;
    }
  }
}

describe("registry sync against the LOCAL database", () => {
  let db: SyncDb;
  let admin: { client: SupabaseClient; id: string };
  let member: { client: SupabaseClient; id: string };

  before(async () => {
    const host = new URL(URL_).hostname;
    assert.ok(["127.0.0.1", "localhost"].includes(host), `refusing to run: ${host} is not a local address`);
    assert.ok(PUBLISHABLE && SERVICE, "set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY via .env.local.localdb");
    db = createSyncDb();
    admin = await signedIn("admin@example.test");
    member = await signedIn("member@example.test");
  });

  const names = async (): Promise<string[]> => {
    const { data, error } = await admin.client.from("compliance_names").select("normalized").like("normalized", `%${SUFFIX}%`);
    assert.equal(error, null);
    return (data ?? []).map((r: { normalized: string }) => r.normalized).sort();
  };
  const lastRun = async (id: string) => {
    const { data, error } = await admin.client.from("compliance_sync_runs").select("*").eq("id", id).single();
    assert.equal(error, null);
    return data as Record<string, unknown>;
  };

  test("a full run through the real service-role client succeeds and fills the registry", async () => {
    const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, {
      db,
      sheets: sheets({ Sheet1: { rows: list([CLIENT, LEGAL, FRIENDLY, GROUP]) }, Second: { rows: list([OTHER, E, E, E]) } }),
    });
    assert.equal(r.status, "succeeded", JSON.stringify(r));
    assert.equal(r.closeFailed, false);
    assert.equal((r.counts?.namesNew ?? 0) >= 4, true);
    assert.deepEqual(await names(), [`synctest client ${SUFFIX}`, `synctest client ${SUFFIX} private limited`, `synctest friendly ${SUFFIX}`, `synctest group ${SUFFIX}`, `synctest other ${SUFFIX}`].sort());
    // types are stored per name: the legal name is "legal", the friendly name "friendly", the group "group"
    const types = await admin.client.from("compliance_names").select("normalized, name_types").like("normalized", `%${SUFFIX}%`);
    const typeOf = Object.fromEntries((types.data ?? []).map((r: { normalized: string; name_types: string[] }) => [r.normalized, r.name_types]));
    assert.deepEqual(typeOf[`synctest client ${SUFFIX}`], ["client"]);
    assert.deepEqual(typeOf[`synctest client ${SUFFIX} private limited`], ["legal"]);
    assert.deepEqual(typeOf[`synctest friendly ${SUFFIX}`], ["friendly"]);
    assert.deepEqual(typeOf[`synctest group ${SUFFIX}`], ["group"]);

    const run = await lastRun(r.runId);
    assert.equal(run.status, "succeeded");
    assert.equal(run.snapshot_complete, true);
    assert.equal(run.trigger, "scheduled");
    // run history holds counts, tab titles and codes only: no name from the sheet
    assert.ok(!JSON.stringify(run).toLowerCase().includes("synctest"));
  });

  test("the same sheet again changes nothing (idempotent)", async () => {
    const tabs = { Sheet1: { rows: list([CLIENT, LEGAL, FRIENDLY, GROUP]) }, Second: { rows: list([OTHER, E, E, E]) } } as Record<string, TabRead>;
    const before = await names();
    const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, { db, sheets: sheets(tabs) });
    assert.equal(r.status, "succeeded");
    assert.equal(r.counts?.namesNew, 0);
    assert.deepEqual(await names(), before);
  });

  test("a tab with the wrong layout gives a partial run: good tabs still added, nothing flagged missing", async () => {
    const extra = `Synctest Added ${SUFFIX}`;
    const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, {
      db,
      sheets: sheets({ Sheet1: { rows: list([CLIENT, LEGAL, extra, GROUP]) }, Broken: { rows: [["nothing", "here"]] } }),
    });
    assert.equal(r.status, "partial");
    assert.equal(r.errorCode, "SHEETS_PARSE");
    assert.equal(r.counts?.missingCandidates, 0);
    assert.ok((await names()).includes(`synctest added ${SUFFIX}`));
    const { data } = await admin.client.from("compliance_names").select("status").like("normalized", `%${SUFFIX}%`).eq("status", "pending_removal_review");
    assert.equal((data ?? []).length, 0, "an incomplete snapshot must not flag any name");
    assert.equal((await lastRun(r.runId)).snapshot_complete, false);
  });

  test("a run already in progress blocks the next one, and a failed run is closed so the lock never sticks", async () => {
    const started = await db.beginRun({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() });
    await assert.rejects(
      runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, { db, sheets: sheets({}) }),
      (e: unknown) => e instanceof SyncError && e.code === "RUN_IN_PROGRESS",
    );
    await db.finishRun({ runId: started.runId, status: "failed", tabsDiscovered: 0, tabsScanned: 0, tabsFailed: 0, tabReport: [], anomalies: [], errorCode: "UNKNOWN", errorSummary: "test" });
    // a Google failure still closes its own run
    const failing: SheetsClient = { listTabs: async () => { throw new SyncError("SHEETS_AUTH"); }, readTabs: async () => new Map() };
    const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, { db, sheets: failing });
    assert.equal(r.status, "failed");
    const run = await lastRun(r.runId);
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "SHEETS_AUTH");
    assert.notEqual(run.finished_at, null);
    // and the lock is free again
    const next = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: uniqueDay() }, { db, sheets: sheets({ Sheet1: { rows: list([CLIENT, LEGAL, FRIENDLY, GROUP]) } }) });
    assert.notEqual(next.status, "failed");
  });

  test("a manual run needs the administrator who started it", async () => {
    await assert.rejects(db.beginRun({ trigger: "manual", triggeredBy: null, scheduledFor: null }), (e: unknown) => e instanceof SyncError && e.code === "DB_ERROR");
  });
});

describe("who can NOT run or read the sync", () => {
  let admin: { client: SupabaseClient; id: string };
  let member: { client: SupabaseClient; id: string };
  before(async () => {
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(URL_).hostname));
    admin = await signedIn("admin@example.test");
    member = await signedIn("member@example.test");
  });

  const sync = { p_trigger: "scheduled", p_triggered_by: null, p_scheduled_for: "2098-01-01" };

  test("a signed-in employee and even an administrator cannot call the sync functions", async () => {
    for (const who of [member, admin]) {
      const a = await who.client.rpc("compliance_begin_run", sync);
      assert.equal(a.error?.code, "42501", "begin_run");
      const b = await who.client.rpc("compliance_apply_snapshot", { p_run_id: "00000000-0000-0000-0000-000000000000", p_snapshot: { complete: false, names: [] } });
      assert.equal(b.error?.code, "42501", "apply_snapshot");
      const c = await who.client.rpc("compliance_registry_names");
      assert.equal(c.error?.code, "42501", "registry_names");
    }
  });

  test("anon cannot call them either", async () => {
    const anon = plain(PUBLISHABLE);
    assert.notEqual((await anon.rpc("compliance_begin_run", sync)).error, null);
    assert.notEqual((await anon.rpc("compliance_registry_names")).error, null);
  });

  test("an employee sees no registry, no runs; an administrator sees runs but cannot write them", async () => {
    const names = await member.client.from("compliance_names").select("id");
    assert.equal((names.data ?? []).length, 0);
    assert.equal(((await member.client.from("compliance_sync_runs").select("id")).data ?? []).length, 0);
    const w = await admin.client.from("compliance_sync_runs").insert({ trigger: "manual" });
    assert.equal(w.error?.code, "42501");
    const d = await admin.client.from("compliance_names").delete().neq("normalized", "");
    assert.equal(d.error?.code, "42501");
  });

  test("the service key itself has no table access: it can only run the sync functions", async () => {
    const svc = plain(SERVICE);
    for (const table of ["compliance_names", "compliance_name_sources", "compliance_sync_runs", "compliance_settings"]) {
      const r = await svc.from(table).select("*").limit(1);
      assert.equal(r.error?.code, "42501", table);
    }
    assert.equal((await svc.from("compliance_names").delete().neq("normalized", "")).error?.code, "42501");
  });

  test("only an administrator can review a name", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const asMember = await member.client.rpc("compliance_review_name", { p_name_id: id, p_decision: "keep", p_note: null });
    assert.equal(asMember.error?.code, "42501");
    const asAdmin = await admin.client.rpc("compliance_review_name", { p_name_id: id, p_decision: "keep", p_note: null });
    assert.equal(asAdmin.error?.code, "P0002", "an admin gets past the role check and only fails on the unknown name");
  });
});

describe("the registry as the profile check and the scheduler read it", () => {
  let db: SyncDb;
  let admin: { client: SupabaseClient; id: string };
  const FRIENDLY2 = `Synctest Fr ${SUFFIX}`;
  const CLIENT2 = `Synctest Reg ${SUFFIX}`;
  let day: string;

  before(async () => {
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(URL_).hostname), "refusing to run on a non-local address");
    db = createSyncDb();
    admin = await signedIn("admin@example.test");
    day = uniqueDay();
    const r = await runSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: day }, { db, sheets: sheets({ Sheet1: { rows: list([CLIENT2, E, FRIENDLY2, E]) } }) });
    assert.equal(r.status, "succeeded", JSON.stringify(r));
  });

  test("the service key reads the enforced names (with their types); deactivated names drop out, reactivated ones return", async () => {
    const source = createRegistrySource();
    // other tests of this run left names behind (pending review names stay enforced), so look only at this test's two
    const mine = async () => (await source.fetchNames()).filter((n) => n.name === CLIENT2 || n.name === FRIENDLY2);
    const found = await mine();
    assert.deepEqual(found.map((n) => n.name).sort(), [CLIENT2, FRIENDLY2].sort());
    assert.deepEqual(found.find((n) => n.name === CLIENT2)?.types, ["client"]);
    assert.deepEqual(found.find((n) => n.name === FRIENDLY2)?.types, ["friendly"]);

    const id = (await admin.client.from("compliance_names").select("id").eq("normalized", FRIENDLY2.toLowerCase()).single()).data?.id as string;
    assert.equal((await admin.client.rpc("compliance_review_name", { p_name_id: id, p_decision: "deactivate", p_note: "test" })).error, null);
    assert.deepEqual((await mine()).map((n) => n.name), [CLIENT2]);
    assert.equal((await admin.client.rpc("compliance_review_name", { p_name_id: id, p_decision: "reactivate", p_note: null })).error, null);
    assert.equal((await mine()).length, 2);
  });

  test("the real registry drives the real gate: a profile naming a registered client is refused, a clean one passes", async () => {
    const names = await createRegistrySource().fetchNames();
    const getMatcher = async () => buildMatcher(names);
    const profile = { ...(blankResume("internal") as InternalResume) };
    profile.overview = `Built the platform for ${CLIENT2}, reducing manual effort.`;
    const refused = await gateResponse(profile, { mode: "on", getMatcher });
    assert.ok(refused);
    assert.equal(refused.status, 422);
    const body = (await refused.json()) as { error: { code: string; matches: { path: string; matchedText: string }[] } };
    assert.equal(body.error.code, "COMPLIANCE");
    assert.deepEqual(body.error.matches.map((m) => [m.path, m.matchedText]), [["overview", CLIENT2]]);
    profile.overview = "Built the platform for a large insurer, reducing manual effort.";
    assert.equal(await gateResponse(profile, { mode: "on", getMatcher }), null);
  });

  test("the scheduler state shows the settings and the latest run of the day, with no names", async () => {
    const st = await createSchedulerSource().state(day);
    assert.ok(st);
    assert.deepEqual(st.schedule_days, [5, 20]);
    assert.equal(st.max_attempts, 4);
    assert.equal(st.last_run_for_day?.status, "succeeded");
    assert.equal(st.last_run_for_day?.attempt, 1);
    assert.ok(st.last_success_at);
    assert.ok(!JSON.stringify(st).toLowerCase().includes("synctest"));
    assert.equal((await createSchedulerSource().state("2098-02-02"))?.last_run_for_day, null);
  });
});
