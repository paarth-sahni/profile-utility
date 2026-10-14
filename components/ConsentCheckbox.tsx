"use client";

/**
 * Purpose: the required consent checkbox ("I confirm the information in this profile is accurate and may be shared")
 * with its error line. Shared by the Preview & Submit step and the Download PDF dialog on My Profiles and Manage, so
 * the wording and behaviour are the same everywhere. The caller records the consent (POST /api/consent).
 */
import { useId, type Ref } from "react";
import { CONSENT_TEXT } from "@/lib/consent";

/** Shown when an action is chosen before the box is ticked. */
export const CONSENT_REQUIRED = "Please tick the box to confirm before you continue.";

export default function ConsentCheckbox({
  checked,
  onChange,
  error,
  inputRef,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const errorId = useId();
  return (
    <>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          ref={inputRef}
          type="checkbox"
          checked={checked}
          aria-required="true"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#EA1B3D]"
        />
        <span>{CONSENT_TEXT}</span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-brand-700">
          {error}
        </p>
      )}
    </>
  );
}
