/**
 * Purpose: what the administrator's registry page reads: the latest synchronisation runs, the settings, the counts and the
 * names waiting for a decision. It runs as the signed-in user, so the database's row level security decides: only an
 * administrator gets rows back (everyone else gets nothing). No service key. Pure given a client, so it can be tested with one.
 * Run history holds counts, tab titles and codes only; the names listed are the ones an administrator must decide about.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RunRow = {
  id: string;
  trigger: "scheduled" | "manual";
  attempt: number;
  status: "running" | "succeeded" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  tabs_discovered: number;
  tabs_scanned: number;
  tabs_failed: number;
  names_new: number;
  names_updated: number;
  occurrences_seen: number;
  missing_candidates: number;
  snapshot_complete: boolean;
  error_code: string | null;
  error_summary: string | null;
  tab_report: { tab: string; status: string; entries: number }[];
};

export type PendingName = { id: string; display_name: string; name_types: string[]; missing_since: string | null };

export type SettingsRow = { schedule_days: number[]; max_attempts: number; stale_after_days: number };

export type ComplianceOverview = {
  settings: SettingsRow | null;
  runs: RunRow[];
  lastSuccessAt: string | null;
  counts: { active: number; pending: number; deactivated: number };
  pending: PendingName[];
};

const RUN_COLUMNS =
  "id, trigger, attempt, status, started_at, finished_at, tabs_discovered, tabs_scanned, tabs_failed, names_new, names_updated, occurrences_seen, missing_candidates, snapshot_complete, error_code, error_summary, tab_report";

export async function getComplianceOverviewAs(supabase: SupabaseClient): Promise<ComplianceOverview> {
  const count = async (status: string): Promise<number> => {
    const { count: n, error } = await supabase.from("compliance_names").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error("COMPLIANCE_READ_FAILED");
    return n ?? 0;
  };

  const [settings, runs, success, pending, active, pendingCount, deactivated] = await Promise.all([
    supabase.from("compliance_settings").select("schedule_days, max_attempts, stale_after_days").maybeSingle(),
    supabase.from("compliance_sync_runs").select(RUN_COLUMNS).order("started_at", { ascending: false }).limit(10),
    supabase.from("compliance_sync_runs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1),
    supabase.from("compliance_names").select("id, display_name, name_types, missing_since").eq("status", "pending_removal_review").order("missing_since", { ascending: true }).limit(200),
    count("active"),
    count("pending_removal_review"),
    count("deactivated"),
  ]);
  for (const r of [settings, runs, success, pending]) if (r.error) throw new Error("COMPLIANCE_READ_FAILED");

  return {
    settings: (settings.data as SettingsRow | null) ?? null,
    runs: (runs.data ?? []) as RunRow[],
    lastSuccessAt: ((success.data ?? [])[0] as { finished_at: string | null } | undefined)?.finished_at ?? null,
    counts: { active, pending: pendingCount, deactivated },
    pending: (pending.data ?? []) as PendingName[],
  };
}
