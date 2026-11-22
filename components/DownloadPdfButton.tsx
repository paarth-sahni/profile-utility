"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import ConsentCheckbox, { CONSENT_REQUIRED } from "@/components/ConsentCheckbox";
import { ConsentError, recordConsent } from "@/lib/consentClient";
import { checkReadyForDocx, pdfFileName } from "@/lib/docxReady";
import { PdfRequestError, fetchProfilePdf, savePdf } from "@/lib/pdfClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

/**
 * Downloads a saved version as PDF (made by the server, POST /api/pdf). Like Preview & Submit, it first asks for the
 * consent tick, which is recorded (POST /api/consent) before anything is downloaded. Incomplete drafts are sent back
 * to the editor to be finished. `dock` is the large red button of the profile pages' fixed action bar (components/ProfileDock.tsx):
 * a download icon, and a message opens above the button instead of below it.
 */
export default function DownloadPdfButton({
  template,
  data,
  versionId,
  dock = false,
}: {
  template: TemplateId;
  data: ResumeData;
  versionId: string;
  dock?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  function onClick() {
    setMessage(null);
    const ready = checkReadyForDocx(template, data);
    if (!ready.ok) {
      setMessage(ready.message);
      return;
    }
    setConsent(false); // ticked fresh for every download, as on Preview & Submit
    setConsentError(null);
    setAsking(true);
  }

  async function download() {
    if (!consent) {
      setConsentError(CONSENT_REQUIRED);
      return;
    }
    setAsking(false);
    const ready = checkReadyForDocx(template, data);
    if (!ready.ok) return;
    setBusy(true);
    try {
      await recordConsent(template, "download");
      savePdf(await fetchProfilePdf(template, ready.data, { versionId }), pdfFileName(ready.data));
    } catch (e) {
      setMessage(
        (e instanceof PdfRequestError || e instanceof ConsentError) && e.status === 401
          ? "Your session has ended. Please sign in again."
          : e instanceof Error
            ? e.message
            : "We could not create the PDF. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex ${dock ? "flex-col-reverse items-end" : "flex-col items-start"}`} data-version={versionId}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={
          dock
            ? "inline-flex items-center gap-2 bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50"
            : "border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
        }
      >
        {dock && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12" />
            <path d="m7 11 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        )}
        {busy ? "Preparing…" : "Download PDF"}
      </button>
      {asking && (
        <ConfirmDialog
          title="Download PDF"
          message="Please confirm before you download this profile."
          confirmLabel="Download PDF"
          cancelLabel="Cancel"
          onConfirm={download}
          onCancel={() => setAsking(false)}
        >
          <ConsentCheckbox
            checked={consent}
            error={consentError}
            onChange={(checked) => {
              setConsent(checked);
              if (checked) setConsentError(null);
            }}
          />
        </ConfirmDialog>
      )}
      {message && (
        <span role="alert" className={`max-w-xs text-xs text-brand-700 ${dock ? "mb-2 text-right" : "mt-1"}`}>
          {message}
        </span>
      )}
    </span>
  );
}
