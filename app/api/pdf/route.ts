/**
 * Purpose: POST /api/pdf — turns a profile into the PDF that Preview shows and Download PDF saves. Signed-in users
 * only, rate-limited per user. Body: { template, data }; the data must pass the strict schema and the "N/A" check (the
 * same gate as every export). The Word template is filled exactly as in the browser and converted by LibreOffice
 * (lib/pdfRender.ts). Nothing is stored and no profile content is logged; the response is not cached.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkReadyForDocx, pdfFileName } from "@/lib/docxReady";
import { PdfError, renderProfilePdf } from "@/lib/pdfRender";
import { allowRequest } from "@/lib/rateLimit";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200_000;
const TEMPLATES: readonly TemplateId[] = ["internal", "external"];

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!allowRequest(`pdf:${user.id}`, 60, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "Too many PDFs in a short time. Please wait a moment and try again.");
  }

  let body: { template?: unknown; data?: unknown };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    body = JSON.parse(raw);
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  if (!body || typeof body !== "object" || !TEMPLATES.includes(body.template as TemplateId)) {
    return err(400, "BAD_REQUEST", "Unknown profile type.");
  }
  const template = body.template as TemplateId;
  const ready = checkReadyForDocx(template, body.data as ResumeData);
  if (!ready.ok) return err(422, "INCOMPLETE", ready.message);

  try {
    const pdf = await renderProfilePdf(template, ready.data);
    const name = pdfFileName(ready.data);
    const ascii = name.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const code = e instanceof PdfError ? e.code : "CONVERSION_FAILED";
    console.error(`[pdf] could not make the PDF (${code})`); // the code only: never the profile or the converter's output
    if (code === "CONVERTER_MISSING") return err(503, code, "PDF creation is not available on this server right now. Please contact support.");
    return err(500, code, "We could not create the PDF. Please try again.");
  }
}
