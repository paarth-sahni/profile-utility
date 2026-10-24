import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as adminReviewPOST } from "../app/api/admin/compliance/review/route";
import { POST as adminSyncPOST } from "../app/api/admin/sync/route";
import { POST as internalSyncPOST } from "../app/api/internal/sync/route";
import { canAdministerRegistry } from "./authRules";
import { keyAgeMonths, registryHealth } from "./sync/health";
import { dayInTimezone, decideScheduledRun, isDirectCall, secretMatches } from "./sync/scheduler";
import type { SchedulerState } from "./sync/types";

const state = (over: Partial<SchedulerState> = {}): SchedulerState => ({
  schedule_days: [5, 20],
  max_attempts: 4,
  stale_after_days: 20,
  last_run_for_day: null,
  last_success_at: null,
  ...over,
});

test("dayInTimezone: the date in the chosen zone, not the server's", () => {
  // 19:00 UTC on the 4th is already 00:30 on the 5th in India
  const now = new Date("2026-11-04T19:00:00Z");
  assert.deepEqual(dayInTimezone(now, "Asia/Kolkata"), { iso: "2026-11-05", dayOfMonth: 5 });
  assert.deepEqual(dayInTimezone(now, "UTC"), { iso: "2026-11-04", dayOfMonth: 4 });
  assert.equal(dayInTimezone(now, "Not/AZone").iso, "2026-11-05", "a bad zone name falls back to the default zone");
});

test("scheduled run: only on a schedule day from the settings", () => {
  const ist = (iso: string) => new Date(`${iso}T06:00:00Z`); // late morning in India
  assert.equal(decideScheduledRun(state(), ist("2026-11-04")).run, false);
  assert.equal(decideScheduledRun(state(), ist("2026-11-04")).reason, "not a scheduled day");
  assert.deepEqual(decideScheduledRun(state(), ist("2026-11-05")), { run: true, day: "2026-11-05", reason: "no run yet for this day" });
  assert.equal(decideScheduledRun(state(), ist("2026-11-20")).run, true);
  // the days are data, not code: change the setting and the next day follows
  assert.equal(decideScheduledRun(state({ schedule_days: [7] }), ist("2026-11-05")).run, false);
  assert.equal(decideScheduledRun(state({ schedule_days: [7] }), ist("2026-11-07")).run, true);
  // no settings row yet: the defaults apply (5th and 20th)
  assert.equal(decideScheduledRun(null, ist("2026-11-05")).run, true);
  assert.equal(decideScheduledRun(null, ist("2026-11-06")).run, false);
});

test("scheduled run: success ends the day, failures wait and retry within the limit, people are asked when it cannot help", () => {
  const now = new Date("2026-11-05T06:30:00Z");
  const last = (o: object) => state({ last_run_for_day: { status: "failed", attempt: 1, finished_at: "2026-11-05T06:00:00Z", error_code: "SHEETS_UNAVAILABLE", ...o } as SchedulerState["last_run_for_day"] });
  assert.equal(decideScheduledRun(last({ status: "succeeded", error_code: null }), now).run, false);
  assert.equal(decideScheduledRun(last({}), now).run, true, "30 minutes after a failure that waits 1 minute");
  assert.equal(decideScheduledRun(last({ finished_at: "2026-11-05T06:29:50Z" }), now).run, false, "too soon");
  assert.equal(decideScheduledRun(last({ attempt: 4 }), now).run, false, "retry limit");
  assert.equal(decideScheduledRun(last({ error_code: "SHEETS_AUTH" }), now).run, false, "wrong credentials need a person");
  assert.equal(decideScheduledRun(last({ status: "running", finished_at: null, error_code: null }), now).run, false);
  assert.equal(decideScheduledRun(state({ max_attempts: 1, last_run_for_day: { status: "failed", attempt: 1, finished_at: "2026-11-05T06:00:00Z", error_code: "SHEETS_UNAVAILABLE" } }), now).run, false, "limit from the settings");
});

test("secretMatches: only the exact secret, constant time, nothing when unset", () => {
  assert.equal(secretMatches("correct-horse", "correct-horse"), true);
  assert.equal(secretMatches("correct-horse ", "correct-horse"), false);
  assert.equal(secretMatches("", "correct-horse"), false);
  assert.equal(secretMatches(null, "correct-horse"), false);
  assert.equal(secretMatches("anything", undefined), false);
  assert.equal(secretMatches("anything", ""), false);
  assert.equal(secretMatches("", ""), false, "an empty secret never matches an empty header");
});

test("isDirectCall: a request through the web server (forwarding headers) is refused", () => {
  assert.equal(isDirectCall(new Headers({ "x-sync-secret": "s" })), true);
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded"]) assert.equal(isDirectCall(new Headers({ [h]: "1.2.3.4" })), false, h);
});

test("registry health: never, ok, failing, stale", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  assert.equal(registryHealth({ lastSuccessAt: null, latestRunStatus: null, staleAfterDays: 20, now }).level, "never");
  assert.equal(registryHealth({ lastSuccessAt: "2026-11-20T03:00:00Z", latestRunStatus: "succeeded", staleAfterDays: 20, now }).level, "ok");
  assert.match(registryHealth({ lastSuccessAt: "2026-11-20T03:00:00Z", latestRunStatus: "succeeded", staleAfterDays: 20, now }).message, /today/);
  assert.equal(registryHealth({ lastSuccessAt: "2026-11-15T03:00:00Z", latestRunStatus: "failed", staleAfterDays: 20, now }).level, "failing");
  assert.equal(registryHealth({ lastSuccessAt: "2026-11-15T03:00:00Z", latestRunStatus: "partial", staleAfterDays: 20, now }).level, "failing");
  assert.equal(registryHealth({ lastSuccessAt: "2026-10-01T03:00:00Z", latestRunStatus: "succeeded", staleAfterDays: 20, now }).level, "stale");
  assert.equal(registryHealth({ lastSuccessAt: "2026-10-01T03:00:00Z", latestRunStatus: "failed", staleAfterDays: 20, now }).level, "stale", "stale wins over failing");
});

test("key age: months from GOOGLE_SA_KEY_CREATED, nothing when unset or invalid", () => {
  const now = new Date("2027-10-24T00:00:00Z");
  assert.equal(keyAgeMonths("2026-10-24", now), 12);
  assert.equal(keyAgeMonths("2027-09-01", now), 1);
  assert.equal(keyAgeMonths(undefined, now), null);
  assert.equal(keyAgeMonths("last year", now), null);
});

test("only an administrator may run or review: managers, checkers and team members may not", () => {
  assert.equal(canAdministerRegistry("admin"), true);
  for (const r of ["manager", "checker", "team_member", "", null, undefined, "ADMIN"]) assert.equal(canAdministerRegistry(r), false, String(r));
});

const post = (path: string, headers: Record<string, string> = {}, body = "{}") =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("admin routes without a session answer 401 and do nothing", async () => {
  const sync = await adminSyncPOST();
  assert.equal(sync.status, 401);
  const review = await adminReviewPOST(post("/api/admin/compliance/review", {}, JSON.stringify({ nameId: "x", decision: "keep" })));
  assert.equal(review.status, 401);
  assert.equal(((await review.json()) as { error: { code: string } }).error.code, "UNAUTHENTICATED");
});

test("scheduled route: not configured, through the web server, or with a wrong secret -> refused before anything runs", async () => {
  const saved = process.env.SYNC_CRON_SECRET;
  try {
    delete process.env.SYNC_CRON_SECRET;
    assert.equal((await internalSyncPOST(post("/api/internal/sync", { "x-sync-secret": "s" }))).status, 503);

    process.env.SYNC_CRON_SECRET = "right-secret";
    assert.equal((await internalSyncPOST(post("/api/internal/sync", { "x-sync-secret": "right-secret", "x-forwarded-for": "8.8.8.8" }))).status, 403, "even with the right secret");
    assert.equal((await internalSyncPOST(post("/api/internal/sync", { "x-sync-secret": "wrong" }))).status, 401);
    assert.equal((await internalSyncPOST(post("/api/internal/sync"))).status, 401);
    const wrong = await internalSyncPOST(post("/api/internal/sync", { "x-sync-secret": "wrong" }));
    assert.ok(!JSON.stringify(await wrong.json()).includes("right-secret"));
  } finally {
    if (saved === undefined) delete process.env.SYNC_CRON_SECRET;
    else process.env.SYNC_CRON_SECRET = saved;
  }
});
