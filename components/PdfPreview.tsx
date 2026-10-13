"use client";

/**
 * Purpose: shows the generated PDF in the page. It is given the finished Blob — the same object Download PDF saves — so
 * the preview is of the exact file. Every page is drawn with pdf.js (through unpdf, loaded only here) instead of the
 * browser's PDF viewer, because phones do not show a PDF inside a page (Android offers a download, iOS shows page 1
 * only). The pages scale to the available width. The text of each page is kept for screen readers, and the file's
 * SHA-256 is exposed as data-pdf-sha256 so the end-to-end checks can prove the download is the previewed file.
 */
import { useEffect, useRef, useState } from "react";

type RenderState = "loading" | "ready" | "error";

/** Pixels per PDF point: sharp on high-density screens, the canvas is then scaled down by CSS. */
const RENDER_SCALE = 2;

async function sha256(blob: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function PdfPreview({ blob }: { blob: Blob }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    setPages([]);
    (async () => {
      try {
        const [{ getDocumentProxy }, bytes, digest] = await Promise.all([import("unpdf"), blob.arrayBuffer(), sha256(blob)]);
        const doc = await getDocumentProxy(new Uint8Array(bytes));
        const el = host.current;
        if (cancelled || !el) return;
        el.innerHTML = "";
        const texts: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "block h-auto w-full bg-white shadow-sm";
          canvas.dataset.pdfPage = String(n);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot draw the preview.");
          await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
          const content = await page.getTextContent();
          texts.push(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
          );
          if (cancelled) return;
          el.appendChild(canvas);
        }
        if (!cancelled) {
          setPages(texts);
          setHash(digest);
          setState("ready");
        }
      } catch (e) {
        console.error("[preview] could not show the PDF");
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
      data-pdf-preview={state}
      data-pdf-pages={state === "ready" ? pages.length : undefined}
      data-pdf-sha256={hash ?? undefined}
    >
      {state === "loading" && (
        <p role="status" className="px-4 py-10 text-center text-sm text-ink-light">
          Building your preview…
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="whitespace-pre-wrap px-4 py-6 text-sm text-brand-700">
          We could not show the preview{error ? `: ${error}` : "."} You can still go back and edit, or try again.
        </p>
      )}
      <div className={`bg-cream p-2 ${state === "ready" ? "" : "hidden"}`}>
        <div ref={host} aria-hidden="true" className="mx-auto flex max-w-[850px] flex-col gap-3" />
        <div className="sr-only" data-pdf-text aria-label="Document preview">
          {pages.map((text, i) => (
            <p key={i}>
              Page {i + 1}: {text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
