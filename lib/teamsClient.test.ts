/** Purpose: unit tests for lib/teamsClient.ts: the real ops/teams_db.py in mock mode (fictional employees), and fake runners. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTeamsClient, type Runner } from "./teamsClient";

test("the real script in mock mode: lookups, team, reportees, units", async () => {
  process.env.TEAMS_DB_MODE = "mock";
  try {
    const t = createTeamsClient();
    const member = await t.byEmail("Member@Example.test");
    assert.ok(member.ok && member.data);
    assert.equal(member.data.ibCode, "IB9003");
    assert.equal(member.data.managerEmail, "lead@example.test");
    const lead = await t.byIbCode("ib9002");
    assert.ok(lead.ok && lead.data?.email === "lead@example.test");
    const nobody = await t.byIbCode("IB0000");
    assert.deepEqual(nobody, { ok: true, data: null });
    const team = await t.team("manager@example.test");
    assert.ok(team.ok);
    assert.ok(team.data.some((e) => e.email === "member@example.test"), "an indirect reportee");
    assert.ok(team.data.some((e) => e.ibCode === null), "one person without an IB code");
    assert.deepEqual(await t.hasReportees("lead@example.test"), { ok: true, data: true });
    assert.deepEqual(await t.hasReportees("member@example.test"), { ok: true, data: false });
    assert.deepEqual(await t.units(), { ok: true, data: { deliveryUnits: ["Delivery Unit Alpha", "Delivery Unit Beta"], departments: ["Engineering", "Quality Assurance"] } });
    const all = await t.all();
    assert.ok(all.ok && !all.data.some((e) => e.email === "ex.employee@example.test"), "people who have left are never returned");
  } finally {
    delete process.env.TEAMS_DB_MODE;
  }
});

const PERSON = { ib_code: "IB1", email: "a@example.test", name: "Fictional A", role: "Dev", delivery_unit: "U", department: "D", manager_email: null };

test("answers are cached for 10 minutes, shared while in flight, failures are not cached", async () => {
  let clock = 0;
  const calls: string[][] = [];
  let fail = false;
  const run: Runner = async (args) => {
    calls.push(args);
    if (fail) throw new Error("connect_failed");
    return JSON.stringify(PERSON);
  };
  const t = createTeamsClient({ run, now: () => clock });
  const [a, b] = await Promise.all([t.byEmail("a@example.test"), t.byEmail("A@example.test")]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1, "one run for two calls at once");
  clock += 9 * 60 * 1000;
  await t.byEmail("a@example.test");
  assert.equal(calls.length, 1, "cached for 10 minutes");
  clock += 2 * 60 * 1000;
  fail = true;
  assert.deepEqual(await t.byEmail("a@example.test"), { ok: false, error: "connect_failed" });
  assert.deepEqual(await t.byEmail("a@example.test"), { ok: false, error: "connect_failed" });
  assert.equal(calls.length, 3, "a failure is retried next time, not cached");
});

test("arguments are validated before anything runs; bad output and error answers are failures", async () => {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    return args[0] === "units" ? "not json" : JSON.stringify({ error: "query_failed" });
  };
  const t = createTeamsClient({ run });
  for (const r of [await t.byEmail("x; rm -rf /"), await t.byIbCode("IB1 --drop"), await t.team(""), await t.hasReportees("no-at-sign")]) assert.deepEqual(r, { ok: false, error: "bad_arguments" });
  assert.equal(calls.length, 0);
  assert.deepEqual(await t.units(), { ok: false, error: "bad_output" });
  assert.deepEqual(await t.all(), { ok: false, error: "query_failed" });
});

test("malformed rows are dropped, never trusted", async () => {
  const run: Runner = async () => JSON.stringify([PERSON, { email: "not an email" }, null, { ...PERSON, email: "b@example.test", ib_code: "IB2; drop" }]);
  const r = await createTeamsClient({ run }).all();
  assert.ok(r.ok);
  assert.deepEqual(r.data.map((e) => [e.email, e.ibCode]), [["a@example.test", "IB1"], ["b@example.test", null]]);
});

test("a script that hangs times out, and the child gets no non-Teams secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teams-client-"));
  const slow = path.join(dir, "slow.py");
  fs.writeFileSync(slow, "import time\ntime.sleep(10)\n");
  const envDump = path.join(dir, "env.py");
  fs.writeFileSync(envDump, "import json, os\nextra = [k for k in os.environ if not k.startswith('TEAMS_') and k not in ('PATH','LANG','LC_ALL','HOME','SYSTEMROOT','LC_CTYPE','PWD','SHLVL','_')]\nprint(json.dumps({'error': 'env_extra' if extra else 'env_clean'}))\nraise SystemExit(1)\n");
  const old = process.env.TEAMS_DB_SCRIPT;
  try {
    process.env.TEAMS_DB_SCRIPT = slow;
    const started = Date.now();
    assert.deepEqual(await createTeamsClient({ timeoutMs: 300 }).units(), { ok: false, error: "timeout" });
    assert.ok(Date.now() - started < 3000);
    process.env.TEAMS_DB_SCRIPT = envDump;
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "fake-for-test";
    // the script reports how many variables it got besides the allowed ones: none
    assert.deepEqual(await createTeamsClient().units(), { ok: false, error: "env_clean" });
  } finally {
    if (old === undefined) delete process.env.TEAMS_DB_SCRIPT;
    else process.env.TEAMS_DB_SCRIPT = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
