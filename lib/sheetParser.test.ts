import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot } from "./sync/buildSnapshot";
import { parseTab } from "./sync/parseTab";
import { parseTabNames, selectTabs } from "./sync/tabs";

// Synthetic tabs only: the layout mirrors the real client list (header row, one client per row, an S.No counter), the
// names are invented.
const E = "";
const HEADER = ["S.No", "Client Name", "Legal Name", "Friendly Name", "Client Group"];
const standard = (): unknown[][] => [
  HEADER,
  [1, "Example Client One", "Example Client One Private Limited", "Example One", "Example Group"],
  [2, "Example Client Two", "Example Client Two Inc", "Example Client Two", "Example Client Two"],
  [3, "Example Client Three", E, E, E],
];

test("parseTab: header on row 1, four columns, S.No never imported, provenance kept", () => {
  const r = parseTab(standard());
  assert.equal(r.status, "ok");
  assert.equal(r.headerRow, 1);
  assert.deepEqual(r.columns, ["client_name", "legal_name", "friendly_name", "client_group"]);
  assert.deepEqual(r.missingOptional, []);
  assert.equal(r.blankRows, 0);
  const first = r.entries.filter((e) => e.row === 2).map((e) => [e.column, e.value]);
  assert.deepEqual(first, [
    ["client_name", "Example Client One"],
    ["legal_name", "Example Client One Private Limited"],
    ["friendly_name", "Example One"],
    ["client_group", "Example Group"],
  ]);
  assert.ok(r.entries.every((e) => e.section === "list"));
  // the counter column (1, 2, 3) is not a name
  assert.ok(!r.entries.some((e) => ["1", "2", "3"].includes(e.value)));
  assert.equal(r.entries.length, 4 + 4 + 1);
});

test("parseTab: header on a later row, spelling variants, reordered columns", () => {
  const rows: unknown[][] = [
    ["InfoBeans Client List"],
    [E, E],
    ["CLIENT  GROUP", "legal_name", "S.NO", "Friendly-Name", " client name "],
    ["Group A", "Alpha Ltd", 1, "Alpha", "Alpha Limited"],
  ];
  const r = parseTab(rows);
  assert.equal(r.status, "ok");
  assert.equal(r.headerRow, 3);
  const byColumn = Object.fromEntries(r.entries.map((e) => [e.column, e.value]));
  assert.deepEqual(byColumn, { client_group: "Group A", legal_name: "Alpha Ltd", friendly_name: "Alpha", client_name: "Alpha Limited" });
  assert.ok(!r.entries.some((e) => e.value === "1"));
});

test("parseTab: a missing optional header is reported, the rest is still imported", () => {
  const r = parseTab([["S.No", "Client Name", "Legal Name"], [1, "Alpha", "Alpha Ltd"]]);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.columns, ["client_name", "legal_name"]);
  assert.deepEqual(r.missingOptional, ["friendly_name", "client_group"]);
  assert.equal(r.entries.length, 2);
});

test("parseTab: a missing required header is unparseable, never empty", () => {
  assert.equal(parseTab([["S.No", "Client Name", "Friendly Name"], [1, "Alpha", "Al"]]).status, "unparseable");
  assert.equal(parseTab([["S.No", "Legal Name"], [1, "Alpha Ltd"]]).status, "unparseable");
  assert.equal(parseTab([["Something", "Else"], ["a", "b"]]).status, "unparseable");
  assert.equal(parseTab([]).status, "unparseable");
  // required headers beyond column E are not looked at
  assert.equal(parseTab([["S.No", "Client Name", E, E, E, "Legal Name"], [1, "Alpha"]]).status, "unparseable");
});

test("parseTab: duplicate header rows or a repeated header are ambiguous and import nothing", () => {
  const twice = parseTab([HEADER, [1, "Alpha", "Alpha Ltd", E, E], HEADER, [2, "Beta", "Beta Ltd", E, E]]);
  assert.equal(twice.status, "ambiguous");
  assert.equal(twice.entries.length, 0);
  const repeated = parseTab([["S.No", "Client Name", "Legal Name", "Client Name"], [1, "Alpha", "Alpha Ltd", "Alpha"]]);
  assert.equal(repeated.status, "ambiguous");
});

test("parseTab: a header with no names is empty, which is not the same as unparseable", () => {
  const r = parseTab([HEADER, [E, E, E, E, E], []]);
  assert.equal(r.status, "empty_section");
  assert.equal(r.headerRow, 1);
  assert.equal(r.blankRows, 2);
});

test("parseTab: blank rows and cells, short rows, non-text cells; numeric names are kept", () => {
  const r = parseTab([
    HEADER,
    [],
    [undefined, null, null],
    [true, false, E],
    [1, 7, E, E, E],
    [2, "Alpha"],
    [3, E, "Alpha Ltd"],
  ]);
  assert.deepEqual(r.entries.map((e) => [e.column, e.value, e.row]), [["client_name", "7", 5], ["client_name", "Alpha", 6], ["legal_name", "Alpha Ltd", 7]]);
  assert.equal(r.blankRows, 3);
});

test("parseTab: a large list is handled and rows stay in order", () => {
  const rows: unknown[][] = [HEADER];
  for (let i = 1; i <= 2000; i++) rows.push([i, `Client ${i}`, `Client ${i} Limited`, E, `Group ${i % 50}`]);
  const r = parseTab(rows);
  assert.equal(r.status, "ok");
  assert.equal(r.entries.length, 2000 * 3);
  assert.equal(r.entries[0].row, 2);
  assert.equal(r.entries[r.entries.length - 1].row, 2001);
});

test("tabs: every tab by default, SYNC_TAB_NAMES restricts, a configured tab that is absent is reported", () => {
  assert.deepEqual(selectTabs(["Sheet1", "Notes"], null), { selected: ["Sheet1", "Notes"], ignored: [], missing: [] });
  assert.deepEqual(selectTabs(["Sheet1", "Notes"], []), { selected: ["Sheet1", "Notes"], ignored: [], missing: [] });
  assert.deepEqual(selectTabs(["Sheet1", "Notes"], ["sheet1 "]), { selected: ["Sheet1"], ignored: ["Notes"], missing: [] });
  assert.deepEqual(selectTabs(["Sheet1"], ["Clients", "Sheet1"]), { selected: ["Sheet1"], ignored: [], missing: ["Clients"] });
  assert.equal(parseTabNames(undefined), null);
  assert.equal(parseTabNames("  ,  "), null);
  assert.deepEqual(parseTabNames("Sheet1, Clients ,"), ["Sheet1", "Clients"]);
});

const tab = (name: string, rows: unknown[][]) => ({ tab: name, result: parseTab(rows) });

test("snapshot: the same text in several columns is ONE name with several types and occurrences", () => {
  const s = buildSnapshot([tab("Sheet1", standard())]);
  assert.equal(s.complete, true);
  const two = s.names.find((n) => n.normalized === "example client two");
  assert.ok(two);
  // Client Name, Friendly Name and Client Group all say "Example Client Two"
  assert.deepEqual([...two.types].sort(), ["client", "friendly", "group"]);
  assert.deepEqual(two.occurrences.map((o) => [o.column, o.row]).sort(), [["client_group", 3], ["client_name", 3], ["friendly_name", 3]]);
  assert.equal(two.display, "Example Client Two");
  const legal = s.names.find((n) => n.normalized === "example client one private limited");
  assert.deepEqual(legal?.types, ["legal"]);
  const group = s.names.find((n) => n.normalized === "example group");
  assert.deepEqual(group?.types, ["group"]);
});

test("snapshot: spelling differences merge only when identical after normalisation; look-alikes are reported, not merged", () => {
  const t = tab("Sheet1", [HEADER, [1, "ACME  Ltd", "Acme Limited", "acme ltd", E]]);
  const s = buildSnapshot([t]);
  assert.deepEqual(s.names.map((n) => n.normalized).sort(), ["acme limited", "acme ltd"]);
  assert.equal(s.names.find((n) => n.normalized === "acme ltd")?.display, "ACME  Ltd", "first spelling kept");
  assert.deepEqual(s.names.find((n) => n.normalized === "acme ltd")?.types.sort(), ["client", "friendly"]);
  assert.ok(s.anomalies.some((a) => a.type === "possible_variant"));
});

test("snapshot: duplicates, unusable and short values and a missing optional column are all reported", () => {
  const t = tab("Sheet1", [["S.No", "Client Name", "Legal Name"], [1, "Ex One", E], [2, "ex one", E], [3, "---", E], [4, "Ab", E]]);
  const s = buildSnapshot([t]);
  assert.deepEqual(s.anomalies.map((a) => a.type).sort(), ["duplicate_in_tab", "missing_optional_column", "short_name", "unusable_value"]);
  // one entry per kind, with a count: both optional columns (Friendly Name, Client Group) are missing from this tab
  assert.equal(s.anomalies.find((a) => a.type === "missing_optional_column")?.count, 2);
});

test("snapshot: complete only when every tab was read and parsed", () => {
  const ok = tab("Sheet1", standard());
  const bad = tab("Notes", [["nothing", "here"]]);
  assert.equal(buildSnapshot([ok]).complete, true);
  assert.equal(buildSnapshot([ok, bad]).complete, false);
  assert.equal(buildSnapshot([ok, { tab: "Other", failed: true }]).complete, false);
  assert.equal(buildSnapshot([]).complete, false);
  assert.equal(buildSnapshot([ok, tab("Empty", [HEADER])]).complete, true);
});

test("snapshot report carries tab names, statuses and counts only", () => {
  const s = buildSnapshot([tab("Sheet1", [HEADER, [1, "Ex One", E, E, E]])]);
  assert.deepEqual(s.tabs, [{ tab: "Sheet1", status: "ok", entries: 1 }]);
});
