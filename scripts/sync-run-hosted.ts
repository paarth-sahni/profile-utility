/**
 * Purpose: ONE-OFF helper that runs the real registry synchronisation against the HOSTED database from the maintainer's own
 * computer, using the production env file (the sheet is read with the maintainer's read-only Google sign-in). It exists to fill the
 * registry before the checker is switched on in production, and to refresh it later by hand. It refuses to run unless you confirm
 * the target on the command line, and it prints the database host only (never a key) plus counts, tab titles and codes, never a cell value.
 * Run: npm run sync:run:hosted -- --confirm=<project host, e.g. abcd.supabase.co>
 *      npm run sync:run:hosted -- --confirm=<host> --day=2026-01-02    (another day, to run again: a day that succeeded is closed)
 */
import { SyncError } from "../lib/sync/errors";
import { runConfiguredSync, summarizeRun } from "../lib/sync/runner";

const today = (): string => new Date().toISOString().slice(0, 10);
const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new SyncError("CONFIG", "NEXT_PUBLIC_SUPABASE_URL is not set (pass the production env file with --env-file).");
  const host = new URL(url).hostname;
  if (host === "127.0.0.1" || host === "localhost") throw new SyncError("CONFIG", "This is the HOSTED-database tool; for the local database use npm run sync:run:local.");
  if (flag("confirm") !== host) throw new SyncError("CONFIG", `Add --confirm=${host} to confirm that this run writes to that database.`);

  const arg = flag("day");
  const day = arg ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SyncError("CONFIG", "--day must look like 2026-01-02.");

  console.log(`Target database: ${host}`);
  const result = await runConfiguredSync({ trigger: "scheduled", triggeredBy: null, scheduledFor: day });
  const s = summarizeRun(result);
  console.log(`Run ${s.status.toUpperCase()}${s.errorCode ? ` (${s.errorCode})` : ""} for ${day}, attempt ${s.attempt}.`);
  console.log("Counts:", JSON.stringify(s.counts));
  console.log("Tabs:", JSON.stringify(s.tabs));
  if (s.status !== "succeeded") console.log("A partial or failed run adds new names but never marks any missing. Fix the cause and run again.");
  else console.log("The running app picks the new list up within about a minute.");
  return s.status === "failed" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof SyncError ? `${e.code}: ${e.message}` : "sync:run:hosted failed.");
    process.exit(1);
  },
);
