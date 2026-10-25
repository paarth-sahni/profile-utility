/**
 * Purpose: ONE synchronisation attempt, used by both the scheduled job and the administrator's button (there is no second
 * implementation). Steps: start a run (the database refuses a second one running, a manual cooldown and too many retries),
 * list the tabs, read columns A:E of the tabs to use (every tab, or the ones named in SYNC_TAB_NAMES), parse, build the snapshot, apply it in one
 * database transaction, and close the run. The run is ALWAYS closed (success, partial or failed), so the lock cannot stick.
 *   succeeded  every tab was read and had the expected layout (a complete snapshot, the only kind that may flag missing names)
 *   partial    some tab could not be read or parsed: new names are still added, nothing is marked missing
 *   failed     nothing was applied
 * Everything stored or returned is counts, tab titles and codes; never a cell value, key or spreadsheet id. Pure apart from
 * the injected sheets client and database, so it is tested with fakes.
 */
import { buildSnapshot, type TabInput, type TabReport } from "./buildSnapshot";
import { SyncError, toSyncError, type SyncErrorCode } from "./errors";
import { parseTab } from "./parseTab";
import type { SheetsClient } from "./sheetsClient";
import { selectTabs } from "./tabs";
import type { BeginRunInput, FinalStatus, SyncDb } from "./types";

/** `tabNames`: only these tabs (from SYNC_TAB_NAMES), or null/undefined for every tab. */
export type RunDeps = { sheets: SheetsClient; db: SyncDb; tabNames?: string[] | null };

export type RunResult = {
  runId: string;
  attempt: number;
  status: FinalStatus;
  errorCode: SyncErrorCode | null;
  tabs: TabReport[];
  ignoredTabs: string[];
  counts: { namesNew: number; namesUpdated: number; occurrences: number; missingCandidates: number } | null;
  /** True when the run could not be closed in the database either (the next run will close it as stale). */
  closeFailed: boolean;
};

export async function runSync(input: BeginRunInput, deps: RunDeps): Promise<RunResult> {
  const { sheets, db, tabNames } = deps;

  // 1. start: refusals (already running, cooldown, retry limit) leave no run behind and are reported to the caller
  const { runId, attempt } = await db.beginRun(input);

  let tabs: TabReport[] = [];
  let ignoredTabs: string[] = [];
  let discovered = 0;
  try {
    // 2-3. which tabs, then their cells
    const titles = await sheets.listTabs();
    discovered = titles.length;
    const { selected, ignored, missing } = selectTabs(titles, tabNames);
    ignoredTabs = ignored;
    if (selected.length === 0) throw new SyncError("NO_TABS");
    const read = await sheets.readTabs(selected);

    // 4. parse each tab on its own; a tab that could not be read is not an empty tab
    const inputs: TabInput[] = [
      ...selected.map((tab): TabInput => {
        const got = read.get(tab);
        return got && "rows" in got ? { tab, result: parseTab(got.rows) } : { tab, failed: true };
      }),
      // a tab named in SYNC_TAB_NAMES that is not in the sheet (renamed?) must not be skipped silently
      ...missing.map((tab): TabInput => ({ tab, failed: true })),
    ];
    const failedRead = selected.find((t) => {
      const got = read.get(t);
      return !got || "failed" in got;
    });
    const readError = failedRead ? (read.get(failedRead) as { failed?: SyncError } | undefined)?.failed : undefined;

    // 5. snapshot. An all-empty sheet is never treated as complete: it would make every name look as if it had left.
    const snapshot = buildSnapshot(inputs);
    // a configured tab that is not in the sheet is reported as such, not as a read failure
    tabs = snapshot.tabs.map((t) => (missing.includes(t.tab) ? { ...t, status: "missing" } : t));
    const empty = snapshot.names.length === 0;
    const complete = snapshot.complete && !empty;

    // 6. apply in ONE transaction, then close
    const applied = await db.applySnapshot(runId, { complete, names: snapshot.names });
    const parseProblem = missing.length > 0 || snapshot.tabs.some((t) => t.status === "unparseable" || t.status === "ambiguous");
    const errorCode: SyncErrorCode | null = complete
      ? null
      : parseProblem
        ? "SHEETS_PARSE"
        : readError
          ? readError.code
          : empty
            ? "EMPTY_SHEET"
            : "SHEETS_UNAVAILABLE";
    const status: FinalStatus = complete ? "succeeded" : "partial";
    const notOk = tabs.filter((t) => t.status !== "ok" && t.status !== "empty_section").length;

    const closeFailed = await close(db, {
      runId,
      status,
      tabsDiscovered: discovered,
      tabsScanned: selected.length + missing.length - notOk,
      tabsFailed: notOk,
      tabReport: [...tabs, ...ignored.map((tab) => ({ tab, status: "ignored", entries: 0 }))],
      anomalies: snapshot.anomalies,
      errorCode,
      errorSummary: errorCode ? new SyncError(errorCode).message : null,
    });
    return {
      runId,
      attempt,
      status,
      errorCode,
      tabs,
      ignoredTabs,
      counts: {
        namesNew: applied.names_new,
        namesUpdated: applied.names_updated,
        occurrences: applied.occurrences,
        missingCandidates: applied.missing_candidates,
      },
      closeFailed,
    };
  } catch (e) {
    const err = toSyncError(e);
    const closeFailed = await close(db, {
      runId,
      status: "failed",
      tabsDiscovered: discovered,
      tabsScanned: 0,
      tabsFailed: 0,
      tabReport: [],
      anomalies: [],
      errorCode: err.code,
      errorSummary: err.message,
    });
    return { runId, attempt, status: "failed", errorCode: err.code, tabs, ignoredTabs, counts: null, closeFailed };
  }
}

/** Closes the run; returns true when even that failed (the next run closes it as stale). */
async function close(db: SyncDb, input: Parameters<SyncDb["finishRun"]>[0]): Promise<boolean> {
  try {
    await db.finishRun(input);
    return false;
  } catch {
    return true;
  }
}
