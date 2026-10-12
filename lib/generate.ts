import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";
import { prepareData } from "./docxData";
import type { ResumeData, TemplateId } from "./schemas";

interface DocxTemplaterError extends Error {
  properties?: {
    errors?: Array<{
      properties?: { explanation?: string; id?: string; xtag?: string };
      message?: string;
    }>;
    explanation?: string;
  };
}

function explainError(error: unknown): string {
  const e = error as DocxTemplaterError;
  const subErrors = e?.properties?.errors;
  if (Array.isArray(subErrors) && subErrors.length > 0) {
    const lines = subErrors.map((sub) => {
      const p = sub.properties ?? {};
      const tag = p.xtag ? ` (tag: {${p.xtag}})` : "";
      return `• ${p.explanation ?? sub.message ?? "unknown template error"}${tag}`;
    });
    return `Template rendering failed:\n${lines.join("\n")}`;
  }
  if (e?.properties?.explanation) return `Template rendering failed: ${e.properties.explanation}`;
  return `Failed to generate document: ${e instanceof Error ? e.message : String(error)}`;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Render the selected template with the given data and return the filled .docx as a Blob. */
export async function renderDocxBlob(id: TemplateId, data: ResumeData): Promise<Blob> {
  const res = await fetch(`${BASE}/templates/${id}.docx`);
  if (!res.ok) throw new Error(`Could not load template "${id}.docx" (HTTP ${res.status}).`);
  const buffer = await res.arrayBuffer();

  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(new PizZip(buffer), {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(prepareData(id, data));
  } catch (error) {
    throw new Error(explainError(error));
  }

  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

export async function generateDocx(id: TemplateId, data: ResumeData, fileName: string): Promise<void> {
  saveAs(await renderDocxBlob(id, data), fileName);
}
