/**
 * Purpose: decides which tabs of the sheet are read. By default EVERY tab is read (the client list is one tab, "Sheet1").
 * An optional list of tab names (SYNC_TAB_NAMES) restricts it, for a file that also holds notes tabs. A tab named in that list
 * but absent from the sheet is reported as missing (so the snapshot is incomplete), never silently skipped. Pure.
 */

export type TabSelection = {
  /** Tabs to read, in sheet order. */
  selected: string[];
  /** Tabs present in the sheet but left out by the restriction. */
  ignored: string[];
  /** Tabs named in the restriction that are not in the sheet. */
  missing: string[];
};

const key = (name: string): string => name.trim().toLowerCase();

/** "Sheet1, Clients" -> ["Sheet1", "Clients"]; empty or unset -> null (read every tab). */
export function parseTabNames(setting: string | undefined | null): string[] | null {
  const names = (setting ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? names : null;
}

export function selectTabs(titles: readonly string[], restrictTo: readonly string[] | null | undefined): TabSelection {
  if (!restrictTo || restrictTo.length === 0) return { selected: [...titles], ignored: [], missing: [] };
  const wanted = new Set(restrictTo.map(key));
  const selected = titles.filter((t) => wanted.has(key(t)));
  const ignored = titles.filter((t) => !wanted.has(key(t)));
  const present = new Set(titles.map(key));
  const missing = restrictTo.filter((n) => !present.has(key(n)));
  return { selected, ignored, missing };
}
