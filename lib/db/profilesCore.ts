/**
 * Purpose: the profile persistence logic, written against an explicit DbContext (a user-session Supabase
 * client + the verified user id). No auth or Next.js imports, so tests can call it directly with a seeded
 * user's session; app code uses the wrappers in ./profiles.ts, which build the context from the request.
 * Every function filters by the owner explicitly: checker/manager/admin roles may read everyone's rows
 * through RLS, but "My Profiles" must only ever show your own. Server-only. Never log profile content.
 */
import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reviewFlagSchema } from "@/lib/extract.types";
import { lenientSchemaFor, type SavePayload } from "@/lib/profilePayload";
import type { ResumeData, TemplateId } from "@/lib/schemas";
import { labelForVersion } from "@/lib/versionLabel";

const uuid = z.string().uuid();

/** A user-session Supabase client plus the verified id of the user it acts as. */
export interface DbContext {
  supabase: SupabaseClient;
  userId: string;
}

/** Thrown when a profile does not exist or is not the caller's. Same error for both, so nothing leaks. */
export class ProfileNotFoundError extends Error {
  constructor() {
    super("PROFILE_NOT_FOUND");
    this.name = "ProfileNotFoundError";
  }
}

/** Thrown when asked to store an external profile: those are never saved (only internal profiles are). */
export class ExternalNotSavedError extends Error {
  constructor() {
    super("EXTERNAL_NOT_SAVED");
    this.name = "ExternalNotSavedError";
  }
}

/** Thrown when the caller's role may not do this (manager/admin-only features). Maps to HTTP 403. */
export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export interface ProfileSummary {
  id: string;
  template: TemplateId;
  candidateName: string;
  /** Job title of the current version ("" when unknown); with the name it makes the display name. */
  jobTitle: string;
  /** The owner's primary profile: the one managers see and use. */
  isPrimary: boolean;
  versionCount: number;
  updatedAt: string;
}

/** The job title from an embedded current version (PostgREST returns an object, or an array for some relations). */
const jobTitleOf = (current: unknown): string => {
  const row = (Array.isArray(current) ? current[0] : current) as { job_title?: string } | null | undefined;
  return row?.job_title ?? "";
};

export interface VersionSummary {
  id: string;
  versionNo: number;
  kind: "base" | "role_specific";
  label: string;
  source: string;
  createdAt: string;
}

export interface LoadedVersion {
  template: TemplateId;
  data: ResumeData;
  reviewFlags: z.infer<typeof reviewFlagSchema>[];
  meta: { profileId: string; versionId: string; versionNo: number; label: string; kind: "base" | "role_specific" };
}

/**
 * Saves a new immutable version (creating the profile when `profileId` is empty). When `profileId` is given it must
 * belong to `userId`: RLS alone would let an admin write into someone else's profile, and this app
 * only ever saves to your own. Throws ProfileNotFoundError otherwise, before the RPC runs.
 */
export async function saveVersionAs(
  { supabase, userId }: DbContext,
  p: SavePayload,
): Promise<{ profileId: string; versionId: string; versionNo: number; isPrimary: boolean }> {
  if ((p.template as string) !== "internal") throw new ExternalNotSavedError(); // second line of defence behind the API route
  if (p.profileId) {
    const { data: owned } = await supabase.from("profiles").select("id").eq("id", p.profileId).eq("owner_id", userId).maybeSingle();
    if (!owned) throw new ProfileNotFoundError();
  }
  // Versions are labelled automatically: Base, v2, v3, ... (the number of the version about to be created).
  let nextNo = 1;
  if (p.profileId) {
    const { data: last } = await supabase.from("profile_versions").select("version_no").eq("profile_id", p.profileId).order("version_no", { ascending: false }).limit(1).maybeSingle();
    nextNo = (last?.version_no ?? 0) + 1;
  }
  // submit_profile_version saves and, in the same transaction, sets the primary when asked (or for the first profile)
  const { data, error } = await supabase.rpc("submit_profile_version", {
    p_profile_id: p.profileId ?? null,
    p_template: p.template,
    p_kind: p.kind,
    p_label: p.label || labelForVersion(nextNo),
    p_parent: p.parentVersionId ?? null,
    p_source: p.source,
    p_profile: p.data,
    p_flags: p.reviewFlags,
    p_analysis: p.analysis ?? null,
    p_prompt_plan: p.promptPlan,
    p_make_primary: p.makePrimary ?? false,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("SAVE_FAILED");
  return { profileId: row.profile_id, versionId: row.new_version_id, versionNo: row.new_version_no, isPrimary: row.is_primary };
}

/** The caller's primary profile id (internal, not archived), or null when none is marked yet. */
export async function getMyPrimaryProfileIdAs({ supabase, userId }: DbContext): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("owner_id", userId)
    .eq("template", "internal")
    .eq("archived", false)
    .eq("is_primary", true)
    .maybeSingle();
  return data?.id ?? null;
}

/** Makes one of the caller's own internal profiles their primary one (atomic switch in the database). */
export async function setPrimaryProfileAs({ supabase, userId }: DbContext, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw new ProfileNotFoundError();
  const { data: owned } = await supabase.from("profiles").select("id").eq("id", id).eq("owner_id", userId).eq("template", "internal").eq("archived", false).maybeSingle();
  if (!owned) throw new ProfileNotFoundError();
  const { error } = await supabase.rpc("set_primary_profile", { p_profile_id: id });
  if (error) throw new Error("SET_PRIMARY_FAILED");
}

/** The signed-in user's own INTERNAL profiles, newest first. */
export async function listMyProfilesAs({ supabase, userId }: DbContext): Promise<ProfileSummary[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, template, candidate_name, updated_at, is_primary, current:profile_versions!profiles_current_version_fk(job_title), profile_versions!profile_versions_profile_id_fkey(count)")
    .eq("owner_id", userId)
    .eq("template", "internal") // external profiles are never saved; any old ones are not listed
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("LIST_FAILED");
  return (data ?? []).map((r) => ({
    id: r.id,
    template: r.template as TemplateId,
    candidateName: r.candidate_name,
    jobTitle: jobTitleOf(r.current),
    isPrimary: r.is_primary,
    versionCount: (r.profile_versions as unknown as { count: number }[])?.[0]?.count ?? 0,
    updatedAt: r.updated_at,
  }));
}

/** One of the user's own profiles with its version history; null if missing or not theirs. */
export async function getMyProfileAs(
  { supabase, userId }: DbContext,
  id: string,
): Promise<{ profile: ProfileSummary; versions: VersionSummary[]; latestVersionId: string | null } | null> {
  if (!uuid.safeParse(id).success) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("id, template, candidate_name, updated_at, current_version_id, is_primary, current:profile_versions!profiles_current_version_fk(job_title)")
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!p) return null;
  const { data: vs } = await supabase
    .from("profile_versions")
    .select("id, version_no, kind, label, source, created_at")
    .eq("profile_id", p.id)
    .order("version_no", { ascending: false });
  const versions: VersionSummary[] = (vs ?? []).map((v) => ({
    id: v.id,
    versionNo: v.version_no,
    kind: v.kind as VersionSummary["kind"],
    label: v.label,
    source: v.source,
    createdAt: v.created_at,
  }));
  return {
    profile: {
      id: p.id,
      template: p.template as TemplateId,
      candidateName: p.candidate_name,
      jobTitle: jobTitleOf(p.current),
      isPrimary: p.is_primary,
      versionCount: versions.length,
      updatedAt: p.updated_at,
    },
    versions,
    latestVersionId: p.current_version_id ?? versions[0]?.id ?? null,
  };
}

/** Rebuilds one version through get_profile_version (RLS decides visibility); null if missing/invalid. */
async function fetchVersion(supabase: SupabaseClient, versionId: string): Promise<LoadedVersion | null> {
  if (!uuid.safeParse(versionId).success) return null;
  const { data, error } = await supabase.rpc("get_profile_version", { p_version_id: versionId });
  if (error || !data) return null;
  const j = data as { template: TemplateId; data: unknown; reviewFlags: unknown; meta: LoadedVersion["meta"] };
  const parsed = lenientSchemaFor(j.template).safeParse(j.data);
  const flags = z.array(reviewFlagSchema).safeParse(j.reviewFlags);
  if (!parsed.success) return null;
  return {
    template: j.template,
    data: parsed.data as ResumeData,
    reviewFlags: flags.success ? flags.data : [],
    meta: j.meta,
  };
}

/** Loads one saved version; null unless it belongs to the signed-in user. */
export async function getVersionAs({ supabase, userId }: DbContext, versionId: string): Promise<LoadedVersion | null> {
  const v = await fetchVersion(supabase, versionId);
  if (!v) return null;
  // Explicit ownership check (RLS alone would also let checker/manager/admin through).
  const { data: owned } = await supabase.from("profiles").select("id").eq("id", v.meta.profileId).eq("owner_id", userId).maybeSingle();
  return owned ? v : null;
}

// ---------------------------------------------------------------------------------------------------------
// Manager / admin views (/manage). Read-only: nothing here writes.
// ---------------------------------------------------------------------------------------------------------

export interface ManagedProfileSummary extends ProfileSummary {
  ownerName: string;
  ownerEmail: string;
  score: number;
}

const searchRow = z.object({
  id: z.string().uuid(),
  template: z.enum(["internal", "external"]),
  candidate_name: z.string(),
  owner_name: z.string().nullable(),
  owner_email: z.string().nullable(),
  version_count: z.number(),
  updated_at: z.string(),
  score: z.number(),
  is_primary: z.boolean(),
});

/** Throws ForbiddenError unless the caller is a manager or admin (role read from the database, not the client). */
async function requireManagerAs(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.rpc("current_app_role");
  if (error) throw new Error("ROLE_CHECK_FAILED");
  if (data !== "manager" && data !== "admin") throw new ForbiddenError();
}

/**
 * Trigram name search over every profile, for managers and admins only (ForbiddenError otherwise: the SQL
 * function checks the role as well). An empty query lists the most recently updated profiles. Max 50 rows.
 */
export async function searchProfilesByNameAs({ supabase }: DbContext, query: string): Promise<ManagedProfileSummary[]> {
  const q = query.trim().slice(0, 100);
  const { data, error } = await supabase.rpc("search_profiles_by_name", { p_query: q });
  if (error) {
    if (error.code === "42501") throw new ForbiddenError();
    throw new Error("SEARCH_FAILED");
  }
  const parsed = z.array(searchRow).safeParse(data ?? []);
  if (!parsed.success) throw new Error("SEARCH_FAILED");
  const titles = new Map<string, string>();
  if (parsed.data.length > 0) {
    const { data: cur } = await supabase
      .from("profiles")
      .select("id, current:profile_versions!profiles_current_version_fk(job_title)")
      .in("id", parsed.data.map((r) => r.id));
    for (const c of cur ?? []) titles.set(c.id, jobTitleOf(c.current));
  }
  return parsed.data.map((r) => ({
    id: r.id,
    template: r.template,
    candidateName: r.candidate_name,
    jobTitle: titles.get(r.id) ?? "",
    isPrimary: r.is_primary,
    versionCount: r.version_count,
    updatedAt: r.updated_at,
    ownerName: r.owner_name ?? "",
    ownerEmail: r.owner_email ?? "",
    score: r.score,
  }));
}

/**
 * Any profile with its version history, for managers/admins; null if it does not exist. `otherProfiles` are the same
 * person's other internal profiles (newest first), so a manager can still open them from the primary one.
 */
export async function getProfileForManagerAs(
  { supabase }: DbContext,
  id: string,
): Promise<{ profile: ManagedProfileSummary; versions: VersionSummary[]; latestVersionId: string | null; otherProfiles: ProfileSummary[] } | null> {
  await requireManagerAs(supabase);
  if (!uuid.safeParse(id).success) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("id, owner_id, template, candidate_name, updated_at, current_version_id, is_primary, current:profile_versions!profiles_current_version_fk(job_title), owner:app_users!profiles_owner_id_fkey(full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  const { data: vs } = await supabase
    .from("profile_versions")
    .select("id, version_no, kind, label, source, created_at")
    .eq("profile_id", p.id)
    .order("version_no", { ascending: false });
  const versions: VersionSummary[] = (vs ?? []).map((v) => ({
    id: v.id,
    versionNo: v.version_no,
    kind: v.kind as VersionSummary["kind"],
    label: v.label,
    source: v.source,
    createdAt: v.created_at,
  }));
  const owner = p.owner as unknown as { full_name: string | null; email: string | null } | null;
  const { data: others } = await supabase
    .from("profiles")
    .select("id, template, candidate_name, updated_at, is_primary, current:profile_versions!profiles_current_version_fk(job_title), profile_versions!profile_versions_profile_id_fkey(count)")
    .eq("owner_id", p.owner_id)
    .eq("template", "internal")
    .eq("archived", false)
    .neq("id", p.id)
    .order("updated_at", { ascending: false });
  return {
    otherProfiles: (others ?? []).map((r) => ({
      id: r.id,
      template: r.template as TemplateId,
      candidateName: r.candidate_name,
      jobTitle: jobTitleOf(r.current),
      isPrimary: r.is_primary,
      versionCount: (r.profile_versions as unknown as { count: number }[])?.[0]?.count ?? 0,
      updatedAt: r.updated_at,
    })),
    profile: {
      id: p.id,
      template: p.template as TemplateId,
      candidateName: p.candidate_name,
      jobTitle: jobTitleOf(p.current),
      isPrimary: p.is_primary,
      versionCount: versions.length,
      updatedAt: p.updated_at,
      ownerName: owner?.full_name ?? "",
      ownerEmail: owner?.email ?? "",
      score: 0,
    },
    versions,
    latestVersionId: p.current_version_id ?? versions[0]?.id ?? null,
  };
}

/** One version of any profile, for managers/admins (read-only view); null if missing. */
export async function getVersionForManagerAs({ supabase }: DbContext, versionId: string): Promise<LoadedVersion | null> {
  await requireManagerAs(supabase);
  return fetchVersion(supabase, versionId);
}
