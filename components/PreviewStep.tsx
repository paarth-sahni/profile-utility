"use client";

/**
 * Purpose: the Preview (& Submit) step. Shows the exact PDF that is generated (see PdfPreview) and offers the ways to
 * finish: "← Back to edit", "Download PDF" (saves the previewed PDF) and "Submit" (only when `onSubmit` is given, i.e.
 * internal profiles). "Open in Google Docs" is not offered here: it is only on the /manage profile pages. A required consent checkbox must be ticked first; the consent is
 * recorded in the audit log (POST /api/consent) before the action runs, and the action is cancelled if that fails.
 * The validated profile comes from the workflow; nothing here edits it.
 */
import { useEffect, useId, useRef, useState } from "react";
import ConsentCheckbox, { CONSENT_REQUIRED } from "@/components/ConsentCheckbox";
import { PRIMARY_EXPLANATION } from "@/components/MarkPrimaryButton";
import PdfPreview from "@/components/PdfPreview";
import { usePreviewPdf } from "@/components/usePreviewPdf";
import type { ConsentAction } from "@/lib/consent";
import { ConsentError, recordConsent } from "@/lib/consentClient";
import { savePdf } from "@/lib/pdfClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

/** The version Submit saved (or reused). */
export interface SubmittedVersion {
  profileId: string;
  versionNo: number;
  /** Whether that profile is now the user's primary one. */
  isPrimary: boolean;
}

/**
 * "Mark as primary profile" above Submit (internal only): "choose" = the user may tick it; "already" = this profile is
 * already primary; "first" = the user has no primary yet, so this first submitted profile becomes primary anyway.
 */
export type PrimaryChoice = "choose" | "already" | "first";

export interface PreviewStepProps {
  template: TemplateId;
  /** The validated profile (the workflow validates before entering this step). */
  data: ResumeData;
  /** Name of the downloaded PDF. */
  fileName: string;
  onBack: () => void;
  /** Called once the PDF was handed to the browser. */
  onDownloaded: () => void;
  /** Internal profiles only: saves the profile (or reuses the saved version), making it primary when asked; throws a readable error if it fails. */
  onSubmit?: (makePrimary: boolean) => Promise<SubmittedVersion>;
  /** With onSubmit: how "Mark as primary profile" is offered. */
  primaryChoice?: PrimaryChoice | null;
  submitError?: string | null;
  /** Shown above the buttons, e.g. what Submit will save. */
  note?: string | null;
  /** Called when the server answers 401 (consent or PDF), i.e. the sign-in ended. */
  onSessionEnded: () => void;
}

export default function PreviewStep({
  template,
  data,
  fileName,
  onBack,
  onDownloaded,
  onSubmit,
  primaryChoice,
  submitError,
  note,
  onSessionEnded,
}: PreviewStepProps) {
  const { pdf, retry } = usePreviewPdf(template, data);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ConsentAction | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedVersion | null>(null);
  const [makePrimary, setMakePrimary] = useState(false);
  const primaryLocked = primaryChoice === "already" || primaryChoice === "first";
  const lockedReason =
    primaryChoice === "already" ? "This is already your primary profile" : primaryChoice === "first" ? "This will be your primary profile" : null;
  const primaryIds = useId();
  const checkbox = useRef<HTMLInputElement>(null);

  const ready = pdf.status === "ready";
  const sessionEnded = pdf.status === "error" && pdf.httpStatus === 401;

  const endedReported = useRef(false);
  useEffect(() => {
    if (sessionEnded && !endedReported.current) {
      endedReported.current = true;
      onSessionEnded();
    }
  }, [sessionEnded, onSessionEnded]);

  /** True when the box is ticked; otherwise explains and moves focus to it. */
  const requireConsent = (): boolean => {
    if (consent) return true;
    setConsentError(CONSENT_REQUIRED);
    checkbox.current?.focus();
    return false;
  };

  /** Writes the consent to the audit log. Throws (after reporting an ended session) if that did not work. */
  const record = async (action: ConsentAction): Promise<void> => {
    try {
      await recordConsent(template, action);
    } catch (e) {
      if (e instanceof ConsentError && e.status === 401) onSessionEnded();
      throw e;
    }
  };

  const download = async () => {
    if (pdf.status !== "ready" || busy || !requireConsent()) return;
    setMessage(null);
    setBusy("download");
    try {
      await record("download");
      savePdf(pdf.blob, fileName);
      onDownloaded();
      setMessage({ kind: "ok", text: "PDF downloaded — check your downloads." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "We could not download the file." });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!onSubmit || !ready || busy || !requireConsent()) return;
    setMessage(null);
    setSubmitted(null);
    setBusy("submit");
    try {
      await record("submit");
      setSubmitted(await onSubmit(makePrimary && primaryChoice === "choose"));
      setMakePrimary(false);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "We could not submit your profile." });
    } finally {
      setBusy(null);
    }
  };

  const buttonBase = "px-4 py-2 text-sm font-medium transition disabled:opacity-50";
  const primary = `${buttonBase} bg-brand-500 text-white shadow-sm hover:bg-brand-600`;
  const outline = `${buttonBase} border border-gray-300 text-ink hover:bg-gray-50`;

  return (
    <div className="space-y-5" data-preview-step>
      <div>
        <h2 className="text-lg font-medium text-ink-dark">{onSubmit ? "Preview & Submit" : "Preview"}</h2>
        <p className="mt-1 text-sm text-ink-light">This is the exact PDF that will be downloaded. Check it, then confirm below.</p>
      </div>

      {pdf.status === "loading" && (
        <div role="status" className="border border-gray-200 bg-white px-4 py-10 text-center text-sm text-ink-light">
          Building your preview…
        </div>
      )}
      {pdf.status === "error" && (
        <div role="alert" className="space-y-3 border border-brand-200 bg-brand-50 p-4">
          <p className="whitespace-pre-wrap text-sm text-brand-700">{pdf.message}</p>
          <button type="button" onClick={retry} className={outline}>
            Try again
          </button>
        </div>
      )}
      {pdf.status === "ready" && <PdfPreview blob={pdf.blob} />}

      <div className="border border-gray-200 bg-cream p-4">
        <ConsentCheckbox
          inputRef={checkbox}
          checked={consent}
          error={consentError}
          onChange={(checked) => {
            setConsent(checked);
            if (checked) setConsentError(null);
          }}
        />
      </div>

      {submitted && (
        <div role="status" data-submitted className="border border-gray-200 bg-white p-4 text-sm text-ink shadow-sm">
          Submitted &middot; saved to My Profiles &middot; v{submitted.versionNo}
          {submitted.isPrimary ? <> &middot; your primary profile</> : null} &middot;{" "}
          <a href={`/profiles/${submitted.profileId}`} className="font-medium text-brand-600 hover:underline">
            View in My Profiles
          </a>
        </div>
      )}

      {note && !submitted && <p className="text-sm text-ink-light">{note}</p>}

      {onSubmit && primaryChoice && (
        // same box and left edge as the consent checkbox above; locked boxes say why (visible line + tooltip)
        <div className="border border-gray-200 bg-white p-4" data-primary-choice={primaryChoice}>
          <label className="flex items-start gap-3 text-sm" title={lockedReason ?? undefined}>
            <input
              type="checkbox"
              checked={primaryLocked || makePrimary}
              disabled={primaryLocked || busy !== null}
              onChange={(e) => setMakePrimary(e.target.checked)}
              title={lockedReason ?? undefined}
              aria-description={lockedReason ?? undefined}
              aria-describedby={`${primaryIds}-explain${lockedReason ? ` ${primaryIds}-reason` : ""}`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#EA1B3D] disabled:opacity-60"
            />
            <span>
              <span className="font-medium text-brand-500">Mark as primary profile</span>
              <span id={`${primaryIds}-explain`} className="block text-xs text-ink-light">
                {PRIMARY_EXPLANATION}
              </span>
              {lockedReason && (
                <span id={`${primaryIds}-reason`} data-primary-reason className="mt-1 block text-xs text-ink">
                  {lockedReason}
                </span>
              )}
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onBack} disabled={busy !== null} className={outline}>
          ← Back to edit
        </button>
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={download} disabled={!ready || busy !== null} className={onSubmit ? outline : primary}>
            {busy === "download" ? "Preparing…" : "Download PDF"}
          </button>
          {onSubmit && (
            <button type="button" onClick={submit} disabled={!ready || busy !== null} className={primary}>
              {busy === "submit" ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>
      </div>

      <div aria-live="polite" className="min-h-5 text-sm">
        {submitError && <p className="text-brand-700">{submitError}</p>}
        {message && <p className={message.kind === "ok" ? "text-ink-light" : "text-brand-700"}>{message.text}</p>}
      </div>
    </div>
  );
}
