/**
 * Purpose: validate an uploaded resume (PDF or DOCX, by magic bytes) and turn it into clean
 * plain text for the LLM. Files never go to the LLM — only this text does.
 * Server-only (uses Node Buffer, mammoth and unpdf).
 */
import mammoth from "mammoth";
import { extractText as extractPdfPages, getDocumentProxy } from "unpdf";
import { EXTRACT_ERROR_MESSAGES, ExtractError } from "./extract.types";

export type FileKind = "pdf" | "docx";

export interface ExtractedText {
  text: string;
  kind: FileKind;
  /** Review notes about the extraction itself (e.g. truncation). */
  notes: string[];
}

const MAX_CHARS = 60_000;
const MIN_TOTAL_CHARS = 300;
const MIN_CHARS_PER_PAGE = 50;

/** Detects the real file type from magic bytes (the extension/MIME type is not trusted). */
export function detectFileKind(buf: Buffer): FileKind {
  const head = buf.subarray(0, 1024).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip && buf.includes("word/document.xml")) return "docx";
  throw new ExtractError("UNSUPPORTED_FILE", EXTRACT_ERROR_MESSAGES.UNSUPPORTED_FILE);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Converts mammoth's HTML to text: headings, list items and table cells each become their own line. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|h[1-6]|li|tr|td|th|div|ul|ol|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ""));
}

/** Explicit page markers: "Page 2", "Page 2 of 5", "2 of 5", "2 / 5". */
const PAGE_MARKER = /^(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+)$/i;
/** A bare 1-3 digit number — only a page number when it is the first/last line of a multi-page document's page. */
const BARE_NUMBER = /^\d{1,3}$/;

/** Drops page markers, bare page numbers at page edges, and short lines repeated on most pages. */
function stripRepeatedLines(pages: string[]): string[] {
  const multi = pages.length > 1;
  const counts = new Map<string, number>();
  if (pages.length >= 3) {
    for (const page of pages) {
      for (const line of new Set(page.split("\n").map((l) => l.trim()))) {
        if (line && line.length < 80) counts.set(line, (counts.get(line) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.ceil(pages.length * 0.6);
  return pages.map((page) => {
    const lines = page.split("\n");
    const last = lines.length - 1;
    return lines
      .filter((l, i) => {
        const t = l.trim();
        if (PAGE_MARKER.test(t)) return false;
        if (multi && BARE_NUMBER.test(t) && (i === 0 || i === last)) return false;
        return pages.length < 3 || (counts.get(t) ?? 0) < threshold;
      })
      .join("\n");
  });
}

/** Collapses whitespace, repairs hyphenated line breaks and trims blank runs. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function pdfPages(buf: Buffer): Promise<string[]> {
  // TODO: group text items into columns by x position (main column first, then the sidebar
  // under a "--- SIDEBAR ---" marker) so two-column InfoBeans internal profiles don't interleave.
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractPdfPages(pdf, { mergePages: false });
  return text;
}

/** Validates the upload and returns normalised plain text, or throws a friendly ExtractError. */
export async function extractResumeText(buf: Buffer): Promise<ExtractedText> {
  const kind = detectFileKind(buf);
  const notes: string[] = [];
  let pages: string[];

  try {
    if (kind === "docx") {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      pages = [htmlToText(value)];
    } else {
      pages = await pdfPages(buf);
    }
  } catch (e) {
    console.error(`[extract] could not parse ${kind}: ${e instanceof Error ? e.name : "unknown error"}`);
    throw new ExtractError("UNREADABLE", "We couldn't open this file. Please check it isn't damaged or password-protected.");
  }

  pages = stripRepeatedLines(pages.map((p) => normalizeText(p)));
  let text = normalizeText(pages.join("\n\n"));

  const perPage = pages.length > 0 ? text.length / pages.length : 0;
  if (text.length < MIN_TOTAL_CHARS || (kind === "pdf" && perPage < MIN_CHARS_PER_PAGE)) {
    throw new ExtractError("UNREADABLE", EXTRACT_ERROR_MESSAGES.UNREADABLE);
  }
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    notes.push("The resume was very long, so only the first part was read.");
  }
  return { text, kind, notes };
}
