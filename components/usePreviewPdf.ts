"use client";

/**
 * Purpose: the PDF of the Preview step. The same Blob is shown in the preview and saved by "Download PDF", so what the person
 * sees is exactly the file they get. Exposes idle / loading / ready / error (with the HTTP status, 401 = session ended).
 *   - `auto` (external profiles): the PDF is built when Preview opens and kept; `retry` builds it again.
 *   - otherwise (internal profiles, whose text can be edited on Preview): nothing is built until `build(data)` is called
 *     (View PDF, Download PDF). The ready PDF remembers the data it was built from, so a caller can tell when it is out of
 *     date (`pdf.forData !== data`). A download passes `{ consent: "download" }` (recorded by the server after its checks).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PdfRequestError, fetchProfilePdf, type PdfComplianceMatch, type PdfFieldIssue } from "@/lib/pdfClient";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export type PreviewPdf =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; blob: Blob; forData: ResumeData }
  | { status: "error"; message: string; httpStatus: number; code?: string; matches?: PdfComplianceMatch[]; fields?: PdfFieldIssue[] };

const failure = (e: unknown): Extract<PreviewPdf, { status: "error" }> => ({
  status: "error",
  message: e instanceof Error ? e.message : String(e),
  httpStatus: e instanceof PdfRequestError ? e.status : 0,
  code: e instanceof PdfRequestError ? e.code : undefined,
  matches: e instanceof PdfRequestError ? e.matches : undefined,
  fields: e instanceof PdfRequestError ? e.fields : undefined,
});

export function usePreviewPdf(template: TemplateId, data: ResumeData, { auto }: { auto: boolean }) {
  const [pdf, setPdf] = useState<PreviewPdf>(auto ? { status: "loading" } : { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    setPdf({ status: "loading" });
    fetchProfilePdf(template, data)
      .then((blob) => {
        if (!cancelled) setPdf({ status: "ready", blob, forData: data });
      })
      .catch((e: unknown) => {
        console.error("[preview] could not build the PDF");
        if (!cancelled) setPdf(failure(e));
      });
    return () => {
      cancelled = true;
    };
  }, [auto, template, data, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** Builds the PDF of `d` now; resolves with the Blob (also kept as the ready PDF) or the error state (also kept). */
  const build = useCallback(
    async (d: ResumeData, options: { consent?: "download" } = {}): Promise<PreviewPdf> => {
      const mine = ++seq.current;
      setPdf({ status: "loading" });
      try {
        const blob = await fetchProfilePdf(template, d, options);
        const ready: PreviewPdf = { status: "ready", blob, forData: d };
        if (mine === seq.current) setPdf(ready);
        return ready;
      } catch (e) {
        console.error("[preview] could not build the PDF");
        const failed = failure(e);
        if (mine === seq.current) setPdf(failed);
        return failed;
      }
    },
    [template],
  );

  return { pdf, retry, build };
}
