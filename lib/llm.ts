/**
 * Purpose: the only module that talks to the LLM provider (Groq via the OpenAI-compatible API).
 * Exposes completeJson() so the rest of the pipeline is provider-agnostic.
 * Server-only. Never logs prompts, resumes or model output.
 */
import OpenAI from "openai";
import type { z } from "zod";
import { ExtractError } from "./extract.types";
import { getServerConfig, type ReasoningEffort } from "./serverConfig";
import { toStrictJsonSchema } from "./strictSchema";

export interface CompleteJsonArgs {
  model: string;
  system: string;
  user: string;
  /** zod schema describing the expected JSON; converted to a strict JSON Schema. */
  schema: z.ZodType;
  schemaName: string;
  signal?: AbortSignal;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
}

const MAX_RETRY_WAIT_MS = 15_000;

let cachedClient: OpenAI | null = null;
function client(): OpenAI {
  if (!cachedClient) {
    const cfg = getServerConfig();
    cachedClient = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 0 });
  }
  return cachedClient;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ExtractError("TIMEOUT", "Timed out"));
    });
  });

type ResponseFormat = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming["response_format"];

async function request(args: CompleteJsonArgs, responseFormat: ResponseFormat, system: string): Promise<string> {
  const cfg = getServerConfig();
  const res = await client().chat.completions.create(
    {
      model: args.model,
      temperature: 0.2,
      reasoning_effort: args.reasoningEffort ?? cfg.reasoningEffort,
      max_completion_tokens: args.maxTokens ?? 8000,
      response_format: responseFormat,
      messages: [
        { role: "system", content: system },
        { role: "user", content: args.user },
      ],
    },
    { signal: args.signal },
  );
  // Read only message.content — never message.reasoning.
  return res.choices[0]?.message?.content ?? "";
}

/** One attempt with 429 handling: wait for retry-after once, then give up with RATE_LIMITED. */
async function withRateLimitRetry(fn: () => Promise<string>, signal?: AbortSignal): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OpenAI.APIError && e.status === 429) {
      const retryAfter = Number(e.headers?.get("retry-after"));
      const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000, MAX_RETRY_WAIT_MS);
      await sleep(waitMs, signal);
      try {
        return await fn();
      } catch (e2) {
        if (e2 instanceof OpenAI.APIError && e2.status === 429) {
          throw new ExtractError("RATE_LIMITED", "The service is busy, try again in a minute.");
        }
        throw e2;
      }
    }
    throw e;
  }
}

/**
 * Asks the model for JSON matching `schema` and returns the raw JSON text (caller parses/validates).
 * Uses json_schema strict mode; if the provider answers 400 about the schema, falls back to
 * json_object for this call. Errors are mapped to ExtractError codes.
 */
export async function completeJson(args: CompleteJsonArgs): Promise<string> {
  const jsonSchema = toStrictJsonSchema(args.schema);
  try {
    try {
      return await withRateLimitRetry(
        () =>
          request(
            args,
            { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: jsonSchema } },
            args.system,
          ),
        args.signal,
      );
    } catch (e) {
      const schemaRejected = e instanceof OpenAI.APIError && e.status === 400 && /schema|response_format|json/i.test(e.message);
      if (!schemaRejected) throw e;
      console.warn(`[extract] ${args.schemaName}: provider rejected strict schema (400); falling back to json_object`);
      const system = `${args.system}\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
      return await withRateLimitRetry(() => request(args, { type: "json_object" }, system), args.signal);
    }
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    if (args.signal?.aborted || e instanceof OpenAI.APIUserAbortError) {
      throw new ExtractError("TIMEOUT", "Timed out");
    }
    const status = e instanceof OpenAI.APIError ? e.status : undefined;
    console.error(`[extract] ${args.schemaName}: LLM call failed (status ${status ?? "n/a"}, ${e instanceof Error ? e.name : "unknown"})`);
    throw new ExtractError("LLM_FAILED", "The language model request failed.");
  }
}
