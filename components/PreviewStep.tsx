"use client";

/**
 * Purpose: the Preview (& Submit) step and the ways to finish: "← Back to edit", "Download PDF" and "Submit" (only when
 * `onSubmit` is given, i.e. internal profiles). "Open in Google Docs" is not offered here: it is only on the /manage profile
 * pages. A required consent checkbox must be ticked first.
 *   - External profiles: the exact PDF is shown (PdfPreview) and Download saves that file; the consent is recorded
 *     (POST /api/consent) before it runs and the download is cancelled if that fails.
 *   - Internal profiles (`edit`): the text under the headings can be edited in a view laid out like the PDF
 *     (InternalPreviewEditor); "View PDF before you submit" (the main action, just above the consent box) shows the exact
 *     PDF in a dialog, built again whenever the text changed since the last one. Download and Submit stay disabled until
 *     the PDF of the current text has been opened; an edit makes it needed again. Download always builds the PDF of the current text with the server, which records the consent only after its
 *     checks pass (so the file always matches the text), and that file becomes the one View PDF shows. A problem (required,
 *     "N/A", an emptied item, a registered client name) blocks Download and Submit: it is listed and the first field gets
 *     focus; a refusal by the server is shown the same way. Changing the text after ticking the box clears the tick.
 * Submit sends the tick with the save request and the server records it only after its checks pass, so a refused Submit
 * leaves no consent record.
 */
import { useEffect, useId, useRef, useState } from "react";
import ConsentCheckbox, { CONSENT_REQUIRED } from "@/components/ConsentCheckbox";
import type { Range } from "@/components/fields";
import InternalPreviewEditor from "@/components/InternalPreviewEditor";
import { PRIMARY_EXPLANATION } from "@/components/MarkPrimaryButton";
import PdfPreview from "@/components/PdfPreview";
import { usePreviewPdf, type PreviewPdf } from "@/components/usePreviewPdf";
import type { PdfComplianceMatch, PdfFieldIssue } from "@/lib/pdfClient";
import type { PreviewLayout } from "@/lib/previewEdit";
import type { ConsentAction } from "@/lib/consent";
import { ConsentError, recordConsent } from "@/lib/consentClient";
import { savePdf } from "@/lib/pdfClient";
import type { InternalResume, ResumeData, TemplateId } from "@/lib/schemas";

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

/** Something that blocks Download / Submit: the field, its accessible name and what to do. */
export interface PreviewProblem {
  path: string;
  label: string;
  message: string;
}

/** What the server refused: incomplete fields (INCOMPLETE) or registered client names (COMPLIANCE). */
export interface PreviewRefusal {
  fields?: PdfFieldIssue[];
  matches?: PdfComplianceMatch[];
}

/** Internal profiles: editing the text on Preview (all of it owned by the workflow). */
export interface PreviewEditing {
  layout: PreviewLayout;
  /** The profile as Preview opened it (the read-only header). */
  header: InternalResume;
  onEdit: (path: string, value: string) => void;
  /** Field path -> problem shown on the field (updated a moment after typing stops). */
  errors: Record<string, string>;
  highlights: Record<string, Range[]>;
  /** Everything that blocks Download / Submit right now, in the order of the page. */
  problems: () => PreviewProblem[];
  /** The server refused: the workflow marks the fields and returns the field to focus, or null when it went back to Edit. */
  onRefused: (refusal: PreviewRefusal) => string | null;
  /** A field the workflow wants focused (e.g. after a refused Submit); `tick` changes on every request. */
  focus: { path: string; tick: number } | null;
}

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
  /** Called when the server refuses the profile because it names a registered client (the workflow goes back to editing). */
  onComplianceBlocked?: (matches: PdfComplianceMatch[]) => void;
  /** The checker currently flags this profile: Download and Submit stay disabled whatever else is true (external view). */
  blocked?: boolean;
  /** Internal profiles: the text can be edited here. */
  edit?: PreviewEditing;
}

/** Moves focus to the Preview field for `path` (and scrolls it into view). */
function focusField(path: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-edit-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  });
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
  onComplianceBlocked,
  blocked = false,
  edit,
}: PreviewStepProps) {
  const { pdf, retry, build } = usePreviewPdf(template, data, { auto: !edit });
  const [viewing, setViewing] = useState(false);
  const viewer = useRef<HTMLDialogElement>(null);
  const viewerTitle = useId();
  const [showProblems, setShowProblems] = useState(false);
  const [consentNotice, setConsentNotice] = useState<string | null>(null);
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

  const ready = edit ? true : pdf.status === "ready"; // editable: Download / Submit build or save what they need themselves
  const outOfDate = pdf.status === "ready" && pdf.forData !== data;
  // editable: the text the PDF was last opened for; Download / Submit need it to be the current text
  const [seenFor, setSeenFor] = useState<ResumeData | null>(null);
  const pdfSeen = !edit || seenFor === data;
  const pdfHintId = useId();
  const sessionEnded = pdf.status === "error" && pdf.httpStatus === 401;
  const problems = edit && showProblems ? edit.problems() : [];

  /** An edit on Preview: a tick given before it confirmed the old text, and a "Submitted" message is about the old text. */
  const onEdit = (path: string, value: string) => {
    edit?.onEdit(path, value);
    setSubmitted(null);
    if (consent) {
      setConsent(false);
      setConsentNotice("You changed the text, so please tick the box again to confirm it.");
    }
  };

  // the workflow asks for a field (after a refused Submit)
  const focusTick = edit?.focus?.tick;
  const focusPath = edit?.focus?.path;
  useEffect(() => {
    if (!focusPath) return; // only a new request (a new tick) moves focus
    setShowProblems(true);
    focusField(focusPath);
  }, [focusTick, focusPath]);

  const endedReported = useRef(false);
  useEffect(() => {
    if (sessionEnded && !endedReported.current) {
      endedReported.current = true;
      onSessionEnded();
    }
  }, [sessionEnded, onSessionEnded]);

  // external: the server refused the profile (it names a registered client): hand the places to the workflow, which returns to editing
  const blockedMatches = !edit && pdf.status === "error" && pdf.code === "COMPLIANCE" ? pdf.matches : undefined;
  const blockedReported = useRef(false);
  useEffect(() => {
    if (blockedMatches && !blockedReported.current) {
      blockedReported.current = true;
      onComplianceBlocked?.(blockedMatches);
    }
  }, [blockedMatches, onComplianceBlocked]);

  /** True when the box is ticked; otherwise explains and moves focus to it. */
  const requireConsent = (): boolean => {
    if (consent) return true;
    setConsentError(CONSENT_REQUIRED);
    checkbox.current?.focus();
    return false;
  };

  /** Editable: true when nothing blocks Download / Submit; otherwise lists the problems and focuses the first field. */
  const requireNoProblems = (): boolean => {
    if (!edit) return true;
    const list = edit.problems();
    setShowProblems(list.length > 0);
    if (list.length === 0) return true;
    focusField(list[0].path);
    return false;
  };

  /** Editable: what to do with a PDF that could not be built (refusal, ended session, rate limit...). */
  const reportFailure = (failed: Extract<PreviewPdf, { status: "error" }>) => {
    if (failed.httpStatus === 401) {
      onSessionEnded();
      return;
    }
    if (edit && (failed.code === "COMPLIANCE" || failed.code === "INCOMPLETE") && (failed.matches || failed.fields)) {
      viewer.current?.close();
      const path = edit.onRefused({ matches: failed.matches, fields: failed.fields });
      setShowProblems(true);
      if (path) focusField(path);
    }
    setMessage({ kind: "error", text: failed.message });
  };

  /** Editable: opens the PDF dialog, building the PDF first when there is none or the text changed since. */
  const viewPdf = async () => {
    setMessage(null);
    setViewing(true);
    viewer.current?.showModal();
    if (pdf.status === "ready" && !outOfDate) {
      setSeenFor(data);
      return;
    }
    const out = await build(data);
    if (out.status === "error") reportFailure(out);
    else if (out.status === "ready") setSeenFor(out.forData);
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
    if (edit) {
      if (busy || !requireConsent() || !requireNoProblems()) return;
      setMessage(null);
      setBusy("download");
      try {
        // always the PDF of the current text, made and checked by the server, which then records the consent
        const out = await build(data, { consent: "download" });
        if (out.status !== "ready") {
          if (out.status === "error") reportFailure(out);
          return;
        }
        savePdf(out.blob, fileName);
        onDownloaded();
        setMessage({ kind: "ok", text: "PDF downloaded — check your downloads." });
      } finally {
        setBusy(null);
      }
      return;
    }
    if (pdf.status !== "ready" || busy || blocked || !requireConsent()) return;
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
    if (!onSubmit || !ready || busy || (!edit && blocked) || !requireConsent() || !requireNoProblems()) return;
    setMessage(null);
    setSubmitted(null);
    setBusy("submit");
    try {
      // no consent call here: the save request carries the tick and the server records it only after its checks pass
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
        <p className="mt-1 text-sm text-ink-light">
          {edit
            ? "Check your profile and correct the text if needed. View PDF shows the exact file, with its page breaks; then confirm below."
            : "This is the exact PDF that will be downloaded. Check it, then confirm below."}
        </p>
      </div>

      {edit && (
        <>
          <InternalPreviewEditor
            header={edit.header}
            layout={edit.layout}
            data={data as InternalResume}
            onEdit={onEdit}
            errors={edit.errors}
            highlights={edit.highlights}
          />
          <dialog
            ref={viewer}
            aria-labelledby={viewerTitle}
            onClose={() => setViewing(false)}
            className="m-auto h-[92vh] w-[min(56rem,96vw)] max-w-none bg-white p-0 backdrop:bg-black/50"
            data-pdf-dialog
          >
            {viewing && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                  <h3 id={viewerTitle} className="text-sm font-medium text-ink-dark">
                    PDF preview: the exact file, with its page breaks
                  </h3>
                  <button type="button" onClick={() => viewer.current?.close()} className={outline} autoFocus>
                    Close
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
                  {pdf.status === "loading" && (
                    <p role="status" className="py-10 text-center text-sm text-ink-light">
                      Building the PDF…
                    </p>
                  )}
                  {pdf.status === "error" && (
                    <p role="alert" className="whitespace-pre-wrap border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
                      {pdf.message}
                    </p>
                  )}
                  {pdf.status === "ready" && <PdfPreview blob={pdf.blob} />}
                </div>
              </div>
            )}
          </dialog>
        </>
      )}

      {!edit && pdf.status === "loading" && (
        <div role="status" className="border border-gray-200 bg-white px-4 py-10 text-center text-sm text-ink-light">
          Building your preview…
        </div>
      )}
      {!edit && pdf.status === "error" && (
        <div role="alert" className="space-y-3 border border-brand-200 bg-brand-50 p-4">
          <p className="whitespace-pre-wrap text-sm text-brand-700">{pdf.message}</p>
          <button type="button" onClick={retry} className={outline}>
            Try again
          </button>
        </div>
      )}
      {!edit && pdf.status === "ready" && <PdfPreview blob={pdf.blob} />}

      {problems.length > 0 && (
        <div role="alert" className="border border-brand-200 bg-brand-50 p-3" data-preview-problems>
          <p className="mb-2 text-sm font-semibold text-brand-700">
            Please fix {problems.length} {problems.length === 1 ? "issue" : "issues"} before downloading or submitting:
          </p>
          <ul className="space-y-1 text-sm text-brand-700">
            {problems.map((p) => (
              <li key={p.path}>
                <button type="button" onClick={() => focusField(p.path)} className="text-left underline underline-offset-2 hover:text-brand-800">
                  {p.label}
                </button>{" "}
                — {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edit && (
        <div className="flex flex-col items-start gap-2">
          <button type="button" onClick={() => void viewPdf()} disabled={busy !== null} className={primary} data-view-pdf>
            View PDF before you submit
          </button>
          {!pdfSeen && (
            <p id={pdfHintId} className="text-sm text-ink-light" data-pdf-needed>
              {seenFor === null ? "View the PDF first: Download PDF and Submit are available once you have seen it." : "View the PDF of your latest changes first"}
            </p>
          )}
        </div>
      )}

      <div className="border border-gray-200 bg-cream p-4">
        <ConsentCheckbox
          inputRef={checkbox}
          checked={consent}
          error={consentError}
          onChange={(checked) => {
            setConsent(checked);
            if (checked) {
              setConsentError(null);
              setConsentNotice(null);
            }
          }}
        />
        {consentNotice && !consent && (
          <p className="mt-2 text-xs text-amber-700" role="status">
            {consentNotice}
          </p>
        )}
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
          <button
            type="button"
            onClick={download}
            disabled={!ready || busy !== null || (!edit && blocked) || !pdfSeen}
            aria-describedby={pdfSeen ? undefined : pdfHintId}
            className={onSubmit ? outline : primary}
          >
            {busy === "download" ? "Preparing…" : "Download PDF"}
          </button>
          {onSubmit && (
            <button
              type="button"
              onClick={submit}
              disabled={!ready || busy !== null || (!edit && blocked) || !pdfSeen}
              aria-describedby={pdfSeen ? undefined : pdfHintId}
              className={primary}
            >
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
