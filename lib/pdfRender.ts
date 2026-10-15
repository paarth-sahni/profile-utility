/**
 * Purpose: server-side PDF of a profile. Fills the Word template exactly as the browser does (lib/docxFill.ts) and
 * converts it with LibreOffice headless (`soffice --convert-to pdf`). Every conversion runs in its own temporary
 * directory with a private LibreOffice profile (-env:UserInstallation), so parallel requests and a LibreOffice window
 * on the same machine never interfere; the directory is deleted afterwards. Nothing is stored and no profile content
 * is logged.
 *
 * Fonts: the templates carry embedded copies of the brand fonts, one of them mislabelled (the embedded "Lexend Light
 * bold" file is Lexend Regular), which LibreOffice then uses for all "Lexend Light" text. The PDF copy of the DOCX
 * therefore drops the embedded fonts and LibreOffice uses the real Lexend files from public/fonts, copied into the
 * temporary directory and made visible through a private fontconfig file (nothing has to be installed system-wide,
 * and fontconfig's cache files land in the temporary directory, never in public/). Settings: SOFFICE_PATH (default
 * "soffice"), PDF_FONTS_DIR (default public/fonts).
 */
import "server-only";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type PizZip from "pizzip";
import { fillTemplate } from "./docxFill";
import type { ResumeData, TemplateId } from "./schemas";

export type PdfErrorCode = "CONVERTER_MISSING" | "CONVERSION_FAILED" | "TEMPLATE_FAILED";

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfError";
  }
}

const PUBLIC_DIR = path.join(process.cwd(), "public");
const SOFFICE = () => process.env.SOFFICE_PATH?.trim() || "soffice";
// turbopackIgnore: a path from the environment must not make the build trace (and ship) the whole project
const FONTS_DIR = () => path.resolve(/*turbopackIgnore: true*/ process.env.PDF_FONTS_DIR?.trim() || path.join(PUBLIC_DIR, "fonts"));
const TIMEOUT_MS = 60_000;
/** LibreOffice is heavy: at most this many conversions run at once, the rest wait their turn. */
const MAX_PARALLEL = 2;

/** Fills public/templates/<id>.docx with the profile. */
export async function renderProfileDocx(id: TemplateId, data: ResumeData): Promise<PizZip> {
  const template = await readFile(path.join(PUBLIC_DIR, "templates", `${id}.docx`));
  try {
    return fillTemplate(template, id, data);
  } catch (e) {
    throw new PdfError("TEMPLATE_FAILED", e instanceof Error ? e.message : "The template could not be filled.");
  }
}

/** Removes the embedded fonts (files, relationships and fontTable references) so the installed brand fonts are used. */
export function withoutEmbeddedFonts(zip: PizZip): PizZip {
  for (const name of Object.keys(zip.files)) if (name.startsWith("word/fonts/")) zip.remove(name);
  const table = zip.file("word/fontTable.xml");
  if (table) zip.file("word/fontTable.xml", table.asText().replace(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*\/>/g, ""));
  const rels = zip.file("word/_rels/fontTable.xml.rels");
  if (rels) zip.file("word/_rels/fontTable.xml.rels", rels.asText().replace(/<Relationship\b[^>]*\/>/g, ""));
  const settings = zip.file("word/settings.xml");
  if (settings) zip.file("word/settings.xml", settings.asText().replace(/<w:embedTrueTypeFonts\b[^>]*\/>/g, ""));
  return zip;
}

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error) => (error ? reject(error) : resolve()));
  });
}

/** Converts DOCX bytes to PDF bytes with LibreOffice headless. */
export async function convertDocxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  return withSlot(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "profile-pdf-"));
    try {
      const input = path.join(dir, "profile.docx");
      await writeFile(input, docx);
      const fonts = path.join(dir, "fonts");
      await cp(FONTS_DIR(), fonts, { recursive: true, filter: (src) => !path.basename(src).startsWith(".") });
      const fontsConf = path.join(dir, "fonts.conf");
      await writeFile(
        fontsConf,
        `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${fonts}</dir></fontconfig>\n`,
      );
      const args = [
        `-env:UserInstallation=${pathToFileURL(path.join(dir, "lo-profile")).href}`, // a real file URL: file:///C:/... on Windows, file:///tmp/... on Linux
        "--headless",
        "--norestore",
        "--nologo",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        input,
      ];
      try {
        await run(SOFFICE(), args, { ...process.env, FONTCONFIG_FILE: fontsConf, HOME: dir });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          throw new PdfError("CONVERTER_MISSING", `LibreOffice ("${SOFFICE()}") is not installed on the server, so no PDF can be made.`);
        }
        throw new PdfError("CONVERSION_FAILED", "LibreOffice could not convert the document.");
      }
      try {
        return new Uint8Array(await readFile(path.join(dir, "profile.pdf")));
      } catch {
        throw new PdfError("CONVERSION_FAILED", "LibreOffice did not produce a PDF.");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/** The profile as a PDF: the filled template, without its embedded fonts, converted by LibreOffice. */
export async function renderProfilePdf(id: TemplateId, data: ResumeData): Promise<Uint8Array> {
  const zip = withoutEmbeddedFonts(await renderProfileDocx(id, data));
  return convertDocxToPdf(zip.generate({ type: "uint8array", compression: "DEFLATE" }));
}
