import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeToShape } from "./normalize";
import { RATING_MESSAGE } from "./rating";
import { internalSkillSchema, type InternalResume } from "./schemas";

const rate = (rating: string) => internalSkillSchema.safeParse({ name: "Java", rating });

test("the schema accepts 0.1 to 5 with one decimal and says why it refuses anything else", () => {
  for (const ok of ["4", "4.8", "5", "0.5"]) assert.equal(rate(ok).success, true, ok);
  for (const bad of ["0", "5.5", "6", "4.55", "abc", "4."]) {
    const r = rate(bad);
    assert.equal(r.success, false, bad);
    if (!r.success) assert.equal(r.error.issues[0].message, RATING_MESSAGE, bad);
  }
});

test("an empty rating is one problem ('required'), not two", () => {
  const r = rate("");
  assert.equal(r.success, false);
  if (!r.success) assert.deepEqual(r.error.issues.map((i) => i.message), ["rating is required"]);
});

test("ratings from the resume reader are rounded to one decimal or blanked", () => {
  const out = normalizeToShape("internal", {
    skills: [{ name: "A", rating: 4.75 }, { name: "B", rating: "8/10" }, { name: "C", rating: "5" }, { name: "D", rating: 6 }],
  }) as InternalResume;
  assert.deepEqual(out.skills.map((s) => s.rating), ["4.8", "", "5", ""]);
});
