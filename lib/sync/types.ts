/**
 * Purpose: the shape of the database side of a synchronisation, kept apart from the Supabase client so the runner can be
 * tested with a fake and never needs the service key itself. The real implementation is lib/sync/adminClient.ts. Pure types.
 */
import type { RegistryName } from "../compliance/match";
import type { SnapshotName } from "./buildSnapshot";

export type RunTrigger = "scheduled" | "manual";
export type FinalStatus = "succeeded" | "partial" | "failed";

export type BeginRunInput = {
  trigger: RunTrigger;
  /** The administrator who started a manual run (required for manual, null for scheduled). */
  triggeredBy: string | null;
  /** The day a scheduled run is for, "YYYY-MM-DD" (null for manual). */
  scheduledFor: string | null;
};

export type SnapshotPayload = { complete: boolean; names: SnapshotName[] };

export type ApplyResult = {
  names_new: number;
  names_updated: number;
  occurrences: number;
  missing_candidates: number;
  complete: boolean;
  seen_again_but_deactivated: number;
};

export type FinishRunInput = {
  runId: string;
  status: FinalStatus;
  tabsDiscovered: number;
  tabsScanned: number;
  tabsFailed: number;
  tabReport: unknown[];
  anomalies: unknown[];
  errorCode: string | null;
  errorSummary: string | null;
};

export type SyncDb = {
  beginRun: (input: BeginRunInput) => Promise<{ runId: string; attempt: number }>;
  applySnapshot: (runId: string, snapshot: SnapshotPayload) => Promise<ApplyResult>;
  finishRun: (input: FinishRunInput) => Promise<void>;
};

/** The names the profile check enforces (active and pending review, never deactivated). */
export type RegistrySource = { fetchNames: () => Promise<RegistryName[]> };

export type SchedulerState = {
  schedule_days: number[];
  max_attempts: number;
  stale_after_days: number;
  last_run_for_day: { status: "running" | "succeeded" | "partial" | "failed"; attempt: number; finished_at: string | null; error_code: string | null } | null;
  last_success_at: string | null;
};

/** Settings and the day's latest run, for the scheduled job. */
export type SchedulerSource = { state: (day: string) => Promise<SchedulerState | null> };
