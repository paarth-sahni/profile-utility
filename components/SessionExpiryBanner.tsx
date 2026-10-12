"use client";

/**
 * Purpose: warns, in the InfoBeans callout style, shortly before the hard sign-in limit ends the session
 * (5 minutes before), with a Save button while there is unsaved work. It counts down from the time left that
 * the server measured at render (`remainingMs`), not from the browser's clock. Shows nothing until the warning
 * window opens. Announced politely to screen readers.
 */
import { useEffect, useRef, useState } from "react";
import { expiryMessage, expiryPhase } from "@/lib/sessionExpiry";

interface SessionExpiryBannerProps {
  /** Milliseconds left of the sign-in limit when the page was rendered (from the server). */
  remainingMs: number;
  /** True when there is unsaved work, so a Save button is offered. */
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  /** False for external profiles, which are never saved: the banner then asks for a download and has no Save button. */
  saves?: boolean;
  /** Why the last save did not go through (e.g. a role-specific version still needs a name). */
  error?: string | null;
}

const TICK_MS = 10_000;

export default function SessionExpiryBanner({ remainingMs, canSave, saving, onSave, error, saves = true }: SessionExpiryBannerProps) {
  // The moment the session ends, fixed on mount from the server's measurement.
  const deadline = useRef<number>(Date.now() + remainingMs);
  const [left, setLeft] = useState<number>(remainingMs);

  useEffect(() => {
    const tick = () => setLeft(deadline.current - Date.now());
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const message = expiryMessage(left, canSave, saves);
  if (!message) return null;
  const ended = expiryPhase(left) === "expired";

  return (
    <div
      role={ended ? "alert" : "status"}
      aria-live={ended ? "assertive" : "polite"}
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-200 bg-warm px-4 py-3 text-sm text-ink"
    >
      <div>
        <p>{message}</p>
        {error && <p className="mt-1 text-brand-700">{error}</p>}
      </div>
      {saves && canSave && !ended && (
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save now"}
        </button>
      )}
    </div>
  );
}
