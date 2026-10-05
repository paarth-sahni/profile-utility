import { saveAs } from "file-saver";
import type { ResumeData, TemplateId } from "./schemas";
import { buildResumePdf, type PdfAssets } from "./pdf";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let assetsPromise: Promise<PdfAssets> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load asset ${url} (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadAssets(): Promise<PdfAssets> {
  assetsPromise ??= (async () => {
    const [lexendLight, lexend, lexendMedium, logoPng] = await Promise.all([
      fetchBytes(`${BASE}/fonts/LexendLight-regular.ttf`),
      fetchBytes(`${BASE}/fonts/Lexend-regular.ttf`),
      fetchBytes(`${BASE}/fonts/LexendMedium-regular.ttf`),
      fetchBytes(`${BASE}/img/logo.png`),
    ]);
    return { lexendLight, lexend, lexendMedium, logoPng };
  })().catch((e) => {
    assetsPromise = null; // allow retry after a transient failure
    throw e;
  });
  return assetsPromise;
}

/** Build the PDF in the browser and return it as a Blob. */
export async function renderPdfBlob(id: TemplateId, data: ResumeData): Promise<Blob> {
  const bytes = await buildResumePdf(id, data, await loadAssets());
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/** Build the PDF and download it directly. */
export async function generatePdf(id: TemplateId, data: ResumeData, fileName: string): Promise<void> {
  saveAs(await renderPdfBlob(id, data), fileName);
}
