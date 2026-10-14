"use client";

/**
 * Purpose: the Preview step. Shows the exact PDF that is generated (see PdfPreview) and offers the ways to finish:
 * "← Back to edit", "Download PDF" (saves the previewed PDF), "Open in Google Docs" (only when `canGoogleDocs`; it
 * uploads the filled DOCX, which Google converts) and "Submit" (only when
 * `onSubmit` is given, i.e. internal profiles). A required consent checkbox must be ticked first; the consent is
 * recorded in the audit log (POST /api/consent) before the action runs, and the action is cancelled if that fails.
 * The validated profile comes from the workflow; nothing here edits it.
 */
import { useEffect, useRef, useState } from "react";
import ConsentCheckbox, { CONSENT_REQUIRED } from "@/components/ConsentCheckbox";
import OpenInGoogleDocsButton from "@/components/OpenInGoogleDocsButton";
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
}

export interface PreviewStepProps {
  template: TemplateId;
  /** The validated profile (the workflow validates before entering this step). */
  data: ResumeData;
  /** Name of the downloaded PDF. */
  fileName: string;
  /** Title of the Google Doc. */
  docTitle: string;
  /** Only managers and admins get "Open in Google Docs". */
  canGoogleDocs: boolean;
  onBack: () => void;
  /** Called once the PDF was handed to the browser. */
  onDownloaded: () => void;
  /** Internal profiles only: saves the profile (or reuses the saved version) and returns it; throws a readable error if it fails. */
  onSubmit?: () => Promise<SubmittedVersion>;
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
  docTitle,
  canGoogleDocs,
  onBack,
  onDownloaded,
  onSubmit,
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
      setSubmitted(await onSubmit());
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "We could not submit your profile." });
    } finally {
      setBusy(null);
    }
  };

  const buttonBase = "rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50";
  const primary = `${buttonBase} bg-brand-500 text-white shadow-sm hover:bg-brand-600`;
  const outline = `${buttonBase} border border-gray-300 text-ink hover:bg-gray-50`;

  return (
    <div className="space-y-5" data-preview-step>
      <div>
        <h2 className="text-lg font-medium text-ink-dark">{onSubmit ? "Preview & Submit" : "Preview"}</h2>
        <p className="mt-1 text-sm text-ink-light">This is the exact PDF that will be downloaded. Check it, then confirm below.</p>
      </div>

      {pdf.status === "loading" && (
        <div role="status" className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-ink-light">
          Building your preview…
        </div>
      )}
      {pdf.status === "error" && (
        <div role="alert" className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="whitespace-pre-wrap text-sm text-brand-700">{pdf.message}</p>
          <button type="button" onClick={retry} className={outline}>
            Try again
          </button>
        </div>
      )}
      {pdf.status === "ready" && <PdfPreview blob={pdf.blob} />}

      <div className="rounded-xl border border-gray-200 bg-cream p-4">
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
        <div role="status" data-submitted className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-ink shadow-sm">
          Submitted &middot; saved to My Profiles &middot; v{submitted.versionNo} &middot;{" "}
          <a href={`/profiles/${submitted.profileId}`} className="font-medium text-brand-600 hover:underline">
            View in My Profiles
          </a>
        </div>
      )}

      {note && !submitted && <p className="text-sm text-ink-light">{note}</p>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <button type="button" onClick={onBack} disabled={busy !== null} className={outline}>
          ← Back to edit
        </button>
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={download} disabled={!ready || busy !== null} className={onSubmit ? outline : primary}>
            {busy === "download" ? "Preparing…" : "Download PDF"}
          </button>
          {canGoogleDocs && ready && (
            <OpenInGoogleDocsButton
              template={template}
              title={docTitle}
              variant="outline"
              prepare={() => {
                if (!requireConsent()) return { ok: false, message: CONSENT_REQUIRED };
                return { ok: true, data };
              }}
              beforeUpload={() => record("google_docs")}
            />
          )}
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
