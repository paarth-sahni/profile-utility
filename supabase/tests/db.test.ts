/**
 * Purpose: tests the app's server data layer (lib/db/profiles.ts) against the local Supabase stack, acting as
 * seeded fictional users through their own sessions, so RLS applies exactly as in the app.
 * Requires `npm run db:start && npm run db:reset`. Run: `npm run test:db`.
 * Covers: a user cannot save into someone else's profile (even an admin), and (added later) round trips.
 * The service-role key is never used. Tests delete the profiles they create (through the admin's session).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ProfileNotFoundError, saveVersionAs, type DbContext } from "../../lib/db/profilesCore";
import type { SavePayload } from "../../lib/profilePayload";
import { EXTERNAL_FIXTURE, INTERNAL_FIXTURE } from "./fixtures";

const PASSWORD = "password123";
type RoleName = "member" | "member2" | "admin" | "manager";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to .env.local and run via npm run test:db.`);
  return value;
}

/** Signs in as a seeded user and returns the context the data layer expects. */
async function contextFor(role: RoleName): Promise<DbContext> {
  const supabase: SupabaseClient = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email: `${role}@example.test`, password: PASSWORD });
  if (error || !data.user) throw new Error(`Sign-in as ${role} failed. Did you run npm run db:reset?`);
  return { supabase, userId: data.user.id };
}

const internalPayload = (over: Partial<SavePayload> = {}): SavePayload => ({
  template: "internal",
  kind: "base",
  label: "Base",
  source: "scratch",
  data: INTERNAL_FIXTURE,
  reviewFlags: [],
  analysis: null,
  promptPlan: [],
  ...over,
});

const ctx = {} as Record<RoleName, DbContext>;
const createdProfiles: string[] = [];

before(async () => {
  for (const r of ["member", "member2", "admin", "manager"] as const) ctx[r] = await contextFor(r);
});

after(async () => {
  // Clean up through the admin's session (admin may delete profiles; versions and children cascade).
  if (createdProfiles.length) await ctx.admin.supabase.from("profiles").delete().in("id", createdProfiles);
  for (const c of Object.values(ctx)) await c.supabase.auth.signOut();
});

describe("saveVersion: ownership", () => {
  let memberProfile: string;

  before(async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload());
    memberProfile = saved.profileId;
    createdProfiles.push(memberProfile);
  });

  test("the owner can save a second version", async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload({ profileId: memberProfile, label: "Second" }));
    assert.equal(saved.profileId, memberProfile);
    assert.equal(saved.versionNo, 2);
  });

  for (const who of ["member2", "admin", "manager"] as const) {
    test(`${who} cannot save into another user's profile`, async () => {
      await assert.rejects(saveVersionAs(ctx[who], internalPayload({ profileId: memberProfile })), ProfileNotFoundError);
      const count = await ctx.member.supabase.from("profile_versions").select("id", { count: "exact", head: true }).eq("profile_id", memberProfile);
      assert.equal(count.count, 2, "no version may have been added");
    });
  }

  test("a made-up profile id gives the same error as someone else's", async () => {
    await assert.rejects(
      saveVersionAs(ctx.member, internalPayload({ profileId: "00000000-0000-0000-0000-00000000dead" })),
      ProfileNotFoundError,
    );
  });
});

// Referenced so the fixtures stay imported for the round-trip tests added next.
void EXTERNAL_FIXTURE;
