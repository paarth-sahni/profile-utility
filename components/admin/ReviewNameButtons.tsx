"use client";

/**
 * Purpose: Keep / Deactivate for one registry name that has disappeared from the sheet (/admin/compliance). Keep means "it is
 * still a client, keep enforcing it"; Deactivate stops enforcing it. Nothing is removed either way and the decision is audited.
 * Calls POST /api/admin/compliance/review (administrators only on the server and in the database).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ReviewNameButtons({ nameId, displayName }: { nameId: string; displayName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"keep" | "deactivate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "keep" | "deactivate") {
    if (busy) return;
    if (decision === "deactivate" && !window.confirm(`Stop enforcing “${displayName}”? It stays in the history but will no longer be blocked in profiles.`)) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/admin/compliance/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameId, decision }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(json.error?.message ?? "We could not record that decision.");
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button type="button" onClick={() => decide("keep")} disabled={busy !== null} className={`${btn} border-gray-300 text-ink hover:bg-gray-50`}>
          {busy === "keep" ? "Saving…" : "Keep enforcing"}
        </button>
        <button type="button" onClick={() => decide("deactivate")} disabled={busy !== null} className={`${btn} border-brand-300 text-brand-700 hover:bg-brand-50`}>
          {busy === "deactivate" ? "Saving…" : "Stop enforcing"}
        </button>
      </div>
      {error && <p className="text-xs text-brand-700">{error}</p>}
    </div>
  );
}
