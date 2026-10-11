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

export interface ProfileSummary {
  id: string;
  template: TemplateId;
  candidateName: string;
  versionCount: number;
  updatedAt: string;
}

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
): Promise<{ profileId: string; versionId: string; versionNo: number }> {
  if (p.profileId) {
    const { data: owned } = await supabase.from("profiles").select("id").eq("id", p.profileId).eq("owner_id", userId).maybeSingle();
    if (!owned) throw new ProfileNotFoundError();
  }
  const { data, error } = await supabase.rpc("save_profile_version", {
    p_profile_id: p.profileId ?? null,
    p_template: p.template,
    p_kind: p.kind,
    p_label: p.label,
    p_parent: p.parentVersionId ?? null,
    p_source: p.source,
    p_profile: p.data,
    p_flags: p.reviewFlags,
    p_analysis: p.analysis ?? null,
    p_prompt_plan: p.promptPlan,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new Error("SAVE_FAILED");
  const { data: v } = await supabase.from("profile_versions").select("profile_id").eq("id", row.new_version_id).single();
  if (!v) throw new Error("SAVE_FAILED");
  return { profileId: v.profile_id, versionId: row.new_version_id, versionNo: row.new_version_no };
}

/** The signed-in user's own profiles, newest first. */
export async function listMyProfilesAs({ supabase, userId }: DbContext): Promise<ProfileSummary[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, template, candidate_name, updated_at, profile_versions!profile_versions_profile_id_fkey(count)")
    .eq("owner_id", userId)
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("LIST_FAILED");
  return (data ?? []).map((r) => ({
    id: r.id,
    template: r.template as TemplateId,
    candidateName: r.candidate_name,
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
    .select("id, template, candidate_name, updated_at, current_version_id")
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
      versionCount: versions.length,
      updatedAt: p.updated_at,
    },
    versions,
    latestVersionId: p.current_version_id ?? versions[0]?.id ?? null,
  };
}

/** Loads one saved version; null unless it belongs to the signed-in user. */
export async function getVersionAs({ supabase, userId }: DbContext, versionId: string): Promise<LoadedVersion | null> {
  if (!uuid.safeParse(versionId).success) return null;
  const { data, error } = await supabase.rpc("get_profile_version", { p_version_id: versionId });
  if (error || !data) return null;
  const j = data as { template: TemplateId; data: unknown; reviewFlags: unknown; meta: LoadedVersion["meta"] };
  // Explicit ownership check (RLS alone would also let checker/manager/admin through).
  const { data: owned } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", j.meta.profileId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!owned) return null;
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
