"use client";

import { useState } from "react";
import { checkReadyForDocx, pdfFileName } from "@/lib/docxReady";
import { PdfRequestError, fetchProfilePdf, savePdf } from "@/lib/pdfClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

/** Downloads a saved version as PDF (made by the server, POST /api/pdf). Incomplete drafts are sent back to Review to be finished. */
export default function DownloadPdfButton({
  template,
  data,
  versionId,
}: {
  template: TemplateId;
  data: ResumeData;
  versionId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setMessage(null);
    const ready = checkReadyForDocx(template, data);
    if (!ready.ok) {
      setMessage(ready.message);
      return;
    }
    setBusy(true);
    try {
      savePdf(await fetchProfilePdf(template, ready.data), pdfFileName(ready.data));
    } catch (e) {
      setMessage(
        e instanceof PdfRequestError && e.status === 401
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
    <span className="inline-flex flex-col items-start" data-version={versionId}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Preparing…" : "Download PDF"}
      </button>
      {message && (
        <span role="alert" className="mt-1 max-w-xs text-xs text-brand-700">
          {message}
        </span>
      )}
    </span>
  );
}
