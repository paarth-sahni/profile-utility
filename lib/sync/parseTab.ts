/**
 * Purpose: reads the client list out of one tab of the "InfoBeans Client List" sheet, using VALUES only (never colours,
 * merged cells or fixed row numbers). It is given columns A:E only; nothing else in the sheet is ever fetched.
 *
 * Layout: one header row, then one client per row:  S.No | Client Name | Legal Name | Friendly Name | Client Group.
 * Headers are found by their text (case, spacing and punctuation ignored), so the header does not have to be on row 1 and
 * the columns may be reordered. `S.No` is only a row counter and is never read. `Client Name` and `Legal Name` are REQUIRED;
 * a missing `Friendly Name` or `Client Group` header is reported (the column is simply not imported), never silent.
 *   ok          header found once and at least one name below it
 *   empty       header found once, no names below it
 *   unparseable no row has both required headers
 *   ambiguous   more than one row has them, or a header appears twice in the header row
 * Unparseable and ambiguous are never treated as empty. Pure, tested on synthetic tabs only (lib/sheetParser.test.ts).
 */
import { normalizeHeader } from "../compliance/normalize";

/** The whole list is one section; the database also allows the old section names for future use. */
export type SectionName = "list";
export type ColumnKey = "client_name" | "legal_name" | "friendly_name" | "client_group";
export type TabStatus = "ok" | "empty_section" | "unparseable" | "ambiguous";

export type SourceEntry = {
  section: SectionName;
  column: ColumnKey;
  /** 1-based row number in the tab. */
  row: number;
  value: string;
};

export type TabResult = {
  status: TabStatus;
  /** 1-based header row, when found exactly once. */
  headerRow?: number;
  /** Columns that were found and imported. */
  columns: ColumnKey[];
  /** Optional columns whose header was not found (reported as an anomaly, not an error). */
  missingOptional: ColumnKey[];
  /** Rows below the header with no usable value in any imported column. */
  blankRows: number;
  entries: SourceEntry[];
};

/** Header text (normalised) -> column. S.No is deliberately absent: it is never imported. */
const HEADERS: [string, ColumnKey][] = [
  ["clientname", "client_name"],
  ["legalname", "legal_name"],
  ["friendlyname", "friendly_name"],
  ["clientgroup", "client_group"],
];
const REQUIRED: ColumnKey[] = ["client_name", "legal_name"];
const OPTIONAL: ColumnKey[] = ["friendly_name", "client_group"];

/** Columns read from the sheet: A:E. */
export const LAST_COLUMN_INDEX = 4;

const cellText = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
};

type HeaderHit = { row: number; columns: { index: number; key: ColumnKey }[]; duplicated: boolean };

function findHeaders(rows: readonly (readonly unknown[])[]): HeaderHit[] {
  const hits: HeaderHit[] = [];
  rows.forEach((row, r) => {
    const columns: HeaderHit["columns"] = [];
    let duplicated = false;
    for (let index = 0; index <= LAST_COLUMN_INDEX; index++) {
      const norm = normalizeHeader(row?.[index]);
      const found = HEADERS.find(([h]) => h === norm);
      if (!found) continue;
      if (columns.some((c) => c.key === found[1])) duplicated = true;
      else columns.push({ index, key: found[1] });
    }
    if (REQUIRED.every((k) => columns.some((c) => c.key === k))) hits.push({ row: r, columns, duplicated });
  });
  return hits;
}

/** @param rows values of columns A:E of the tab, one array per row (rows may be shorter or empty). */
export function parseTab(rows: readonly (readonly unknown[])[]): TabResult {
  const hits = findHeaders(rows);
  if (hits.length === 0) return { status: "unparseable", columns: [], missingOptional: [], blankRows: 0, entries: [] };
  if (hits.length > 1 || hits[0].duplicated) {
    return { status: "ambiguous", columns: [], missingOptional: [], blankRows: 0, entries: [] };
  }

  const hit = hits[0];
  const entries: SourceEntry[] = [];
  let blank = 0;
  for (let r = hit.row + 1; r < rows.length; r++) {
    let any = false;
    for (const col of hit.columns) {
      const value = cellText(rows[r]?.[col.index]);
      if (!value) continue;
      any = true;
      entries.push({ section: "list", column: col.key, row: r + 1, value });
    }
    if (!any) blank++;
  }
  return {
    status: entries.length > 0 ? "ok" : "empty_section",
    headerRow: hit.row + 1,
    columns: hit.columns.map((c) => c.key),
    missingOptional: OPTIONAL.filter((k) => !hit.columns.some((c) => c.key === k)),
    blankRows: blank,
    entries,
  };
}
