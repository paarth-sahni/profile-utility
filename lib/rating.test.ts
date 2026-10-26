import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptRatingInput, isValidRating, normalizeRating } from "./rating";

test("isValidRating: above 0, at most 5, one decimal", () => {
  for (const ok of ["1", "4", "4.5", "4.8", "5", "5.0", "0.5", " 3.2 "]) assert.equal(isValidRating(ok), true, ok);
  for (const bad of ["", "0", "0.0", "5.1", "5.5", "6", "10", "4.55", "4.", ".5", "abc", "4,5", "-1", "1e1"]) assert.equal(isValidRating(bad), false, JSON.stringify(bad));
});

test("acceptRatingInput lets a rating be typed and blocks anything above 5", () => {
  // typing 4.8 key by key
  let v = "";
  for (const next of ["4", "4.", "4.8"]) {
    v = acceptRatingInput(v, next);
    assert.equal(v, next);
  }
  // a digit above 5 is ignored
  assert.equal(acceptRatingInput("", "6"), "");
  assert.equal(acceptRatingInput("", "9"), "");
  // 5 is fine, but nothing above 5.0
  assert.equal(acceptRatingInput("", "5"), "5");
  assert.equal(acceptRatingInput("5", "5."), "5.");
  assert.equal(acceptRatingInput("5.", "5.0"), "5.0");
  assert.equal(acceptRatingInput("5.", "5.1"), "5.");
  assert.equal(acceptRatingInput("5", "55"), "5");
  // one decimal only
  assert.equal(acceptRatingInput("4.5", "4.55"), "4.5");
  // letters and symbols are ignored, deleting works
  assert.equal(acceptRatingInput("4", "4a"), "4");
  assert.equal(acceptRatingInput("4", "-"), "4");
  assert.equal(acceptRatingInput("4.5", "4."), "4.");
  assert.equal(acceptRatingInput("4", ""), "");
  // pasting a whole value
  assert.equal(acceptRatingInput("", "3.5"), "3.5");
  assert.equal(acceptRatingInput("2", "8.5"), "2");
});

test("normalizeRating rounds in-range values and blanks the rest", () => {
  assert.equal(normalizeRating(4.75), "4.8");
  assert.equal(normalizeRating("4.5"), "4.5");
  assert.equal(normalizeRating(5), "5");
  assert.equal(normalizeRating("4,5"), "4.5");
  for (const bad of [0, "0", 5.5, 8, "8/10", "", null, undefined, "abc", -2]) assert.equal(normalizeRating(bad), "", String(bad));
});
