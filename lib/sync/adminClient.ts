/**
 * Purpose: the ONLY place in the application that reads SUPABASE_SERVICE_ROLE_KEY (lib/syncSecurity.test.ts enforces
 * this by scanning the source). It gives the sync runner the three database functions it needs and nothing else:
 * it never uses `.from()`, so it cannot read or edit any table directly. Besides the sync it exposes two read-only calls: the names the
 * profile check enforces, and the scheduler's settings. What it may change is decided by the
 * security-definer functions of supabase/migrations/20261023120100_compliance_rpcs.sql, which only service_role can run.
 * Server-only. The key is never logged, never sent to the browser and never part of an error message.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RegistryName } from "../compliance/match";
import { SyncError } from "./errors";
import type { ApplyResult, BeginRunInput, FinishRunInput, RegistrySource, SchedulerSource, SchedulerState, SnapshotPayload, SyncDb } from "./types";

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) throw new SyncError("CONFIG", "NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!key) throw new SyncError("CONFIG", "SUPABASE_SERVICE_ROLE_KEY is not set.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Database errors become our codes. The text from the database is dropped: it can contain names. */
function dbError(error: { code?: string } | null): SyncError {
  switch (error?.code) {
    case "55006":
      return new SyncError("RUN_IN_PROGRESS");
    case "54000":
      return new SyncError("RUN_LIMIT");
    default:
      return new SyncError("DB_ERROR");
  }
}

export function createSyncDb(client: SupabaseClient = serviceClient()): SyncDb {
  return {
    async beginRun(input: BeginRunInput) {
      const { data, error } = await client.rpc("compliance_begin_run", {
        p_trigger: input.trigger,
        p_triggered_by: input.triggeredBy,
        p_scheduled_for: input.scheduledFor,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.run_id) throw dbError(error);
      return { runId: String(row.run_id), attempt: Number(row.attempt) };
    },

    async applySnapshot(runId: string, snapshot: SnapshotPayload): Promise<ApplyResult> {
      const { data, error } = await client.rpc("compliance_apply_snapshot", { p_run_id: runId, p_snapshot: snapshot });
      if (error || !data) throw dbError(error);
      return data as ApplyResult;
    },

    async finishRun(input: FinishRunInput) {
      const { error } = await client.rpc("compliance_finish_run", {
        p_run_id: input.runId,
        p_status: input.status,
        p_tabs_discovered: input.tabsDiscovered,
        p_tabs_scanned: input.tabsScanned,
        p_tabs_failed: input.tabsFailed,
        p_tab_report: input.tabReport,
        p_anomalies: input.anomalies,
        p_error_code: input.errorCode,
        p_error_summary: input.errorSummary,
      });
      if (error) throw dbError(error);
    },
  };
}

/** The names the profile check enforces. Read through compliance_registry_names(): employees cannot call it, only this key can. */
export function createRegistrySource(client: SupabaseClient = serviceClient()): RegistrySource {
  return {
    async fetchNames(): Promise<RegistryName[]> {
      const { data, error } = await client.rpc("compliance_registry_names");
      if (error || !Array.isArray(data)) throw dbError(error);
      return (data as { id: string; name: string; types: string[] }[]).map((r) => ({ id: r.id, name: r.name, types: r.types as RegistryName["types"] }));
    },
  };
}

/** Settings and the latest run of a day, for the scheduled job. */
export function createSchedulerSource(client: SupabaseClient = serviceClient()): SchedulerSource {
  return {
    async state(day: string): Promise<SchedulerState | null> {
      const { data, error } = await client.rpc("compliance_scheduler_state", { p_day: day });
      if (error) throw dbError(error);
      return (data as SchedulerState | null) ?? null;
    },
  };
}
