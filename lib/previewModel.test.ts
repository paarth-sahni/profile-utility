/** Purpose: unit tests for the preview helpers (what counts as empty, and rating format). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanList, formatRating, hasContent, hasText } from "./previewModel";

test("hasText: blank and N/A-style placeholders are not content", () => {
  assert.equal(hasText("Java"), true);
  for (const v of ["", "   ", "N/A", "n/a", "NA", " na ", null, undefined]) assert.equal(hasText(v), false, String(v));
  assert.equal(hasText("Navigation"), true, "words that merely start like N/A are content");
});

test("cleanList drops blanks and N/A but keeps order and real text untouched", () => {
  assert.deepEqual(cleanList(["Git", "", "  ", "N/A", "Docker"]), ["Git", "Docker"]);
  assert.deepEqual(cleanList([""]), []);
  assert.deepEqual(cleanList(undefined), []);
  assert.deepEqual(cleanList([" keep spaces "]), [" keep spaces "]);
});

test("formatRating: numbers become x/5, blanks vanish, other text is kept", () => {
  assert.equal(formatRating("4"), "4/5");
  assert.equal(formatRating("4.5"), "4.5/5");
  assert.equal(formatRating(" 3 "), "3/5");
  assert.equal(formatRating(""), "");
  assert.equal(formatRating("N/A"), "");
  assert.equal(formatRating(undefined), "");
  assert.equal(formatRating("4/5"), "4/5", "no double suffix");
  assert.equal(formatRating("Expert"), "Expert");
});

test("hasContent: true if any text field or any list item is real", () => {
  assert.equal(hasContent("", "N/A", []), false);
  assert.equal(hasContent("", [""], ["N/A"]), false);
  assert.equal(hasContent("", "Billing"), true);
  assert.equal(hasContent("", ["", "Java"]), true);
});
