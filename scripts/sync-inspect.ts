/**
 * Purpose: a dry run of the synchronisation that shows only the STRUCTURE of the sheet: which tabs are read, whether each
 * tab's header was found, which columns, and row counts. It makes no database write, imports no Supabase code and prints no
 * cell values, spreadsheet id or key. Use it to check access and layout before the first real sync, and to share a report if
 * a tab does not parse (the report is safe to paste into a ticket).
 * Run: npm run sync:inspect   (reads GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SA_*, SYNC_TAB_NAMES from .env)
 */
import { buildSnapshot, type TabInput } from "../lib/sync/buildSnapshot";
import { loadSheetsConfig } from "../lib/sync/config";
import { SyncError } from "../lib/sync/errors";
import { parseTab } from "../lib/sync/parseTab";
import { createSheetsClient } from "../lib/sync/sheetsClient";
import { selectTabs } from "../lib/sync/tabs";

export async function inspect(log: (line: string) => void = console.log): Promise<number> {
  const config = loadSheetsConfig();
  const sheets = createSheetsClient(config);
  const titles = await sheets.listTabs();
  const { selected, ignored, missing } = selectTabs(titles, config.tabNames);
  log(`Tabs in the sheet: ${titles.length}. To read: ${selected.length}${config.tabNames ? " (restricted by SYNC_TAB_NAMES)" : " (every tab)"}. Ignored: ${ignored.length}.`);
  if (ignored.length) log(`Ignored tab titles: ${ignored.join(" | ")}`);
  for (const m of missing) log(`- ${m}: MISSING (named in SYNC_TAB_NAMES but not in the sheet)`);
  if (selected.length === 0) {
    log("No tab to read.");
    return 1;
  }

  const read = await sheets.readTabs(selected);
  const inputs: TabInput[] = [];
  for (const tab of selected) {
    const got = read.get(tab);
    if (!got || "failed" in got) {
      log(`- ${tab}: NOT READ (${got && "failed" in got ? got.failed.code : "missing"})`);
      inputs.push({ tab, failed: true });
      continue;
    }
    const result = parseTab(got.rows);
    inputs.push({ tab, result });
    if (result.headerRow === undefined) {
      log(`- ${tab}: ${result.status.toUpperCase()} (no single header row with Client Name and Legal Name in columns A:E)`);
      continue;
    }
    const perColumn = result.columns.map((c) => `${c}=${result.entries.filter((e) => e.column === c).length}`).join(", ");
    log(`- ${tab}: ${result.status.toUpperCase()}; header row ${result.headerRow}; columns found: ${result.columns.join(", ")}; values: ${perColumn}; blank rows: ${result.blankRows}`);
    if (result.missingOptional.length) log(`  optional columns not found: ${result.missingOptional.join(", ")}`);
  }
  for (const m of missing) inputs.push({ tab: m, failed: true });

  const snap = buildSnapshot(inputs);
  log(`Distinct names: ${snap.names.length}. Snapshot complete: ${snap.complete && snap.names.length > 0 ? "yes" : "no"}.`);
  for (const a of snap.anomalies) log(`Anomaly: ${a.type}${a.tab ? ` in ${a.tab}` : ""} x${a.count}`);
  return snap.complete && snap.names.length > 0 ? 0 : 1;
}

// run only when started directly (not when imported by a test)
if (process.argv[1] && /sync-inspect\.[cm]?[jt]s$/.test(process.argv[1])) {
  inspect().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof SyncError ? `${e.code}: ${e.message}` : "Unexpected failure.");
      process.exit(2);
    },
  );
}
