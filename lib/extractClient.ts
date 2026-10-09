/**
 * Purpose: browser-side service for POST /api/extract. Components call uploadResume() instead of
 * using fetch directly, and get friendly errors with a stable `code`.
 */
import {
  EXTRACT_ERROR_MESSAGES,
  type ExtractErrorBody,
  type ExtractErrorCode,
  type ExtractResult,
} from "./extract.types";
import type { TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Client-side error carrying one of the server's friendly error codes. */
export class UploadError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

const isErrorBody = (v: unknown): v is ExtractErrorBody =>
  typeof v === "object" && v !== null && "error" in v && typeof (v as ExtractErrorBody).error?.code === "string";

/** Uploads a resume and returns the extracted profile; throws UploadError on any failure. */
export async function uploadResume(file: File, templateId: TemplateId, signal?: AbortSignal): Promise<ExtractResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("templateId", templateId);

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/extract`, { method: "POST", body, signal });
  } catch (e) {
    console.error("[upload] request failed", e);
    throw new UploadError("LLM_FAILED", EXTRACT_ERROR_MESSAGES.LLM_FAILED);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new UploadError("LLM_FAILED", EXTRACT_ERROR_MESSAGES.LLM_FAILED);
  }
  if (!res.ok) {
    if (isErrorBody(json)) throw new UploadError(json.error.code, json.error.message);
    throw new UploadError("LLM_FAILED", EXTRACT_ERROR_MESSAGES.LLM_FAILED);
  }
  return json as ExtractResult;
}
