/**
 * Purpose: the owners' IB codes for the profile names shown in My Profiles and Profile Hub (lib/docxReady.ts,
 * profileDisplayName), by email from the Teams data (lib/teamsClient.ts, which caches answers for 10 minutes and failures for
 * 1 minute). One email is looked up on its own, several through the cached list of everyone. Never blocks a page: a failure, a
 * missing code or an answer slower than `waitMs` gives an empty map, and the names fall back to the form without the code.
 * Server-only.
 */
import "server-only";
import type { TeamsClient } from "./teamsClient";

const WAIT_MS = 1500;

export async function ibCodesByEmail(
  teams: Pick<TeamsClient, "byEmail" | "all">,
  emails: (string | null | undefined)[],
  waitMs = WAIT_MS,
): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()))];
  const codes = new Map<string, string>();
  if (wanted.length === 0) return codes;
  const lookup = async () => {
    const people =
      wanted.length === 1
        ? await teams.byEmail(wanted[0]).then((r) => (r.ok && r.data ? [r.data] : []))
        : await teams.all().then((r) => (r.ok ? r.data : []));
    for (const p of people) if (p.ibCode && wanted.includes(p.email)) codes.set(p.email, p.ibCode);
    return codes;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookup(), new Promise<Map<string, string>>((done) => (timer = setTimeout(() => done(new Map()), waitMs)))]);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

/** The IB code for one owner's email, or null (same rules as ibCodesByEmail). */
export async function ibCodeOf(teams: Pick<TeamsClient, "byEmail" | "all">, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  return (await ibCodesByEmail(teams, [email])).get(email.trim().toLowerCase()) ?? null;
}
