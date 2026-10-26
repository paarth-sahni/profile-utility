import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { AreaField, Field, MarkedText, StringListEditor, TagInput } from "../components/fields";
import { COMPLIANCE_MESSAGE } from "./compliance/check";
import { checkComplianceRemote, describeMatch, messagesByPath, rangesByPath } from "./complianceClient";
import { blankResume } from "./schemas";

// Fictional names only.
const matches = [
  { path: "overview", start: 15, end: 33, matchedText: "Example Client One" },
  { path: "overview", start: 40, end: 52, matchedText: "Example Group" },
  { path: "projects.0.responsibilities.1", start: 4, end: 14, matchedText: "Project Aurora" },
];

test("messagesByPath: one message per field, whatever the number of matches", () => {
  assert.deepEqual(messagesByPath(matches), { overview: COMPLIANCE_MESSAGE, "projects.0.responsibilities.1": COMPLIANCE_MESSAGE });
});

test("rangesByPath: every match of a field, in order, with its offsets only", () => {
  assert.deepEqual(rangesByPath(matches), {
    overview: [{ start: 15, end: 33 }, { start: 40, end: 52 }],
    "projects.0.responsibilities.1": [{ start: 4, end: 14 }],
  });
});

test("describeMatch names the text the user typed and tells them what to do", () => {
  const d = describeMatch(matches[0], "Profile → Overview");
  assert.equal(d.path, "Profile → Overview");
  assert.match(d.message, /“Example Client One”/);
  assert.match(d.message, /Remove or rephrase/);
});

test("checkComplianceRemote maps answers: ok, unavailable, ended session, failures", async () => {
  const realFetch = globalThis.fetch;
  const answer = (status: number, body: unknown) => (globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);
  try {
    const data = blankResume("internal");
    answer(200, { enforced: true, violations: [{ path: "overview", start: 1, end: 5, matchedText: "Acme", types: ["client"] }] });
    const ok = await checkComplianceRemote("internal", data);
    assert.deepEqual(ok, { status: "ok", enforced: true, matches: [{ path: "overview", start: 1, end: 5, matchedText: "Acme", types: ["client"] }] });
    answer(200, { enforced: false, violations: [] });
    assert.deepEqual(await checkComplianceRemote("internal", data), { status: "ok", enforced: false, matches: [] });
    answer(503, { error: { code: "REGISTRY_UNAVAILABLE" } });
    assert.deepEqual(await checkComplianceRemote("internal", data), { status: "unavailable" });
    answer(401, {});
    assert.deepEqual(await checkComplianceRemote("internal", data), { status: "unauthenticated" });
    answer(500, {});
    assert.deepEqual(await checkComplianceRemote("internal", data), { status: "failed" });
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.deepEqual(await checkComplianceRemote("internal", data), { status: "failed" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

test("MarkedText marks exactly the flagged part and shows the rest as it is", () => {
  const text = "Delivered for Example Client One today";
  const out = html(createElement(MarkedText, { text, ranges: [{ start: 14, end: 32 }] }));
  assert.match(out, /<mark[^>]*>Example Client One<\/mark>/);
  assert.ok(out.includes("Delivered for "));
  assert.ok(out.includes(" today"));
  assert.ok(out.includes("Found in this text"));
});

test("MarkedText ignores a range that no longer fits the text and cuts long text down to the context", () => {
  assert.ok(!html(createElement(MarkedText, { text: "short", ranges: [{ start: 10, end: 20 }] })).includes("<mark"));
  const long = `${"a ".repeat(200)}Example Client One${" b".repeat(200)}`;
  const start = long.indexOf("Example");
  const out = html(createElement(MarkedText, { text: long, ranges: [{ start, end: start + 18 }] }));
  assert.ok(out.length < long.length, "long text is shortened");
  assert.match(out, /<mark[^>]*>Example Client One<\/mark>/);
});

test("Field and AreaField show the message and the marked text; nothing extra without highlights", () => {
  const field = html(createElement(Field, { label: "Job title", value: "Lead for Example Group", onChange: () => {}, error: COMPLIANCE_MESSAGE, highlights: [{ start: 9, end: 22 }] }));
  assert.ok(field.includes(COMPLIANCE_MESSAGE));
  assert.match(field, /<mark[^>]*>Example Group<\/mark>/);
  assert.ok(field.includes('data-invalid="true"'));
  const plain = html(createElement(Field, { label: "Job title", value: "Lead", onChange: () => {} }));
  assert.ok(!plain.includes("<mark") && !plain.includes("data-invalid"));
  const area = html(createElement(AreaField, { label: "Overview", value: "For Example Group", onChange: () => {}, error: COMPLIANCE_MESSAGE, highlights: [{ start: 4, end: 17 }] }));
  assert.match(area, /<mark[^>]*>Example Group<\/mark>/);
});

test("StringListEditor marks only the flagged bullet; TagInput turns only the flagged chip red", () => {
  const list = html(
    createElement(StringListEditor, {
      items: ["Fine bullet", "Worked with Example Group"],
      onChange: () => {},
      marks: (i: number) => (i === 1 ? { error: COMPLIANCE_MESSAGE, highlights: [{ start: 12, end: 25 }] } : {}),
    }),
  );
  assert.equal((list.match(/data-invalid="true"/g) ?? []).length, 1);
  assert.match(list, /<mark[^>]*>Example Group<\/mark>/);

  const tags = html(createElement(TagInput, { items: ["Java", "", "Example Group"], onChange: () => {}, itemError: (i: number) => (i === 2 ? COMPLIANCE_MESSAGE : undefined) }));
  assert.ok(tags.includes("“Example Group”"), "the flagged chip is named in the message");
  assert.ok(tags.includes('data-invalid="true"'));
  const clean = html(createElement(TagInput, { items: ["Java"], onChange: () => {} }));
  assert.ok(!clean.includes("data-invalid") && !clean.includes("Registered client"));
});
