/**
 * Purpose: /admin/compliance — the administrator's view of the client-name registry: is it up to date, when it last ran, what
 * the last runs did (counts, tab titles and codes only), the names that have disappeared from the sheet and need a decision, and a
 * "Synchronise now" button. Administrators only: other roles see an access-denied view and the data and routes refuse them too.
 * The names listed are the ones awaiting a decision; run history never contains cell values.
 */
import type { Metadata } from "next";
import AdminAccessDenied from "@/components/AdminAccessDenied";
import PageHero from "@/components/PageHero";
import ReviewNameButtons from "@/components/admin/ReviewNameButtons";
import SyncNowButton from "@/components/admin/SyncNowButton";
import { requireAdmin } from "@/lib/auth";
import { getComplianceOverview, type ComplianceOverview } from "@/lib/db/compliance";
import { complianceMode } from "@/lib/compliance/gate";
import { keyAgeMonths, registryHealth } from "@/lib/sync/health";

export const metadata: Metadata = { title: "Client-name registry — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const LEVEL_STYLE = {
  ok: "border-green-200 bg-green-50 text-green-800",
  never: "border-amber-300 bg-warm text-amber-900",
  stale: "border-brand-200 bg-brand-50 text-brand-700",
  failing: "border-amber-300 bg-warm text-amber-900",
} as const;

export default async function AdminCompliancePage() {
  const admin = await requireAdmin();
  if (!admin) return <AdminAccessDenied />;

  let overview: ComplianceOverview | null = null;
  try {
    overview = await getComplianceOverview();
  } catch {
    console.error("[admin] could not read the registry overview");
  }

  const enforcing = complianceMode() === "on";
  const keyAge = keyAgeMonths(process.env.GOOGLE_SA_KEY_CREATED);

  return (
    <div className="w-full text-ink">
      <PageHero title="Client-name registry" subtitle="Synchronised from the InfoBeans Client List. Profiles may not name a registered client." compact />
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-10 pt-5">
        {!overview ? (
          <p className="border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
            We could not read the registry. Check that the compliance database migrations were applied, then reload.
          </p>
        ) : (
          <Body overview={overview} enforcing={enforcing} keyAge={keyAge} />
        )}
      </main>
    </div>
  );
}

function Body({ overview, enforcing, keyAge }: { overview: ComplianceOverview; enforcing: boolean; keyAge: number | null }) {
  const latest = overview.runs[0] ?? null;
  const health = registryHealth({
    lastSuccessAt: overview.lastSuccessAt,
    latestRunStatus: latest?.status ?? null,
    staleAfterDays: overview.settings?.stale_after_days ?? 20,
  });

  return (
    <>
      <div className={`border p-4 text-sm ${LEVEL_STYLE[health.level]}`} role="status">
        <p className="font-medium">{health.message}</p>
        <p className="mt-1">
          Enforcement is <strong>{enforcing ? "ON" : "OFF"}</strong>
          {enforcing ? ": profiles that name a registered client are blocked at Preview, PDF and Submit." : ": nothing is blocked yet (COMPLIANCE_ENFORCE is not set to on)."}
        </p>
        {keyAge !== null && keyAge >= 12 && <p className="mt-1">The Google service-account key is about {keyAge} months old. Please rotate it.</p>}
      </div>

      <section className="flex flex-wrap items-start justify-between gap-4 border border-gray-200 bg-white p-5">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-700">Registry</h2>
          <p className="mt-2 text-sm text-ink-light">
            {overview.counts.active} active · {overview.counts.pending} awaiting review · {overview.counts.deactivated} no longer enforced
          </p>
          {overview.settings && (
            <p className="mt-1 text-xs text-ink-light">
              Scheduled on day{overview.settings.schedule_days.length === 1 ? "" : "s"} {overview.settings.schedule_days.join(" and ")} of each month, up to{" "}
              {overview.settings.max_attempts} tries; considered stale after {overview.settings.stale_after_days} days.
            </p>
          )}
        </div>
        <SyncNowButton />
      </section>

      <section className="border border-gray-200 bg-white">
        <h2 className="border-b border-hairline px-5 py-3 text-sm font-medium uppercase tracking-wide text-gray-700">
          Names to review{overview.pending.length ? ` (${overview.pending.length})` : ""}
        </h2>
        {overview.pending.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-light">No name has disappeared from the sheet. Nothing needs a decision.</p>
        ) : (
          <>
            <p className="px-5 pt-3 text-xs text-ink-light">
              These names were not found anywhere in a complete synchronisation. They are still enforced until you decide.
            </p>
            <ul className="divide-y divide-hairline">
              {overview.pending.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-dark">{n.display_name}</p>
                    <p className="text-xs text-ink-light">
                      {n.name_types.join(", ")} · missing since {fmt(n.missing_since)}
                    </p>
                  </div>
                  <ReviewNameButtons nameId={n.id} displayName={n.display_name} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="border border-gray-200 bg-white">
        <h2 className="border-b border-hairline px-5 py-3 text-sm font-medium uppercase tracking-wide text-gray-700">Recent synchronisations</h2>
        {overview.runs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-light">No synchronisation has run yet. Use “Synchronise now” once the Google access is in place.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-light">
                <tr>
                  <th className="px-5 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Tabs</th>
                  <th className="px-3 py-2 font-medium">Names</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {overview.runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2">{fmt(r.started_at)}</td>
                    <td className="px-3 py-2">
                      {r.trigger === "manual" ? "Administrator" : "Schedule"}
                      {r.attempt > 1 ? ` (try ${r.attempt})` : ""}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.status}</td>
                    <td className="px-3 py-2">
                      {r.tabs_scanned}/{r.tabs_discovered}
                      {r.tabs_failed ? ` · ${r.tabs_failed} not ok` : ""}
                    </td>
                    <td className="px-3 py-2">
                      +{r.names_new} new, {r.names_updated} known
                      {r.missing_candidates ? `, ${r.missing_candidates} to review` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-light">
                      {r.error_code ? <span className="font-medium text-brand-700">{r.error_code}</span> : null}
                      {r.error_summary ? ` ${r.error_summary}` : ""}
                      {!r.snapshot_complete && r.status !== "failed" && r.status !== "running" ? " Incomplete: nothing was marked missing." : ""}
                      {r.tab_report.filter((t) => t.status !== "ok" && t.status !== "ignored" && t.status !== "empty_section").map((t) => ` ${t.tab}: ${t.status}.`).join("")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
