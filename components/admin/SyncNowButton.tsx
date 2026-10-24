"use client";

/**
 * Purpose: the administrator's "Synchronise now" button on /admin/compliance. Calls POST /api/admin/sync (administrators only on
 * the server; the button is just a convenience) and shows the outcome in plain words, with counts and codes only. The page is
 * refreshed afterwards so the run history and counts update.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Outcome = { kind: "ok" | "warn" | "error"; text: string };

export default function SyncNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`${BASE}/api/admin/sync`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        errorCode?: string | null;
        counts?: { namesNew: number; namesUpdated: number; occurrences: number; missingCandidates: number } | null;
        error?: { message?: string };
      };
      if (!res.ok) {
        setOutcome({ kind: "error", text: json.error?.message ?? "The synchronisation could not be started." });
      } else if (json.status === "succeeded" && json.counts) {
        const c = json.counts;
        setOutcome({
          kind: "ok",
          text: `Done. ${c.namesNew} new name${c.namesNew === 1 ? "" : "s"}, ${c.namesUpdated} already known, ${c.occurrences} places recorded${c.missingCandidates ? `, ${c.missingCandidates} to review` : ""}.`,
        });
      } else if (json.status === "partial") {
        setOutcome({ kind: "warn", text: `Partly done (${json.errorCode ?? "see the run below"}). New names were added; nothing was marked as missing.` });
      } else {
        setOutcome({ kind: "error", text: `The synchronisation failed (${json.errorCode ?? "unknown"}). See the run below.` });
      }
      router.refresh();
    } catch {
      setOutcome({ kind: "error", text: "We could not reach the server. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const tone = outcome?.kind === "ok" ? "text-green-700" : outcome?.kind === "warn" ? "text-amber-700" : "text-brand-700";
  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
      >
        {busy ? "Synchronising…" : "Synchronise now"}
      </button>
      {outcome && (
        <p role="status" className={`mt-2 text-sm ${tone}`}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}
