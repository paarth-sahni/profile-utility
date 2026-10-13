import { saveAs } from "file-saver";
import { fillTemplate } from "./docxFill";
import type { ResumeData, TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Render the selected template with the given data and return the filled .docx as a Blob (used for the Google Docs upload). */
export async function renderDocxBlob(id: TemplateId, data: ResumeData): Promise<Blob> {
  const res = await fetch(`${BASE}/templates/${id}.docx`);
  if (!res.ok) throw new Error(`Could not load template "${id}.docx" (HTTP ${res.status}).`);
  return fillTemplate(await res.arrayBuffer(), id, data).generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

export async function generateDocx(id: TemplateId, data: ResumeData, fileName: string): Promise<void> {
  saveAs(await renderDocxBlob(id, data), fileName);
}

/** Saves an already rendered DOCX (the Preview step downloads the very file it shows). */
export function saveDocxBlob(blob: Blob, fileName: string): void {
  saveAs(blob, fileName);
}
