/**
 * Purpose: the ONE entry point that routes use to run a synchronisation with the real Google Sheet and the real database.
 * The administrator's button and the scheduled job both call `runConfiguredSync`, so there is a single pipeline (runSync).
 * Server-only. Reads the Google settings from the environment (lib/sync/config.ts) and the database through the service-role
 * client in lib/sync/adminClient.ts, the only code that holds that key.
 */
import "server-only";
import { createSchedulerSource, createSyncDb } from "./adminClient";
import { loadSheetsConfig } from "./config";
import { runSync, type RunResult } from "./runSync";
import { createSheetsClient } from "./sheetsClient";
import type { BeginRunInput, SchedulerState } from "./types";

/** One synchronisation attempt. A refused start (already running, cooldown, retry limit) throws a SyncError. */
export async function runConfiguredSync(input: BeginRunInput): Promise<RunResult> {
  const config = loadSheetsConfig();
  return runSync(input, { sheets: createSheetsClient(config), db: createSyncDb(), tabNames: config.tabNames });
}

/** The settings and the latest run of a day, for the scheduled job. */
export const readSchedulerState = (day: string): Promise<SchedulerState | null> => createSchedulerSource().state(day);

/** What routes send back about a run: counts, tab titles and codes only, never a cell value. */
export function summarizeRun(r: RunResult) {
  return {
    runId: r.runId,
    attempt: r.attempt,
    status: r.status,
    errorCode: r.errorCode,
    counts: r.counts,
    tabs: r.tabs,
    ignoredTabs: r.ignoredTabs,
    closeFailed: r.closeFailed,
  };
}
