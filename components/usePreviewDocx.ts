"use client";

/**
 * Purpose: builds the DOCX for the Preview step once and keeps it. The same Blob is shown in the preview, saved by
 * "Download DOCX" and uploaded by "Open in Google Docs", so what the person sees is exactly the file they get.
 * Exposes loading / ready / error and a retry.
 */
import { useCallback, useEffect, useState } from "react";
import { renderDocxBlob } from "@/lib/generate";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export type PreviewDocx = { status: "loading" } | { status: "ready"; blob: Blob } | { status: "error"; message: string };

export function usePreviewDocx(template: TemplateId, data: ResumeData): { docx: PreviewDocx; retry: () => void } {
  const [docx, setDocx] = useState<PreviewDocx>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDocx({ status: "loading" });
    renderDocxBlob(template, data)
      .then((blob) => {
        if (!cancelled) setDocx({ status: "ready", blob });
      })
      .catch((e: unknown) => {
        console.error("[preview] could not build the DOCX");
        if (!cancelled) setDocx({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [template, data, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { docx, retry };
}
