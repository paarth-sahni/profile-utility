/**
 * Purpose: fills a Word template with a profile (docxtemplater + prepareData). Pure: it takes the template bytes and
 * returns the filled zip, so the browser (lib/generate.ts, Google Docs upload) and the server (lib/pdfRender.ts, the
 * PDF download and preview) fill the template in exactly the same way.
 */
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
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

/** Fills the template (the .docx bytes) with the profile and returns the filled document as a zip. */
export function fillTemplate(template: ArrayBuffer | Uint8Array, id: TemplateId, data: ResumeData): PizZip {
  try {
    const doc = new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true });
    doc.render(prepareData(id, data));
    return doc.getZip();
  } catch (error) {
    throw new Error(explainError(error));
  }
}
