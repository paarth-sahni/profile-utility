/**
 * Purpose: DEVELOPMENT helper that runs the real registry synchronisation (the same pipeline as the admin button and the
 * scheduled job) against the LOCAL database, without signing in to the app or needing the administrator role. Use it to fill the
 * local registry from your test sheet, then test the checker in the app. Refused in production and whenever the database URL is not
 * a local address. Prints counts, tab titles and codes only, never a cell value.
 * Run: npm run sync:run:local                         (a scheduled-style run for today)
 *      npm run sync:run:local -- --day=2026-01-02     (use another day to run again: a day that succeeded is closed)
 */
import { isLoopbackUrl } from "../lib/sync/config";
import { SyncError } from "../lib/sync/errors";
import { runConfiguredSync, summarizeRun } from "../lib/sync/runner";

const today = (): string => new Date().toISOString().slice(0, 10);

async function main(): Promise<number> {
  if (process.env.NODE_ENV === "production") throw new SyncError("CONFIG", "sync:run:local is a development tool and is refused in production.");
  const db = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!db || !isLoopbackUrl(db)) throw new SyncError("CONFIG", "sync:run:local only runs against the local database (NEXT_PUBLIC_SUPABASE_URL must be a local address). Use .env.local, not .env.");

  const arg = process.argv.find((a) => a.startsWith("--day="))?.slice("--day=".length);
  const day = arg ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new SyncError("CONFIG", "--day must look like 2026-01-02.");

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
    console.error(e instanceof SyncError ? `${e.code}: ${e.message}` : "sync:run:local failed.");
    process.exit(1);
  },
);
