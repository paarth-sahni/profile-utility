/**
 * Purpose: unit tests for completeJson's strict-mode handling against a local fake of Groq's chat API:
 * a refused schema falls back to json_object once per upload, a 400 about the generated output does not,
 * and logged provider errors carry only type, code and message. Run with `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

type Reply = { status: number; body: unknown };
const requests: { response_format: { type: string } }[] = [];
let replies: Reply[] = [];

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    requests.push(JSON.parse(raw));
    const reply = replies.shift() ?? { status: 500, body: { error: { message: "no reply queued" } } };
    res.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.body));
  });
});

const ok = (content: string): Reply => ({
  status: 200,
  body: { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] },
});
// The bodies Groq actually returned (2026-10-16) for a refused schema and for output that failed validation.
const schemaRefused: Reply = {
  status: 400,
  body: { error: { type: "invalid_request_error", message: "invalid JSON schema for response_format: 'profile': `additionalProperties:false` must be set on every object" } },
};
const generationFailed: Reply = {
  status: 400,
  body: {
    error: {
      type: "invalid_request_error",
      code: "json_validate_failed",
      message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
      failed_generation: '{"name":"SECRET RESUME TEXT"',
    },
  },
};

const schema = z.object({ name: z.string() });
const base = { model: "m", system: "s", user: "u", schema, schemaName: "profile" };

/** Runs fn with console.warn/error captured; returns what was logged. */
async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const { warn, error } = console;
  console.warn = console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await fn().catch(() => undefined);
  } finally {
    Object.assign(console, { warn, error });
  }
  return lines.join("\n");
}

test.before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(() => server.close());
test.beforeEach(() => {
  requests.length = 0;
  replies = [];
});

test("a refused schema falls back to json_object, and is not sent strict again in the same upload", async () => {
  const { completeJson } = await import("./llm");
  const strictRejected = new Set<string>();
  replies = [schemaRefused, ok('{"name":"A"}'), ok('{"name":"B"}')];
  let first = "";
  const logs = await captureLogs(async () => (first = await completeJson({ ...base, strictRejected })));
  assert.equal(first, '{"name":"A"}');
  assert.match(logs, /type=invalid_request_error .*invalid JSON schema for response_format/);
  assert.deepEqual([...strictRejected], ["profile"]);

  assert.equal(await completeJson({ ...base, strictRejected }), '{"name":"B"}');
  assert.deepEqual(
    requests.map((r) => r.response_format.type),
    ["json_schema", "json_object", "json_object"],
  );
});

test("a 400 about the generated output (json_validate_failed) is not treated as a refused schema", async () => {
  const { completeJson } = await import("./llm");
  const { ExtractError } = await import("./extract.types");
  const strictRejected = new Set<string>();
  replies = [generationFailed];
  let thrown: unknown;
  const logs = await captureLogs(() => completeJson({ ...base, strictRejected }).catch((e) => (thrown = e)));
  assert.ok(thrown instanceof ExtractError && thrown.code === "LLM_FAILED");
  assert.equal(requests.length, 1, "no json_object fallback request");
  assert.equal(strictRejected.size, 0);
  assert.match(logs, /status 400 type=invalid_request_error code=json_validate_failed message="Failed to validate JSON/);
  assert.doesNotMatch(logs, /SECRET RESUME TEXT|test-key/, "never logs the generation or the key");
});
