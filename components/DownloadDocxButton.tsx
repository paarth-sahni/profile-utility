"use client";

import { useState } from "react";
import { generateDocx } from "@/lib/generate";
import { describeFieldPath, findNAIssues, schemaFor, type ResumeData, type TemplateId } from "@/lib/schemas";

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
    const parsed = schemaFor(template).safeParse(data);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setMessage(
        `Incomplete: ${first.path.length ? describeFieldPath(first.path as (string | number)[]) : "profile"} — ${first.message}. Open in Review to finish it.`,
      );
      return;
    }
    const na = findNAIssues(template, parsed.data);
    if (na.length > 0) {
      setMessage(`Fix "${na[0].path}" in Review before downloading.`);
      return;
    }
    setBusy(true);
    try {
      const who = (data as { name?: string }).name?.trim().replace(/\s+/g, "_") || "resume";
      await generateDocx(template, parsed.data, `${who}_${template}_profile.docx`);
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
