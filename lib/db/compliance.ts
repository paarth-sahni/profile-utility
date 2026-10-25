/**
 * Purpose: server-side wrapper for the administrator's registry page: builds a user-session client (so row level security
 * applies) and delegates to ./complianceCore.ts. Server-only.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getComplianceOverviewAs, type ComplianceOverview } from "./complianceCore";

export type { ComplianceOverview, PendingName, RunRow, SettingsRow } from "./complianceCore";

export async function getComplianceOverview(): Promise<ComplianceOverview> {
  return getComplianceOverviewAs(await createSupabaseServerClient());
}
