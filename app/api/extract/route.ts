/**
 * Purpose: POST /api/extract — accepts a resume upload (multipart: `file`, `templateId`) and
 * returns the extracted profile for the Review screen. All LLM work happens here, server-side.
 * Logs only timing, file type, size and success/failure — never resume content.
 */
import { NextResponse } from "next/server";
import { EXTRACT_ERROR_MESSAGES, ExtractError, type ExtractErrorBody, type ExtractErrorCode, type ExtractResult } from "@/lib/extract.types";
import { extractProfile } from "@/lib/extract";
import { detectFileKind } from "@/lib/extractText";
import type { TemplateId } from "@/lib/schemas";
import { getServerConfig } from "@/lib/serverConfig";
import { getCurrentUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rateLimit";

// Each extraction costs LLM quota: cap per signed-in user.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<ExtractErrorCode, number> = {
  UNSUPPORTED_FILE: 415,
  TOO_LARGE: 413,
  UNREADABLE: 422,
  LLM_FAILED: 502,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
};

const fail = (code: ExtractErrorCode, message?: string) =>
  NextResponse.json<ExtractErrorBody>(
    { error: { code, message: message ?? EXTRACT_ERROR_MESSAGES[code] } },
    { status: STATUS[code] },
  );

/** Handles one extraction request. */
export async function POST(request: Request): Promise<NextResponse<ExtractResult | ExtractErrorBody>> {
  const started = Date.now();
  let kind = "unknown";
  let size = 0;
  try {
    // Defence in depth: proxy.ts already blocks signed-out calls, but never rely on that alone.
    const user = await getCurrentUser();
    if (!user) throw new ExtractError("UNAUTHENTICATED", EXTRACT_ERROR_MESSAGES.UNAUTHENTICATED);
    if (!allowRequest(user.id, RATE_LIMIT, RATE_WINDOW_MS)) {
      throw new ExtractError("RATE_LIMITED", "You've reached the upload limit. Please try again in a few minutes.");
    }

    const cfg = getServerConfig();
    const form = await request.formData();
    const file = form.get("file");
    const templateId = form.get("templateId");
    if (!(file instanceof File) || (templateId !== "internal" && templateId !== "external")) {
      throw new ExtractError("UNSUPPORTED_FILE", EXTRACT_ERROR_MESSAGES.UNSUPPORTED_FILE);
    }
    size = file.size;
    if (file.size > cfg.maxUploadBytes) {
      throw new ExtractError("TOO_LARGE", `That file is larger than ${Math.round(cfg.maxUploadBytes / 1024 / 1024)} MB. Please upload a smaller file.`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    kind = detectFileKind(buffer);
    const result = await extractProfile(buffer, templateId as TemplateId);
    console.info(`[extract] ok type=${kind} bytes=${size} ms=${Date.now() - started}`);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExtractError) {
      console.warn(`[extract] fail code=${e.code} type=${kind} bytes=${size} ms=${Date.now() - started}`);
      return fail(e.code, e.message);
    }
    console.error(`[extract] fail code=LLM_FAILED type=${kind} bytes=${size} ms=${Date.now() - started} (${e instanceof Error ? e.name : "unknown"})`);
    return fail("LLM_FAILED");
  }
}
