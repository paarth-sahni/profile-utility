/**
 * Purpose: validate an uploaded resume (PDF or DOCX, by magic bytes) and turn it into clean
 * plain text for the LLM. Files never go to the LLM — only this text does.
 * Server-only (uses Node Buffer, mammoth and unpdf).
 */
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";
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
/** A bare 1-3 digit number. */
const BARE_NUMBER = /^\d{1,3}$/;

/**
 * Indexes of pages whose first (or last) line is a bare number that is part of a consecutive run
 * across neighbouring pages (3, 4, 5…) — that is a page number. A lone number such as a team size
 * or a year that happens to start a page is NOT a page number and is kept.
 */
function pageNumberPages(pages: string[], edge: "first" | "last"): Set<number> {
  const nums = pages.map((page) => {
    const lines = page.split("\n").filter((l) => l.trim());
    const t = (edge === "first" ? lines[0] : lines[lines.length - 1])?.trim() ?? "";
    return BARE_NUMBER.test(t) ? Number(t) : null;
  });
  const out = new Set<number>();
  nums.forEach((n, i) => {
    if (n === null) return;
    if (nums[i + 1] === n + 1 || nums[i - 1] === n - 1) out.add(i);
  });
  return out;
}

/** Drops page markers, page numbers, and short lines repeated on most pages. */
export function stripRepeatedLines(pages: string[]): string[] {
  const counts = new Map<string, number>();
  if (pages.length >= 3) {
    for (const page of pages) {
      for (const line of new Set(page.split("\n").map((l) => l.trim()))) {
        if (line && line.length < 80) counts.set(line, (counts.get(line) ?? 0) + 1);
      }
    }
  }
  const threshold = Math.ceil(pages.length * 0.6);
  const firstEdge = pageNumberPages(pages, "first");
  const lastEdge = pageNumberPages(pages, "last");
  return pages.map((page, p) => {
    const lines = page.split("\n");
    const firstIdx = lines.findIndex((l) => l.trim());
    const lastIdx = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim());
    return lines
      .filter((l, i) => {
        const t = l.trim();
        if (PAGE_MARKER.test(t)) return false;
        if (BARE_NUMBER.test(t) && ((i === firstIdx && firstEdge.has(p)) || (i === lastIdx && lastEdge.has(p)))) return false;
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

/** A positioned piece of text from a PDF page. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

const SIDEBAR_MARKER = "--- SIDEBAR ---";

/** Groups items into lines: same baseline (±3pt) = one line, read left to right, top to bottom. */
function itemsToLines(items: PdfTextItem[]): string[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of [...items].sort((p, q) => q.y - p.y)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= 3);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map((r) =>
    r.items
      .sort((p, q) => p.x - q.x)
      .map((i) => i.str)
      .join(" ")
      .trim(),
  );
}

/**
 * Splits one page into main column and right-hand sidebar (the internal profile layout).
 * A sidebar exists when many items start at one x position in the right half of the page and
 * (almost) nothing crosses that x. Otherwise the whole page is the main column.
 */
export function splitColumns(items: PdfTextItem[], pageWidth: number): { main: PdfTextItem[]; sidebar: PdfTextItem[] } {
  const none = { main: items, sidebar: [] as PdfTextItem[] };
  const candidates = items.filter((i) => i.x > pageWidth * 0.5 && i.str.trim());
  // candidate gutter = most common left edge (within 4pt) in the right half
  let best: { x: number; count: number } | null = null;
  for (const c of candidates) {
    const count = candidates.filter((o) => Math.abs(o.x - c.x) <= 4).length;
    if (!best || count > best.count || (count === best.count && c.x < best.x)) best = { x: c.x, count };
  }
  if (!best || best.count < 5) return none;
  const gutter = best.x - 2;
  const crossing = items.filter((i) => i.x < gutter - 2 && i.x + i.width > gutter + 2).length;
  if (crossing > 2) return none;
  return { main: items.filter((i) => i.x < gutter), sidebar: items.filter((i) => i.x >= gutter) };
}

/**
 * Reads a PDF page by page. Main-column text of every page comes first, then the sidebar text of
 * all pages joined in order under a marker — so a skill name at the bottom of one page pairs with
 * its "(3.5/5)" rating at the top of the next.
 */
async function pdfPages(buf: Buffer): Promise<{ pages: string[]; sidebar: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const main: string[] = [];
  const sidebar: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const width = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if ("str" in it && it.str.trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width });
    }
    const split = splitColumns(items, width);
    main.push(itemsToLines(split.main).join("\n"));
    if (split.sidebar.length > 0) sidebar.push(itemsToLines(split.sidebar).join("\n"));
  }
  return { pages: main, sidebar: sidebar.join("\n") };
}

/** Validates the upload and returns normalised plain text, or throws a friendly ExtractError. */
export async function extractResumeText(buf: Buffer): Promise<ExtractedText> {
  const kind = detectFileKind(buf);
  const notes: string[] = [];
  let pages: string[];
  let sidebar = "";

  try {
    if (kind === "docx") {
      const { value } = await mammoth.convertToHtml({ buffer: buf });
      pages = [htmlToText(value)];
    } else {
      ({ pages, sidebar } = await pdfPages(buf));
    }
  } catch (e) {
    console.error(`[extract] could not parse ${kind}: ${e instanceof Error ? e.name : "unknown error"}`);
    throw new ExtractError("UNREADABLE", "We couldn't open this file. Please check it isn't damaged or password-protected.");
  }

  pages = stripRepeatedLines(pages.map((p) => normalizeText(p)));
  let text = normalizeText(pages.join("\n\n"));
  if (sidebar.trim()) text = `${text}\n\n${SIDEBAR_MARKER}\n${normalizeText(sidebar)}`;

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
