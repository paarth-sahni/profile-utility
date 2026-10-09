/**
 * Purpose: unit tests for toStrictJsonSchema on both template schemas and the analysis schema.
 * Run with `npm test` (node:test via tsx).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { externalResumeSchema, internalResumeSchema } from "./schemas";
import { reviewFlagSchema, resumeAnalysisSchema } from "./extract.types";
import { toStrictJsonSchema } from "./strictSchema";

const FORBIDDEN = ["$schema", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"];

/** Walks every node, asserting strict-mode rules; returns the number of objects checked. */
function check(node: unknown, path: string): number {
  let objects = 0;
  if (Array.isArray(node)) {
    node.forEach((n, i) => (objects += check(n, `${path}[${i}]`)));
    return objects;
  }
  if (typeof node !== "object" || node === null) return 0;
  const rec = node as Record<string, unknown>;
  for (const k of FORBIDDEN) assert.ok(!(k in rec), `${path}: forbidden keyword ${k}`);
  if (rec.properties && typeof rec.properties === "object") {
    objects += 1;
    const keys = Object.keys(rec.properties);
    assert.deepEqual(rec.required, keys, `${path}: required must list every property`);
    assert.equal(rec.additionalProperties, false, `${path}: additionalProperties must be false`);
  }
  for (const [k, v] of Object.entries(rec)) objects += check(v, `${path}.${k}`);
  return objects;
}

for (const [name, base] of [
  ["external", externalResumeSchema],
  ["internal", internalResumeSchema],
] as const) {
  test(`toStrictJsonSchema: ${name} template + reviewFlags is strict-compatible`, () => {
    const schema = base.extend({ reviewFlags: z.array(reviewFlagSchema) });
    const json = toStrictJsonSchema(schema);
    assert.ok(check(json, name) >= 3, "expected nested objects to be checked");
    const props = (json.properties ?? {}) as Record<string, unknown>;
    assert.ok("reviewFlags" in props);
  });
}

test("toStrictJsonSchema: analysis schema is strict-compatible", () => {
  check(toStrictJsonSchema(resumeAnalysisSchema), "analysis");
});
