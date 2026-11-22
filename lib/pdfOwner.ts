/**
 * Purpose: the IB code for a PDF's file name (lib/pdfHandler.ts, ownerIbCode): the profile OWNER's, looked up by email in the
 * Teams data (lib/teamsClient.ts). The owner is the signed-in user, or, for a saved version (Profile Hub, My Profiles), the
 * owner of that version's profile, read with the user's own session (RLS: only someone who may read the profile finds its
 * owner). Null whenever anything is missing or fails: the name then falls back to NameSurname_Role_InfoBeans.pdf. Server-only.
 */
import "server-only";
import type { TeamsClient } from "./teamsClient";

export type OwnerLookup = {
  /** The signed-in user's email. */
  userEmail: () => Promise<string | null>;
  /** The email of the owner of this saved version's profile, or null when the user cannot read it. */
  versionOwnerEmail: (versionId: string) => Promise<string | null>;
  teams: Pick<TeamsClient, "byEmail">;
};

export async function ownerIbCodeWith(lookup: OwnerLookup, versionId: string | null): Promise<string | null> {
  try {
    const email = versionId ? await lookup.versionOwnerEmail(versionId) : await lookup.userEmail();
    if (!email) return null;
    const found = await lookup.teams.byEmail(email);
    return found.ok ? (found.data?.ibCode ?? null) : null;
  } catch {
    return null;
  }
}
