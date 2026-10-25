/**
 * Purpose: turns the parsed tabs into the snapshot that is applied to the registry: one canonical name per matching
 * identity (see lib/compliance/normalize.ts), with the name types it was seen as and every place it was seen.
 * The same name in several columns or rows (a Friendly Name equal to the Client Name, say) is ONE name with several types and occurrences. Names are merged only when
 * their normalised tokens are identical; look-alikes ("Acme Ltd" / "Acme Limited") are reported for a human, never merged.
 * Also decides whether the snapshot is `complete`, which is the only condition under which "missing from the sheet"
 * may be concluded later. Pure.
 */
import { normalizeName } from "../compliance/normalize";
import type { NameType } from "../compliance/match";
import type { ColumnKey, SectionName, TabResult } from "./parseTab";

export type SnapshotOccurrence = {
  tab: string;
  section: SectionName;
  column: ColumnKey;
  /** 1-based row of the first time the name appears in that tab/column. */
  row: number;
  /** The text exactly as written in the sheet. */
  value: string;
};

export type SnapshotName = {
  normalized: string;
  /** First spelling seen, kept for display. */
  display: string;
  types: NameType[];
  occurrences: SnapshotOccurrence[];
};

export type AnomalyType = "unusable_value" | "short_name" | "possible_variant" | "duplicate_in_tab" | "missing_optional_column";
export type Anomaly = { type: AnomalyType; tab?: string; count: number };

export type TabReport = { tab: string; status: string; entries: number };

export type Snapshot = {
  names: SnapshotName[];
  /** True only when every selected tab was read and parsed (ok or a genuinely empty section). */
  complete: boolean;
  tabs: TabReport[];
  anomalies: Anomaly[];
};

const TYPE_OF: Record<ColumnKey, NameType> = {
  client_name: "client",
  legal_name: "legal",
  friendly_name: "friendly",
  client_group: "group",
};

const LEGAL_SUFFIXES = new Set(["ltd", "limited", "inc", "incorporated", "llc", "llp", "pvt", "private", "corp", "corporation", "co", "company", "plc", "gmbh", "sa", "ag"]);

/** Identity with trailing legal suffixes removed. Used ONLY to flag look-alikes for review, never to merge or match. */
const looseKey = (normalized: string): string => {
  const parts = normalized.split(" ");
  while (parts.length > 1 && LEGAL_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
};

export type TabInput = { tab: string; result: TabResult } | { tab: string; failed: true };

export function buildSnapshot(tabs: readonly TabInput[]): Snapshot {
  const byName = new Map<string, SnapshotName>();
  const reports: TabReport[] = [];
  const counts: Record<string, number> = {};
  const bump = (type: AnomalyType, tab?: string) => {
    const key = `${type}|${tab ?? ""}`;
    counts[key] = (counts[key] ?? 0) + 1;
  };
  // reading no tab at all is never a complete snapshot, otherwise every name would look as if it had left the sheet
  let complete = tabs.length > 0;

  for (const input of tabs) {
    if ("failed" in input) {
      complete = false;
      reports.push({ tab: input.tab, status: "failed", entries: 0 });
      continue;
    }
    const { tab, result } = input;
    reports.push({ tab, status: result.status, entries: result.entries.length });
    for (let i = 0; i < result.missingOptional.length; i++) bump("missing_optional_column", tab);
    if (result.status === "unparseable" || result.status === "ambiguous") complete = false;
    const seen = new Set<string>();
    for (const e of result.entries) {
      const normalized = normalizeName(e.value);
      if (!normalized) {
        bump("unusable_value", tab);
        continue;
      }
      const dedupe = `${normalized}|${e.section}|${e.column}`;
      if (seen.has(dedupe)) {
        bump("duplicate_in_tab", tab);
        continue;
      }
      seen.add(dedupe);
      let name = byName.get(normalized);
      if (!name) {
        name = { normalized, display: e.value, types: [], occurrences: [] };
        byName.set(normalized, name);
      }
      const type = TYPE_OF[e.column];
      if (!name.types.includes(type)) name.types.push(type);
      name.occurrences.push({ tab, section: e.section, column: e.column, row: e.row, value: e.value });
    }
  }

  const names = [...byName.values()].sort((a, b) => a.normalized.localeCompare(b.normalized));
  const loose = new Map<string, number>();
  for (const n of names) {
    if (n.normalized.replace(/ /g, "").length < 3) bump("short_name");
    const k = looseKey(n.normalized);
    loose.set(k, (loose.get(k) ?? 0) + 1);
  }
  for (const c of loose.values()) if (c > 1) bump("possible_variant");

  const anomalies: Anomaly[] = Object.entries(counts).map(([key, count]) => {
    const [type, tab] = key.split("|");
    return { type: type as AnomalyType, ...(tab ? { tab } : {}), count };
  });
  return { names, complete, tabs: reports, anomalies };
}
