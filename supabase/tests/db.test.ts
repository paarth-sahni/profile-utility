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
import {
  ForbiddenError,
  ProfileNotFoundError,
  getProfileForManagerAs,
  getVersionForManagerAs,
  saveVersionAs,
  searchProfilesByNameAs,
  type DbContext,
} from "../../lib/db/profilesCore";
import type { SavePayload } from "../../lib/profilePayload";
import { EXTERNAL_FIXTURE, INTERNAL_FIXTURE } from "./fixtures";

const PASSWORD = "password123";
type RoleName = "member" | "member2" | "admin" | "manager" | "checker";

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
  for (const r of ["member", "member2", "admin", "manager", "checker"] as const) ctx[r] = await contextFor(r);
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

describe("manager/admin name search and read-only views", () => {
  const SEEDED = ["Alex Sample", "Jamie Placeholder", "Riley Example"];

  for (const who of ["manager", "admin"] as const) {
    test(`${who} finds a seeded profile by a partial name`, async () => {
      const hits = await searchProfilesByNameAs(ctx[who], "alex samp");
      assert.equal(hits[0]?.candidateName, "Alex Sample");
      assert.equal(hits[0]?.ownerEmail, "member@example.test");
      assert.equal(hits[0]?.versionCount, 2);
    });

    test(`${who}: an empty query lists every seeded profile`, async () => {
      const names = (await searchProfilesByNameAs(ctx[who], "")).map((h) => h.candidateName);
      for (const n of SEEDED) assert.ok(names.includes(n), `${n} missing`);
    });
  }

  test("a similar (misspelled) name still matches (trigram)", async () => {
    const hits = await searchProfilesByNameAs(ctx.manager, "Jamie Placeholdr");
    assert.equal(hits[0]?.candidateName, "Jamie Placeholder");
  });

  test("LIKE wildcards in the query are literal", async () => {
    assert.deepEqual(await searchProfilesByNameAs(ctx.manager, "%"), []);
  });

  test("the manager finds a profile a member just saved", async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload({ data: { ...INTERNAL_FIXTURE, name: "Zebediah Searchable" } }));
    createdProfiles.push(saved.profileId);
    const hits = await searchProfilesByNameAs(ctx.manager, "zebediah");
    assert.equal(hits[0]?.id, saved.profileId);
  });

  for (const who of ["member", "member2", "checker"] as const) {
    test(`${who} gets ForbiddenError from every manager function`, async () => {
      await assert.rejects(searchProfilesByNameAs(ctx[who], "alex"), ForbiddenError);
      await assert.rejects(searchProfilesByNameAs(ctx[who], ""), ForbiddenError);
      const alex = (await searchProfilesByNameAs(ctx.manager, "Alex Sample"))[0];
      await assert.rejects(getProfileForManagerAs(ctx[who], alex.id), ForbiddenError);
      const history = await getProfileForManagerAs(ctx.manager, alex.id);
      await assert.rejects(getVersionForManagerAs(ctx[who], history!.versions[0].id), ForbiddenError);
    });
  }

  test("the manager reads another user's history and versions", async () => {
    const alex = (await searchProfilesByNameAs(ctx.manager, "Alex Sample"))[0];
    const history = await getProfileForManagerAs(ctx.manager, alex.id);
    assert.equal(history?.profile.ownerEmail, "member@example.test");
    assert.equal(history?.versions.length, 2);
    const v = await getVersionForManagerAs(ctx.manager, history!.latestVersionId!);
    assert.equal((v?.data as { name: string }).name, "Alex Sample");
  });

  test("an unknown profile id is null, not an error", async () => {
    assert.equal(await getProfileForManagerAs(ctx.manager, "00000000-0000-0000-0000-00000000dead"), null);
  });
});

// Referenced so the fixtures stay imported for the round-trip tests added next.
void EXTERNAL_FIXTURE;
