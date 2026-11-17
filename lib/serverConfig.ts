/**
 * Purpose: server-only configuration for the extraction pipeline, read from environment
 * variables (see .env.example). Never import this from client components.
 */
import { ExtractError } from "./extract.types";

export type ReasoningEffort = "low" | "medium" | "high";

export interface ServerConfig {
  apiKey: string;
  baseURL: string;
  modelAnalyze: string;
  modelExtract: string;
  modelFallback: string;
  reasoningEffort: ReasoningEffort;
  maxUploadBytes: number;
  /** How long one upload may take in total before it is given up (default 60 s; EXTRACT_TIMEOUT_MS to change it). */
  extractTimeoutMs: number;
}

const DEFAULT_EXTRACT_TIMEOUT_MS = 60_000;

const toEffort = (v: string | undefined): ReasoningEffort =>
  v === "low" || v === "high" ? v : "medium";

/** Reads and validates the extraction config; throws LLM_FAILED if the API key is missing. */
export function getServerConfig(): ServerConfig {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.error("[extract] GROQ_API_KEY is not set");
    throw new ExtractError("LLM_FAILED", "The extraction service is not configured.");
  }
  const maxMb = Number(process.env.MAX_UPLOAD_MB);
  const timeoutMs = Number(process.env.EXTRACT_TIMEOUT_MS);
  return {
    apiKey,
    baseURL: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
    modelAnalyze: process.env.LLM_MODEL_ANALYZE?.trim() || "openai/gpt-oss-20b",
    modelExtract: process.env.LLM_MODEL_EXTRACT?.trim() || "openai/gpt-oss-120b",
    modelFallback: process.env.LLM_MODEL_FALLBACK?.trim() || "openai/gpt-oss-20b",
    reasoningEffort: toEffort(process.env.LLM_REASONING_EFFORT),
    maxUploadBytes: (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 10) * 1024 * 1024,
    extractTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 10_000 ? timeoutMs : DEFAULT_EXTRACT_TIMEOUT_MS,
  };
}
