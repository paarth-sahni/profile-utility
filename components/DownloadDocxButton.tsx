"use client";

import { useState } from "react";
import { generateDocx } from "@/lib/generate";
import { checkReadyForDocx, docxFileName } from "@/lib/docxReady";
import type { ResumeData, TemplateId } from "@/lib/schemas";

/** Downloads a saved version as DOCX. Incomplete drafts are sent back to Review to be finished. */
export default function DownloadDocxButton({
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
      await generateDocx(template, ready.data, docxFileName(template, data));
    } catch {
      setMessage("We could not generate the DOCX. Please try again.");
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
        {busy ? "Generating..." : "Download DOCX"}
      </button>
      {message && <span className="mt-1 max-w-xs text-xs text-brand-700">{message}</span>}
    </span>
  );
}
