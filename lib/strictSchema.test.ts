/**
 * Purpose: unit tests for toStrictJsonSchema on both template schemas and the analysis schema.
 * Run with `npm test` (node:test via tsx).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractionSchemaFor, resumeAnalysisSchema } from "./extract.types";
import { toStrictJsonSchema } from "./strictSchema";

/**
 * Groq strict mode (checked 2026-10-16 on gpt-oss-20b and gpt-oss-120b) refuses a schema only when an object
 * misses `required` for some property or `additionalProperties: false` — `check` asserts both. It accepts the
 * value keywords below but does not promise to enforce them, so they stay out and zod checks them after parsing.
 */
const FORBIDDEN = [
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
];

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

for (const name of ["external", "internal"] as const) {
  test(`toStrictJsonSchema: ${name} extraction schema (profile + reviewFlags) is strict-compatible`, () => {
    const json = toStrictJsonSchema(extractionSchemaFor(name));
    assert.ok(check(json, name) >= 3, "expected nested objects to be checked");
    const props = (json.properties ?? {}) as Record<string, unknown>;
    assert.ok("reviewFlags" in props);
  });
}

test("toStrictJsonSchema: the skill rating limits stay out of the JSON Schema (zod enforces them)", () => {
  const json = toStrictJsonSchema(extractionSchemaFor("internal")) as {
    properties: { skills: { items: { properties: { rating: unknown } } } };
  };
  assert.deepEqual(json.properties.skills.items.properties.rating, { type: "string" });
});

test("toStrictJsonSchema: analysis schema is strict-compatible", () => {
  check(toStrictJsonSchema(resumeAnalysisSchema), "analysis");
});
