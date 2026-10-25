/**
 * Purpose: POST /api/admin/sync — an administrator starts a synchronisation of the client-name registry from the Google Sheet.
 * Administrators ONLY (checked here from the role in the database, not from the JWT; managers and checkers get 403), rate-limited,
 * and the database adds its own limits (one run at a time, a 5-minute cooldown between manual runs). It runs the SAME pipeline as
 * the scheduled job (lib/sync/runner.ts). Answers with counts, tab titles and codes only; never a cell value, the spreadsheet id
 * or a key. The start is audited with the administrator's id by the database.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAdministerRegistry } from "@/lib/authRules";
import { resetRegistryCache } from "@/lib/compliance/registry";
import { SyncError } from "@/lib/sync/errors";
import { runConfiguredSync, summarizeRun } from "@/lib/sync/runner";
import { allowRequest } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!canAdministerRegistry(user.role)) return err(403, "FORBIDDEN", "Only an administrator can start a synchronisation.");
  if (!allowRequest(`registry-sync:${user.id}`, 3, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "Too many synchronisations were started. Please wait a few minutes.");
  }

  try {
    const result = await runConfiguredSync({ trigger: "manual", triggeredBy: user.id, scheduledFor: null });
    if (result.status === "succeeded") resetRegistryCache(); // the new names are enforced at once, not after the cache window
    return NextResponse.json(summarizeRun(result));
  } catch (e) {
    if (e instanceof SyncError) {
      if (e.code === "RUN_IN_PROGRESS") return err(409, e.code, e.message);
      if (e.code === "RUN_LIMIT") return err(429, e.code, "A manual synchronisation was started less than 5 minutes ago. Please wait a moment.");
      console.error(`[registry-sync] manual run refused (${e.code})`);
      return err(500, e.code, e.message); // our own fixed text (a missing setting names the variable only)
    }
    console.error("[registry-sync] manual run failed unexpectedly");
    return err(500, "UNKNOWN", "The synchronisation failed for an unexpected reason.");
  }
}
