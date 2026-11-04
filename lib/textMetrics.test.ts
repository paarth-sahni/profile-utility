import assert from "node:assert/strict";
import { test } from "node:test";
import { splitDescription, textWidthPt, wrapLines } from "./textMetrics";

// A fictional description whose line breaks were measured on the PDF LibreOffice made (internal column, 344.1pt, 11pt).
const SAMPLE =
  "Forecasting platform that tells store managers which products to reorder each week, built on daily sales and stock feeds from 120 stores, with a review screen for managers and alerts when stock falls below agreed levels.";

test("widths come from Lexend Light (1000 units per em)", () => {
  assert.equal(textWidthPt(" ", 10), 2.8);
  assert.ok(Math.abs(textWidthPt("Forecasting platform", 11) - 109.8) < 0.05);
  assert.ok(textWidthPt("–", 11) > 0 && textWidthPt("漢", 11) > 0, "an unknown character still has a width");
});

test("wrapLines breaks where LibreOffice does (measured on the PDF)", () => {
  const lines = wrapLines(SAMPLE, 344.1, 11).map((l) => SAMPLE.slice(l.start, l.end));
  assert.deepEqual(lines.slice(0, 3), [
    "Forecasting platform that tells store managers which products to",
    "reorder each week, built on daily sales and stock feeds from 120",
    "stores, with a review screen for managers and alerts when stock",
  ]);
  assert.equal(lines.length, 4);
  assert.equal(wrapLines("one\ntwo", 344.1, 11).length, 2, "a hard line break starts a new line");
  assert.equal(wrapLines("Supercalifragilisticexpialidocious", 50, 11).length, 1, "a word wider than the column stays on one line");
});

test("splitDescription: up to 6 lines whole; longer cut after 2 lines and before the last 2, nothing lost", () => {
  assert.deepEqual(splitDescription(SAMPLE, 344.1, 11), { whole: true });
  const long = Array.from({ length: 5 }, () => SAMPLE).join(" ");
  const s = splitDescription(long, 344.1, 11);
  assert.ok(!s.whole);
  if (s.whole) return;
  assert.equal(wrapLines(s.head, 344.1, 11).length, 2);
  assert.equal(wrapLines(s.tail, 344.1, 11).length, 2);
  assert.equal(`${s.head} ${s.body} ${s.tail}`, long, "the three pieces are the description, in order");
  assert.deepEqual(splitDescription(long, 525.6, 11, 30), { whole: true }, "the limit and the column width are parameters");
});
