/**
 * Purpose: unit tests for backstop 3l (lib/backstops.ts reconcileAchievements): the model's achievements list is compared with
 * the section the code cut out of the resume, so a dropped item is noticed and added back, an invented one is flagged, and the
 * order follows the resume. Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ACHIEVEMENTS, applyBackstops, reconcileAchievements } from "./backstops";
import type { ReviewFlag } from "./extract.types";
import { normalizeToShape } from "./normalize";

const ach = (list: string[], extra: Record<string, unknown> = {}) => ({ achievements: list, experience: [], ...extra }) as Record<string, unknown>;
const SRC = [
  "Jane Doe", "EXPERIENCE", "Acme", "- Built the claims platform", "ACHIEVEMENTS",
  "- Won the Employee of the Year award 2021", "- Led a migration that saved 30% cost", "- Speaker at DevCon 2020", "EDUCATION", "B.E.",
].join("\n");
const reasons = (flags: ReviewFlag[], path: string) => flags.filter((f) => f.path === path).map((f) => f.reason);
const itemFlags = (flags: ReviewFlag[]) => flags.filter((f) => /^achievements\.\d+$/.test(f.path));

test("every item is kept, in the resume's order, with a note of what was found", () => {
  const d = ach(["Speaker at DevCon 2020", "Won the Employee of the Year award 2021", "Led a migration that saved 30% cost"]);
  const flags = reconcileAchievements("external", d, [], SRC);
  assert.deepEqual(d.achievements, ["Won the Employee of the Year award 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"]);
  assert.deepEqual(reasons(flags, "achievements"), ['Found the "ACHIEVEMENTS" section: 3 items listed under Achievements']);
  assert.deepEqual(itemFlags(flags), []);
});

test("a bulleted item the model dropped is ADDED BACK and flagged", () => {
  const d = ach(["Won the Employee of the Year award 2021", "Speaker at DevCon 2020"]);
  const flags = reconcileAchievements("external", d, [], SRC);
  assert.deepEqual(d.achievements, ["Won the Employee of the Year award 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"]);
  assert.deepEqual(reasons(flags, "achievements.1"), ["added from your resume's \"ACHIEVEMENTS\" section, please check"]);
});

test("a model that returned nothing still gets the whole section", () => {
  const d = ach([]);
  reconcileAchievements("external", d, [], SRC);
  assert.equal((d.achievements as string[]).length, 3);
});

test("a dropped item of a PLAIN list is not added (line breaks are a guess) but reported", () => {
  const plain = ["AWARDS", "Employee of the Year 2021", "Best Team Lead, Q3 2020", "Innovation Award for the claims platform", "SKILLS", "Java"].join("\n");
  const d = ach(["Employee of the Year 2021", "Innovation Award for the claims platform"]);
  const flags = reconcileAchievements("external", d, [], plain);
  assert.deepEqual(d.achievements, ["Employee of the Year 2021", "Innovation Award for the claims platform"]);
  assert.ok(reasons(flags, "achievements").some((r) => /1 item of the "AWARDS" section may be missing/.test(r)));
});

test("an invented item stays, flagged as not in the resume", () => {
  const d = ach(["Won the Employee of the Year award 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020", "Received the national innovation prize"]);
  const flags = reconcileAchievements("external", d, [], SRC);
  assert.equal((d.achievements as string[]).length, 4);
  assert.deepEqual(reasons(flags, "achievements.3"), ["not found in the resume, please check"]);
});

test("an item the model reworded is paired with the resume's item, not duplicated", () => {
  const d = ach(["Awarded Employee of the Year in 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"]);
  const flags = reconcileAchievements("external", d, [], SRC);
  assert.deepEqual(d.achievements, ["Awarded Employee of the Year in 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"]);
  assert.deepEqual(itemFlags(flags), []);
});

test("no such section in the resume and none returned: nothing added, nothing flagged", () => {
  const d = ach([]);
  const flags = reconcileAchievements("external", d, [], "Jane Doe\nEXPERIENCE\nAcme\n- Built things\nEDUCATION\nB.E.");
  assert.deepEqual(d.achievements, []);
  assert.deepEqual(flags, []);
});

test("the model found a section the detector missed: kept, and flagged only when not in the resume", () => {
  const src = "Jane Doe\nPersonal wins\nWon the Employee of the Year award 2021\nEDUCATION\nB.E.";
  const d = ach(["Won the Employee of the Year award 2021", "Made-up prize"]);
  const flags = reconcileAchievements("external", d, [], src);
  assert.equal((d.achievements as string[]).length, 2);
  assert.deepEqual(reasons(flags, "achievements.0"), []);
  assert.deepEqual(reasons(flags, "achievements.1"), ["not found in the resume, please check"]);
});

test("blank and N/A items and repeats are dropped; the internal template is untouched", () => {
  const d = ach(["Speaker at DevCon 2020", "", "N/A", "speaker at devcon 2020"]);
  reconcileAchievements("external", d, [], "Jane Doe");
  assert.deepEqual(d.achievements, ["Speaker at DevCon 2020"]);
  const internal = { name: "x" } as Record<string, unknown>;
  assert.deepEqual(reconcileAchievements("internal", internal, [], SRC), []);
  assert.deepEqual(internal, { name: "x" });
});

test("a Highlights-style section is flagged as possibly not achievements", () => {
  const src = ["KEY HIGHLIGHTS", "- Ten years in insurance technology", "- Led teams of up to 40", "EXPERIENCE", "Acme"].join("\n");
  const d = ach(["Ten years in insurance technology", "Led teams of up to 40"]);
  const flags = reconcileAchievements("external", d, [], src);
  assert.ok(reasons(flags, "achievements").some((r) => /headed "KEY HIGHLIGHTS": remove the items if they only summarise/.test(r)));
});

test("an achievement that is also an Experience bullet is flagged there, not deleted", () => {
  const d = ach(["Won the Employee of the Year award 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"], {
    experience: [{ company: "Acme", highlights: ["Built it", "Won the Employee of the Year award 2021"] }],
  });
  const flags = reconcileAchievements("external", d, [], SRC);
  assert.deepEqual(reasons(flags, "experience.0.highlights.1"), ["also listed under Achievements"]);
  assert.equal((d.experience as { highlights: string[] }[])[0].highlights.length, 2);
});

test("more than the cap is reported", () => {
  const items = Array.from({ length: MAX_ACHIEVEMENTS + 2 }, (_, i) => `Award number ${i + 1} for work in year ${2000 + i}`);
  const d = ach(items);
  const flags = reconcileAchievements("external", d, [], ["AWARDS", ...items.map((i) => `- ${i}`)].join("\n"));
  assert.ok(reasons(flags, "achievements").some((r) => new RegExp(`More than ${MAX_ACHIEVEMENTS} items`).test(r)));
});

test("it runs inside applyBackstops for the external template", () => {
  const data = { ...normalizeToShape("external", { name: "A" }), achievements: ["Speaker at DevCon 2020"] };
  const r = applyBackstops("external", data, [], SRC);
  assert.equal((r.data as { achievements: string[] }).achievements.length, 3);
});
