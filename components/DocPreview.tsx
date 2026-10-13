"use client";

/**
 * Purpose: shows a generated DOCX in the browser (docx-preview). It is given the finished Blob — the same object the
 * Download button saves and Google Docs receives — so the preview is of the exact file, not a re-render. Shows its own
 * loading and error states. On narrow screens the page is scaled down to fit instead of scrolling sideways.
 * Rendering is approximate where Word and the browser differ (e.g. fonts the device does not have). To stay close to
 * Word / Google Docs it uses docx-preview's tab-stop layout, switches hyphenation off, and puts the anchored logo at its
 * anchored position (lib/docxAnchors.ts). All of that changes only what is drawn, never the DOCX.
 */
import { useEffect, useRef, useState } from "react";
import PizZip from "pizzip";
import { NO_HYPHENS_CSS, applyAnchors, parseAnchors } from "@/lib/docxAnchors";

type RenderState = "loading" | "ready" | "error";

export default function DocPreview({ blob }: { blob: Blob }) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>("loading");
  const [error, setError] = useState<string | null>(null);

  // render the blob into the host element
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !host.current) return;
        host.current.innerHTML = "";
        await renderAsync(blob, host.current, undefined, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true, // tab stops: "A PROUD MEMBER OF" is positioned with tabs
        });
        const noHyphens = document.createElement("style");
        noHyphens.textContent = NO_HYPHENS_CSS;
        host.current.prepend(noHyphens);
        try {
          const xml = new PizZip(await blob.arrayBuffer()).file("word/document.xml")?.asText();
          if (xml) applyAnchors(host.current, parseAnchors(xml));
        } catch (e) {
          console.error("[preview] could not position the logo", e); // the preview still works without it
        }
        const wrapper = host.current.querySelector<HTMLElement>(".docx-wrapper");
        if (wrapper) wrapper.style.background = "transparent"; // docx-preview's default grey is off-brand
        if (!cancelled) setState("ready");
      } catch (e) {
        console.error("[preview] could not render the DOCX", e);
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

  // scale the (fixed-width) pages down to the available width
  useEffect(() => {
    const el = frame.current;
    const content = host.current;
    if (!el || !content || state !== "ready") return;
    const fit = () => {
      const page = content.querySelector<HTMLElement>("section.docx");
      if (!page) return;
      const wrapper = content.querySelector<HTMLElement>(".docx-wrapper");
      if (wrapper) wrapper.style.padding = "0";
      const wanted = page.offsetWidth;
      const scale = wanted > 0 ? Math.min(1, (el.clientWidth - 16) / wanted) : 1;
      content.style.setProperty("zoom", String(scale));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm" data-doc-preview={state}>
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
      <div ref={frame} className={`bg-cream p-2 ${state === "ready" ? "" : "hidden"}`}>
        <div ref={host} aria-label="Document preview" />
      </div>
    </div>
  );
}
