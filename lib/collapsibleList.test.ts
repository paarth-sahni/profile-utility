/** Purpose: unit tests for lib/collapsibleList.ts (which Edit-page project / employer cards are open). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitOpen, initialOpen, insertTopOpen, itemTitle, moveOpen, openNewProblems, removeOpen } from "./collapsibleList";

test("after upload: Project 1 and every item with a problem open, the rest collapsed", () => {
  assert.deepEqual(initialOpen(4, (i) => i === 2), [true, false, true, false]);
  assert.deepEqual(initialOpen(0, () => true), []);
});

test("the flags follow their items: move, remove, add at the top, a list replaced", () => {
  assert.deepEqual(moveOpen([true, false, false], 0, 2), [false, false, true]);
  assert.deepEqual(moveOpen([false, true], 1, 0), [true, false]);
  assert.deepEqual(removeOpen([true, false, true], 1), [true, true]);
  assert.deepEqual(insertTopOpen([true, false]), [true, true, false], "the new Project 1 is open; the others keep theirs");
  assert.deepEqual(fitOpen([true], 3), [true, false, false]);
  assert.deepEqual(fitOpen([true, true, false], 1), [true]);
  assert.deepEqual(fitOpen([], 1), [true], "an emptied list restored: its first item open");
});

test("an item that gets a problem opens; nothing closes because of a problem", () => {
  assert.deepEqual(openNewProblems([false, false, true], [false, true, false], [true, true, false]), [true, false, true]);
});

test("card titles: Project N – name – dates, empty parts left out", () => {
  assert.equal(itemTitle("Project", 0, "Payments Platform", "Jan 2023 – Dec 2023"), "Project 1 – Payments Platform – Jan 2023 – Dec 2023");
  assert.equal(itemTitle("Project", 1, " ", ""), "Project 2");
  assert.equal(itemTitle("Employer", 2, "Example Corp", undefined), "Employer 3 – Example Corp");
});
