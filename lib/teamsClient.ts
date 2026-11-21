/**
 * Purpose: the ONLY way the app reads the Teams app's employee data (IB code, email, name, role, delivery unit, department,
 * manager). It runs ops/teams_db.py (live read, nothing stored; docs/TEAMS-DB.md) with execFile, no shell, validated
 * arguments, a 5 s time-out and only PATH, the locale and the TEAMS_* settings in the child's environment. Answers are kept in
 * memory for 10 minutes (per server process); nothing is written anywhere. It never throws: a failure is { ok: false }, and
 * callers fall back (file name without the IB code, "Team list unavailable", own profile only). Rows are never logged; a
 * failure logs its code only. Server-only.
 *
 * Settings: TEAMS_DB_PYTHON (default python3), TEAMS_DB_SCRIPT (default <cwd>/ops/teams_db.py), and the script's own TEAMS_*.
 */
import "server-only";
import { execFile } from "node:child_process";
import path from "node:path";

export type Employee = {
  ibCode: string | null;
  email: string;
  name: string;
  role: string | null;
  deliveryUnit: string | null;
  department: string | null;
  managerEmail: string | null;
};
export type Units = { deliveryUnits: string[]; departments: string[] };
export type TeamsResult<T> = { ok: true; data: T } | { ok: false; error: string };

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MAX_CACHE = 1000;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;
const IB_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/** Runs the script with these arguments and resolves with its stdout (rejects on failure, time-out or a non-zero exit). */
export type Runner = (args: string[], timeoutMs: number) => Promise<string>;

/** The environment the script gets: what it needs to start, and its own settings. Nothing else (no Supabase or LLM keys). */
function childEnv(): NodeJS.ProcessEnv {
  // (built from scratch: only these keys are passed on)
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("TEAMS_") || ["PATH", "LANG", "LC_ALL", "HOME", "SYSTEMROOT"].includes(k)) env[k] = v;
  return env as NodeJS.ProcessEnv;
}

const defaultRunner: Runner = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const python = process.env.TEAMS_DB_PYTHON?.trim() || "python3";
    const script = process.env.TEAMS_DB_SCRIPT?.trim() || path.join(process.cwd(), "ops", "teams_db.py");
    execFile(python, [script, ...args], { env: childEnv(), timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, shell: false, windowsHide: true }, (error, stdout) => {
      // the script prints {"error": "<code>"} on failure: keep the code, never the driver's message (it is not printed anyway)
      if (error) {
        let code = error.killed ? "timeout" : "script_failed";
        try {
          const parsed = JSON.parse(String(stdout));
          if (parsed && typeof parsed.error === "string" && /^[a-z_]{1,40}$/.test(parsed.error)) code = parsed.error;
        } catch {}
        reject(new Error(code));
      } else resolve(String(stdout));
    });
  });

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** One employee from the script's JSON, or null when it is not one (a malformed row is dropped, never trusted). */
function toEmployee(v: unknown): Employee | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const email = str(r.email)?.toLowerCase();
  if (!email || !EMAIL.test(email)) return null;
  const ibCode = str(r.ib_code);
  return {
    ibCode: ibCode && IB_CODE.test(ibCode) ? ibCode : null,
    email,
    name: str(r.name) ?? email,
    role: str(r.role),
    deliveryUnit: str(r.delivery_unit),
    department: str(r.department),
    managerEmail: str(r.manager_email)?.toLowerCase() ?? null,
  };
}
const toList = (v: unknown): Employee[] => (Array.isArray(v) ? v.map(toEmployee).filter((e): e is Employee => e !== null) : []);

export function createTeamsClient(options: { run?: Runner; now?: () => number; timeoutMs?: number } = {}) {
  const run = options.run ?? defaultRunner;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const cache = new Map<string, { at: number; value: unknown }>();
  const inFlight = new Map<string, Promise<TeamsResult<unknown>>>();

  async function call<T>(args: string[], parse: (json: unknown) => T): Promise<TeamsResult<T>> {
    const key = args.join("\u0000");
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return { ok: true, data: hit.value as T };
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<TeamsResult<T>>;
    const promise = (async (): Promise<TeamsResult<T>> => {
      try {
        const json: unknown = JSON.parse(await run(args, timeoutMs));
        if (json && typeof json === "object" && !Array.isArray(json) && typeof (json as { error?: unknown }).error === "string") throw new Error(String((json as { error: string }).error));
        const value = parse(json);
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now(), value });
        return { ok: true, data: value };
      } catch (e) {
        const code = e instanceof Error && /^[a-z_]{1,40}$/.test(e.message) ? e.message : "bad_output";
        console.warn(`teams: ${args[0]} failed (${code})`); // the command and the code only: no argument, no row
        return { ok: false, error: code };
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
    return promise;
  }

  const bad = <T>(): Promise<TeamsResult<T>> => Promise.resolve({ ok: false, error: "bad_arguments" });
  const email = (e: string) => e.trim().toLowerCase();

  return {
    /** The active employee with this email, or null. */
    byEmail: (e: string): Promise<TeamsResult<Employee | null>> => (EMAIL.test(email(e)) ? call(["by-email", email(e)], toEmployee) : bad()),
    /** The active employee with this IB code, or null. */
    byIbCode: (code: string): Promise<TeamsResult<Employee | null>> => (IB_CODE.test(code.trim()) ? call(["by-code", code.trim().toUpperCase()], toEmployee) : bad()),
    /** Everyone under this person, direct and indirect. */
    team: (e: string): Promise<TeamsResult<Employee[]>> => (EMAIL.test(email(e)) ? call(["team", email(e)], toList) : bad()),
    /** Whether anyone reports to this person (a "lead"). */
    hasReportees: (e: string): Promise<TeamsResult<boolean>> =>
      EMAIL.test(email(e)) ? call(["has-reportees", email(e)], (j) => !!(j && typeof j === "object" && (j as { has_reportees?: unknown }).has_reportees === true)) : bad(),
    /** Every active employee. */
    all: (): Promise<TeamsResult<Employee[]>> => call(["all"], toList),
    /** The delivery units and departments in use. */
    units: (): Promise<TeamsResult<Units>> =>
      call(["units"], (j) => {
        const o = (j ?? {}) as { delivery_units?: unknown; departments?: unknown };
        const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []);
        return { deliveryUnits: list(o.delivery_units), departments: list(o.departments) };
      }),
  };
}

export type TeamsClient = ReturnType<typeof createTeamsClient>;

/** The app's client (one cache per server process). */
export const teams: TeamsClient = createTeamsClient();
