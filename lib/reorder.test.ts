import assert from "node:assert/strict";
import { test } from "node:test";
import { dropIndex, dropMarker, keyboardTarget } from "./reorder";

// four items, each 100 tall with a 10 gap: middles at 50, 160, 270, 380
const MIDS = [50, 160, 270, 380];

test("dropIndex: an item stays put until the pointer crosses a neighbour's middle", () => {
  assert.equal(dropIndex(MIDS, 1, 160), 1, "pointer on its own middle");
  assert.equal(dropIndex(MIDS, 1, 100), 1, "above its middle, below the first one's");
  assert.equal(dropIndex(MIDS, 1, 200), 1, "below its middle, above the third one's");
});

test("dropIndex: crossing a middle moves the item one place, crossing three moves it to the end, and above the first to the start", () => {
  assert.equal(dropIndex(MIDS, 0, 271), 2, "the first item dragged past the middle of the third");
  assert.equal(dropIndex(MIDS, 0, 9999), 3, "dragged below everything");
  assert.equal(dropIndex(MIDS, 3, -50), 0, "the last item dragged above everything");
  assert.equal(dropIndex(MIDS, 3, 159), 1, "the last item dragged up to between the first two");
  assert.equal(dropIndex(MIDS, 2, 49), 0);
});

test("dropIndex: a list of one or two items", () => {
  assert.equal(dropIndex([50], 0, 500), 0);
  assert.equal(dropIndex([50, 160], 0, 200), 1);
  assert.equal(dropIndex([50, 160], 1, 10), 0);
});

test("dropMarker: the line goes above the neighbour when moving up, below it when moving down, nowhere when not moving", () => {
  assert.deepEqual(dropMarker(3, 1), { index: 1, side: "before" });
  assert.deepEqual(dropMarker(0, 2), { index: 2, side: "after" });
  assert.equal(dropMarker(2, 2), null);
});

test("dropMarker and dropIndex together give the same list order as moving the item to that index", () => {
  const items = ["a", "b", "c", "d"];
  for (const from of [0, 1, 2, 3]) {
    for (const y of [0, 100, 200, 300, 500]) {
      const to = dropIndex(MIDS, from, y);
      const moved = [...items];
      moved.splice(to, 0, ...moved.splice(from, 1));
      const marker = dropMarker(from, to);
      if (!marker) {
        assert.deepEqual(moved, items);
        continue;
      }
      // the marker names the neighbour the item ends up next to, on the side it ends up on
      const at = moved.indexOf(items[from]);
      const neighbour = marker.side === "before" ? moved[at + 1] : moved[at - 1];
      assert.equal(neighbour, items[marker.index], `from ${from} to ${to}`);
    }
  }
});

test("keyboardTarget: the arrow keys move one place, Home and End to the ends, and nothing moves past an end", () => {
  assert.equal(keyboardTarget(2, 5, "ArrowUp"), 1);
  assert.equal(keyboardTarget(2, 5, "ArrowDown"), 3);
  assert.equal(keyboardTarget(2, 5, "Home"), 0);
  assert.equal(keyboardTarget(2, 5, "End"), 4);
  assert.equal(keyboardTarget(0, 5, "ArrowUp"), null);
  assert.equal(keyboardTarget(4, 5, "ArrowDown"), null);
  assert.equal(keyboardTarget(0, 5, "Home"), null);
  assert.equal(keyboardTarget(4, 5, "End"), null);
  assert.equal(keyboardTarget(1, 5, "Enter"), null, "other keys do nothing");
  assert.equal(keyboardTarget(0, 1, "ArrowDown"), null, "a single item cannot move");
});
