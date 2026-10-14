"use client";

/**
 * Purpose: "Mark as primary" on My Profiles. Asks for confirmation (ConfirmDialog), then POST /api/profiles/[id]/primary
 * and refreshes the page so the "Primary" badge moves. The database switches the primary atomically (owner only).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** The one-line explanation shown wherever a profile can be made primary. */
export const PRIMARY_EXPLANATION = "Your primary profile is the one managers will see and use.";

export default function MarkPrimaryButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function markPrimary() {
    setAsking(false);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${BASE}/api/profiles/${profileId}/primary`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(json?.error?.message ?? "We could not mark this profile as primary. Please try again.");
      }
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "We could not mark this profile as primary. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start" data-mark-primary={profileId}>
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={busy}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Mark as primary"}
      </button>
      {asking && (
        <ConfirmDialog
          title="Mark as primary?"
          message={`${PRIMARY_EXPLANATION} Make this your primary profile?`}
          confirmLabel="Make primary"
          cancelLabel="Cancel"
          onConfirm={markPrimary}
          onCancel={() => setAsking(false)}
        />
      )}
      {message && (
        <span role="alert" className="mt-1 max-w-xs text-xs text-brand-700">
          {message}
        </span>
      )}
    </span>
  );
}

/** The "Primary" badge. */
export function PrimaryBadge() {
  return (
    <span data-primary-badge className="rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-medium text-white">
      Primary
    </span>
  );
}
