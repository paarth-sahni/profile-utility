/**
 * Purpose: convert a zod schema into the JSON Schema dialect accepted by Groq's
 * `response_format: json_schema` strict mode (every property required,
 * additionalProperties:false on every object, validation keywords stripped).
 * zod still enforces the stripped rules after the model call.
 */
import { z } from "zod";

type JsonObject = { [key: string]: unknown };

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keywords strict mode may reject; zod re-checks them afterwards. */
const STRIPPED_KEYS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minimum",
  "maximum",
]);

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIPPED_KEYS.has(key)) continue;
    out[key] = walk(value);
  }
  if (isObject(out.properties)) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

/** Returns a strict-mode-compatible JSON Schema for `schema`. */
export function toStrictJsonSchema(schema: z.ZodType): JsonObject {
  const raw = z.toJSONSchema(schema, { io: "output" });
  const strict = walk(raw);
  if (!isObject(strict)) throw new Error("toStrictJsonSchema: unexpected non-object schema");
  return strict;
}
