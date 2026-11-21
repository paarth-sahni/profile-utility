/**
 * Purpose: which cards of an Edit-page item list (projects, employers) are open, kept in step with the list as items are
 * moved, removed or added at the top. Pure (unit-tested in lib/collapsibleList.test.ts); components/useCollapsibleList.ts
 * holds the state.
 */

/** On first show: the first item and every item with a problem open, the rest collapsed. */
export function initialOpen(length: number, needsAttention: (i: number) => boolean): boolean[] {
  return Array.from({ length }, (_, i) => i === 0 || needsAttention(i));
}

/** The open flags after moving the item at `from` to `to` (the flag travels with its item). */
export function moveOpen(open: boolean[], from: number, to: number): boolean[] {
  const next = [...open];
  const [flag] = next.splice(from, 1);
  next.splice(to, 0, flag ?? false);
  return next;
}

/** After removing the item at `index`. */
export const removeOpen = (open: boolean[], index: number): boolean[] => open.filter((_, i) => i !== index);

/** After adding an item at the top: it is open, the others keep theirs. */
export const insertTopOpen = (open: boolean[]): boolean[] => [true, ...open];

/**
 * Lined up with a list whose length changed some other way (e.g. replaced): extra items collapsed, missing ones dropped; a list
 * that was empty (e.g. a removed section restored) starts like a new one, its first item open.
 */
export function fitOpen(open: boolean[], length: number): boolean[] {
  if (open.length === length) return open;
  return Array.from({ length }, (_, i) => open[i] ?? (open.length === 0 && i === 0));
}

/** Items that newly have a problem open (a problem never closes anything). */
export function openNewProblems(open: boolean[], before: boolean[], now: boolean[]): boolean[] {
  return open.map((o, i) => o || (now[i] === true && before[i] !== true));
}

/** The card title: "Project 3 – Payments Platform – Jan 2023 – Dec 2023", leaving out empty parts. */
export function itemTitle(kind: string, index: number, ...parts: (string | undefined)[]): string {
  return [`${kind} ${index + 1}`, ...parts.map((p) => p?.trim()).filter(Boolean)].join(" – ");
}
