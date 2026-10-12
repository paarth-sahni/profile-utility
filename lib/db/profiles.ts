/**
 * Purpose: server-side profile persistence for pages and route handlers. Each function builds a
 * user-session Supabase client from the request (so Row Level Security applies) and delegates to
 * ./profilesCore.ts, where the logic lives. Server-only. Never log profile content.
 */
import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SavePayload } from "@/lib/profilePayload";
import {
  getMyProfileAs,
  getProfileForManagerAs,
  getVersionAs,
  getVersionForManagerAs,
  listMyProfilesAs,
  saveVersionAs,
  searchProfilesByNameAs,
  type DbContext,
  type LoadedVersion,
  type ManagedProfileSummary,
  type ProfileSummary,
  type VersionSummary,
} from "./profilesCore";

export { ExternalNotSavedError, ForbiddenError, ProfileNotFoundError } from "./profilesCore";
export type { DbContext, LoadedVersion, ManagedProfileSummary, ProfileSummary, VersionSummary };

async function ctx(): Promise<DbContext> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase: await createSupabaseServerClient(), userId: user.id };
}

/** Saves a new immutable version (creating the profile when `payload.profileId` is empty). */
export async function saveVersion(payload: SavePayload): Promise<{ profileId: string; versionId: string; versionNo: number }> {
  return saveVersionAs(await ctx(), payload);
}

/** The signed-in user's own profiles, newest first. */
export async function listMyProfiles(): Promise<ProfileSummary[]> {
  return listMyProfilesAs(await ctx());
}

/** One of the user's own profiles with its version history; null if missing or not theirs. */
export async function getMyProfile(id: string): Promise<{ profile: ProfileSummary; versions: VersionSummary[]; latestVersionId: string | null } | null> {
  return getMyProfileAs(await ctx(), id);
}

/** Loads one saved version; null unless it belongs to the signed-in user. */
export async function getVersion(versionId: string): Promise<LoadedVersion | null> {
  return getVersionAs(await ctx(), versionId);
}

/** Manager/admin only (throws ForbiddenError otherwise): trigram name search; empty query = most recent. */
export async function searchProfilesByName(query: string): Promise<ManagedProfileSummary[]> {
  return searchProfilesByNameAs(await ctx(), query);
}

/** Manager/admin only: any profile with its version history. */
export async function getProfileForManager(id: string): Promise<{ profile: ManagedProfileSummary; versions: VersionSummary[]; latestVersionId: string | null } | null> {
  return getProfileForManagerAs(await ctx(), id);
}

/** Manager/admin only: one version of any profile, for the read-only view. */
export async function getVersionForManager(versionId: string): Promise<LoadedVersion | null> {
  return getVersionForManagerAs(await ctx(), versionId);
}
