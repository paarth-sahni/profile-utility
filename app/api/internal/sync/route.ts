/**
 * Purpose: POST /api/internal/sync — what the timer on this machine calls every 30 minutes (ops/profile-sync.timer). It starts a
 * SCHEDULED synchronisation only when today (in SYNC_TIMEZONE) is one of the schedule days in the database settings (the 5th and
 * 20th by default) and a first try or a retry is due; otherwise it answers 200 { ran: false } without touching Google.
 * Not in the sign-in proxy (there is no user), so it protects itself: a shared secret (SYNC_CRON_SECRET, constant-time compare),
 * and it refuses anything that came through the web server (forwarding headers), which also blocks this path. It uses the same
 * pipeline as the administrator's button (lib/sync/runner.ts). Answers with counts, tab titles and codes only.
 */
import { NextResponse } from "next/server";
import { resetRegistryCache } from "@/lib/compliance/registry";
import { SyncError } from "@/lib/sync/errors";
import { readSchedulerState, runConfiguredSync, summarizeRun } from "@/lib/sync/runner";
import { DEFAULT_TIMEZONE, dayInTimezone, decideScheduledRun, isDirectCall, secretMatches } from "@/lib/sync/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

export async function POST(request: Request) {
  const expected = process.env.SYNC_CRON_SECRET?.trim();
  if (!expected) return reply(503, { error: { code: "NOT_CONFIGURED", message: "The scheduled synchronisation is not configured (SYNC_CRON_SECRET is not set)." } });
  if (!isDirectCall(request.headers)) return reply(403, { error: { code: "FORBIDDEN", message: "This endpoint is only for the scheduler on the server itself." } });
  if (!secretMatches(request.headers.get("x-sync-secret"), expected)) return reply(401, { error: { code: "UNAUTHENTICATED", message: "Missing or wrong secret." } });

  const now = new Date();
  const timeZone = process.env.SYNC_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    const today = dayInTimezone(now, timeZone);
    const decision = decideScheduledRun(await readSchedulerState(today.iso), now, timeZone);
    if (!decision.run) return reply(200, { ran: false, day: decision.day, reason: decision.reason });

    const result = await runConfiguredSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: decision.day });
    if (result.status === "succeeded") resetRegistryCache();
    console.log(`[registry-sync] scheduled run for ${decision.day}: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}`);
    return reply(200, { ran: true, day: decision.day, ...summarizeRun(result) });
  } catch (e) {
    if (e instanceof SyncError) {
      // another run is going or the day is already done: not a failure of the timer
      if (e.code === "RUN_IN_PROGRESS" || e.code === "RUN_LIMIT") return reply(200, { ran: false, reason: e.code });
      console.error(`[registry-sync] scheduled run could not start (${e.code})`);
      return reply(500, { error: { code: e.code, message: e.message } });
    }
    console.error("[registry-sync] scheduled run failed unexpectedly");
    return reply(500, { error: { code: "UNKNOWN", message: "The synchronisation failed for an unexpected reason." } });
  }
}
