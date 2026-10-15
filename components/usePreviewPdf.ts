"use client";

/**
 * Purpose: builds the PDF for the Preview step once and keeps it. The same Blob is shown in the preview and saved by
 * "Download PDF", so what the person sees is exactly the file they get. Exposes loading / ready / error (with the
 * HTTP status, 401 = session ended) and a retry.
 */
import { useCallback, useEffect, useState } from "react";
import { PdfRequestError, fetchProfilePdf } from "@/lib/pdfClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export type PreviewPdf = { status: "loading" } | { status: "ready"; blob: Blob } | { status: "error"; message: string; httpStatus: number };

export function usePreviewPdf(template: TemplateId, data: ResumeData): { pdf: PreviewPdf; retry: () => void } {
  const [pdf, setPdf] = useState<PreviewPdf>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPdf({ status: "loading" });
    fetchProfilePdf(template, data)
      .then((blob) => {
        if (!cancelled) setPdf({ status: "ready", blob });
      })
      .catch((e: unknown) => {
        console.error("[preview] could not build the PDF");
        if (!cancelled) {
          setPdf({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
            httpStatus: e instanceof PdfRequestError ? e.status : 0,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [template, data, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { pdf, retry };
}
