"use client";

/**
 * Purpose: warns, in the InfoBeans callout style, shortly before the hard sign-in limit ends the session
 * (5 minutes before). With unsaved work the text says to go to Preview & Submit (internal) or download (external);
 * there is no Save button, because profiles are only saved by Submit on Preview. It counts down from the time left that
 * the server measured at render (`remainingMs`), not from the browser's clock. Shows nothing until the warning
 * window opens. Announced politely to screen readers.
 */
import { useEffect, useRef, useState } from "react";
import { expiryMessage, expiryPhase } from "@/lib/sessionExpiry";

interface SessionExpiryBannerProps {
  /** Milliseconds left of the sign-in limit when the page was rendered (from the server). */
  remainingMs: number;
  /** True when there is unsaved work (not yet submitted / downloaded), so the text asks the user to act. */
  canSave: boolean;
  /** False for external profiles, which are never saved: the text then asks for a download. */
  saves?: boolean;
}

const TICK_MS = 10_000;

export default function SessionExpiryBanner({ remainingMs, canSave, saves = true }: SessionExpiryBannerProps) {
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
      className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-brand-200 bg-warm px-4 py-3 text-sm text-ink"
    >
      <p>{message}</p>
    </div>
  );
}
