/**
 * Purpose: primary profiles by the owner's email, for /profile/<ib_code> and the team list, AFTER lib/teamAccess.ts allowed it.
 *   - the owner themself, managers and admins: their own session (Row Level Security applies, as on every other page);
 *   - a lead whose app role does not let RLS show other people's profiles: the service-role reads of
 *     lib/sync/adminClient.ts (createLeadProfileSource). If that key is not configured, a lead sees "unavailable".
 * Whoever calls this must have checked canOpenProfileOf / canSeeTeamList first. Server-only. Never logs profile content.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createLeadProfileSource } from "@/lib/sync/adminClient";
import type { TeamAccess } from "@/lib/teamAccess";
import { getPrimaryVersionByEmailAs, listPrimaryOwnersAs, parseLoadedVersion, type LoadedVersion } from "./profilesCore";

export type PrimaryProfileResult = { status: "ok"; version: LoadedVersion } | { status: "none" } | { status: "unavailable" };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Uses the user's own session (true) or the lead reads (false). */
const viaSession = (access: TeamAccess, user: { email: string }, email?: string) => access.level === "staff" || (email !== undefined && same(user.email, email));

/** The primary profile of the employee with this email. */
export async function primaryProfileOf(user: { id: string; email: string }, access: TeamAccess, email: string): Promise<PrimaryProfileResult> {
  try {
    if (viaSession(access, user, email)) {
      const version = await getPrimaryVersionByEmailAs({ supabase: await createSupabaseServerClient(), userId: user.id }, email);
      return version ? { status: "ok", version } : { status: "none" };
    }
    if (access.level !== "lead") return { status: "unavailable" }; // (callers check first; never widen access here)
    const raw = await createLeadProfileSource().primaryProfile(email);
    if (raw === null) return { status: "none" };
    const parsed = parseLoadedVersion(raw);
    return parsed ? { status: "ok", version: parsed } : { status: "unavailable" };
  } catch {
    console.error("[profile link] could not read the primary profile"); // no email, no content
    return { status: "unavailable" };
  }
}

/** Which of these emails (lower case) own a primary profile; null when that cannot be read. */
export async function primaryEmailsAmong(user: { id: string; email: string }, access: TeamAccess, emails: string[]): Promise<Set<string> | null> {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
  try {
    if (viaSession(access, user)) {
      const owners = await listPrimaryOwnersAs({ supabase: await createSupabaseServerClient(), userId: user.id });
      return new Set(owners.map((o) => o.email).filter((e) => wanted.has(e)));
    }
    if (access.level !== "lead") return null;
    return new Set((await createLeadProfileSource().primaryProfileEmails([...wanted])).map((e) => e.toLowerCase()));
  } catch {
    console.error("[team list] could not read which profiles exist");
    return null;
  }
}

/** The owner's email of a saved version for a lead (the PDF file name), or null. Staff and owners use their session instead. */
export async function versionOwnerEmailForLead(access: TeamAccess, versionId: string): Promise<string | null> {
  if (access.level !== "lead") return null;
  try {
    return await createLeadProfileSource().versionOwnerEmail(versionId);
  } catch {
    return null;
  }
}
