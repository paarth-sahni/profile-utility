/**
 * Purpose: the decisions behind drag-to-reorder (components/reorder.tsx), kept pure so they are unit-tested
 * (lib/reorder.test.ts): where a dragged item lands for the pointer's position, which neighbour shows the drop line and on
 * which side, and where the arrow keys move an item. The list itself is changed by the caller (moveItem in components/fields.tsx).
 */

/**
 * The index the dragged item ends up at. `mids` are the vertical middles of ALL items (the dragged one included) in their
 * original layout, top to bottom; `from` is the dragged item's index; `pointerY` is the pointer in the same coordinates. The item
 * lands after every other item whose middle is above the pointer.
 */
export function dropIndex(mids: readonly number[], from: number, pointerY: number): number {
  let to = 0;
  mids.forEach((mid, i) => {
    if (i !== from && mid < pointerY) to++;
  });
  return to;
}

/** The line that shows where the item will land: on the neighbour now at `to`, above it when moving up, below it when moving down. */
export function dropMarker(from: number, to: number): { index: number; side: "before" | "after" } | null {
  return to === from ? null : { index: to, side: to < from ? "before" : "after" };
}

/** Where the arrow keys move the item at `index` in a list of `length` (null when the key does nothing or it cannot move). */
export function keyboardTarget(index: number, length: number, key: string): number | null {
  const to = key === "ArrowUp" ? index - 1 : key === "ArrowDown" ? index + 1 : key === "Home" ? 0 : key === "End" ? length - 1 : index;
  return to === index || to < 0 || to >= length ? null : to;
}
