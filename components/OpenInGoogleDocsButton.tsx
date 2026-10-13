"use client";

/**
 * Purpose: "Open in Google Docs" button. On click it asks Google for a one-time drive.file token (popup),
 * builds the DOCX in the browser, uploads it to the user's own Drive as a Google Doc and opens it. Nothing goes
 * through our server and the token is never kept (see lib/googleDocs.ts). Renders nothing when the environment has
 * no NEXT_PUBLIC_GOOGLE_CLIENT_ID. `prepare` validates the profile and returns the data to export or a message.
 * The Preview step passes `beforeUpload` (consent recording) which must succeed before anything is uploaded.
 */
import { useEffect, useState } from "react";
import { type DocxReady } from "@/lib/docxReady";
import { describeGoogleDocsError, uploadAsGoogleDoc } from "@/lib/googleDocs";
import { GOOGLE_CLIENT_ID, loadGoogleIdentity, requestDriveToken } from "@/lib/googleTokenClient";
import { renderDocxBlob } from "@/lib/generate";
import type { TemplateId } from "@/lib/schemas";

interface OpenInGoogleDocsButtonProps {
  template: TemplateId;
  /** Document title in Google Drive, e.g. "Alex Sample — internal profile". */
  title: string;
  /** Returns the validated data to export, or why the profile cannot be exported yet. Must be synchronous. */
  prepare: () => DocxReady;
  /** An already rendered DOCX to upload instead of rendering one from `prepare()`'s data. */
  blob?: Blob;
  /** Runs after the Google popup was started and before the upload; throw to stop (the message is shown). */
  beforeUpload?: () => Promise<void>;
  /** Button style: "primary" (red), "outline" (full-size outlined, next to other full-size buttons) or "secondary" (small, in lists). */
  variant?: "primary" | "secondary" | "outline";
}

type Status = { kind: "idle" } | { kind: "working"; text: string } | { kind: "error"; text: string } | { kind: "done"; url: string };

const STYLES = {
  primary: "rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50",
  outline: "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink transition hover:bg-gray-50 disabled:opacity-50",
  secondary: "rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50 disabled:opacity-50",
} as const;

export default function OpenInGoogleDocsButton({ template, title, prepare, blob, beforeUpload, variant = "secondary" }: OpenInGoogleDocsButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Load Google's script ahead of the click: the consent popup must open inside the click itself.
  useEffect(() => {
    if (GOOGLE_CLIENT_ID) loadGoogleIdentity().catch(() => undefined); // a failure is reported on click
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;
  const clientId = GOOGLE_CLIENT_ID;
  const working = status.kind === "working";

  async function onClick() {
    if (working) return;
    const ready = prepare();
    if (!ready.ok) {
      setStatus({ kind: "error", text: ready.message });
      return;
    }
    setStatus({ kind: "working", text: "Waiting for Google…" });
    // First call after the click, before any await, so the popup is allowed.
    const tokenPromise = requestDriveToken(clientId);
    try {
      const token = await tokenPromise;
      if (beforeUpload) {
        try {
          await beforeUpload();
        } catch (e) {
          setStatus({ kind: "error", text: e instanceof Error ? e.message : "We could not continue. Please try again." });
          return;
        }
      }
      setStatus({ kind: "working", text: "Creating your Google Doc…" });
      const doc = await uploadAsGoogleDoc(token, title, blob ?? (await renderDocxBlob(template, ready.data)));
      setStatus({ kind: "done", url: doc.url });
      window.open(doc.url, "_blank", "noopener,noreferrer"); // may be blocked; the link below always works
    } catch (e) {
      setStatus({ kind: "error", text: describeGoogleDocsError(e) });
    }
  }

  return (
    <span className="inline-flex flex-col items-start" data-google-docs>
      <button type="button" onClick={onClick} disabled={working} className={STYLES[variant]}>
        {working ? "Opening…" : "Open in Google Docs"}
      </button>
      <span aria-live="polite" className="mt-1 max-w-xs text-xs">
        {status.kind === "working" && <span className="text-ink-light">{status.text}</span>}
        {status.kind === "error" && <span role="alert" className="text-brand-700">{status.text}</span>}
        {status.kind === "done" && (
          <span className="text-ink-light">
            Created in your Google Drive.{" "}
            <a href={status.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
              Open in Google Docs ↗
            </a>
          </span>
        )}
      </span>
    </span>
  );
}
