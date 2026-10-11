/**
 * Purpose: tests the app's server data layer (lib/db/profiles.ts) against the local Supabase stack, acting as
 * seeded fictional users through their own sessions, so RLS applies exactly as in the app.
 * Requires `npm run db:start && npm run db:reset`. Run: `npm run test:db`.
 * Covers: save -> load round trips for both templates, version numbering under concurrent saves, a user cannot
 * save into or read someone else's profile (even an admin), and the manager/admin search and read-only views.
 * The service-role key is never used. Tests delete the profiles they create (through the admin's session).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ForbiddenError,
  ProfileNotFoundError,
  getMyProfileAs,
  getProfileForManagerAs,
  getVersionAs,
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

  // Typos and prefixes (pg_trgm word_similarity + word-prefix match). Only the seeded names are asserted, because
  // real people's profiles may also exist in a developer's local database.
  const names = async (q: string): Promise<string[]> => (await searchProfilesByNameAs(ctx.manager, q)).map((h) => h.candidateName);

  for (const q of ["alx", "aelx", "alex sampl", "alex", "Alex Samp", "sam", "lex"]) {
    test(`"${q}" finds Alex Sample and no other seeded profile`, async () => {
      const found = (await names(q)).filter((n) => SEEDED.includes(n));
      assert.deepEqual(found, ["Alex Sample"]);
    });
  }

  test("a full name does not drag in similar-sounding names (Sample vs Example)", async () => {
    assert.deepEqual((await names("Alex Sample")).filter((n) => SEEDED.includes(n)), ["Alex Sample"]);
  });

  test("a short typo of another name finds that person only", async () => {
    assert.deepEqual((await names("jmie")).filter((n) => SEEDED.includes(n)), ["Jamie Placeholder"]);
    assert.deepEqual((await names("riley")).filter((n) => SEEDED.includes(n)), ["Riley Example"]);
  });

  for (const q of ["zzz", "bob", "xavier", "michael", "qwerty"]) {
    test(`unrelated "${q}" matches no seeded profile`, async () => {
      assert.deepEqual((await names(q)).filter((n) => SEEDED.includes(n)), []);
    });
  }

  test("the best match ranks first", async () => {
    const hits = await searchProfilesByNameAs(ctx.manager, "alex sampl");
    assert.equal(hits[0]?.candidateName, "Alex Sample");
    assert.ok(hits[0].score > 0.8);
  });

  test("LIKE wildcards in the query are literal", async () => {
    assert.deepEqual(await searchProfilesByNameAs(ctx.manager, "%"), []);
    assert.deepEqual(await searchProfilesByNameAs(ctx.manager, "_"), []);
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

describe("round trip: getVersion(saveVersion(x)) deep-equals x", () => {
  const flags = [
    { path: "overview", reason: "Check the wording" },
    { path: "projects[0].teamSize", reason: "Label says 2-3" },
  ];

  test("internal profile with every field filled (range team size, empty rating, no managerial items, multi-line text)", async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload({ reviewFlags: flags, promptPlan: ["step one", "step two"] }));
    createdProfiles.push(saved.profileId);
    const loaded = await getVersionAs(ctx.member, saved.versionId);
    assert.ok(loaded, "version must load");
    assert.equal(loaded.template, "internal");
    assert.deepEqual(loaded.data, INTERNAL_FIXTURE);
    assert.deepEqual(loaded.reviewFlags, flags);
    assert.equal(loaded.meta.versionNo, 1);
    assert.equal(loaded.meta.label, "Base");
  });

  test("external profile with every field filled", async () => {
    const saved = await saveVersionAs(ctx.member, {
      template: "external",
      kind: "base",
      label: "Client CV",
      source: "scratch",
      data: EXTERNAL_FIXTURE,
      reviewFlags: [],
      analysis: null,
      promptPlan: [],
    });
    createdProfiles.push(saved.profileId);
    const loaded = await getVersionAs(ctx.member, saved.versionId);
    assert.ok(loaded, "version must load");
    assert.equal(loaded.template, "external");
    assert.deepEqual(loaded.data, EXTERNAL_FIXTURE);
  });

  test("a later version and a role-specific version round-trip too, and older versions stay unchanged", async () => {
    const v1 = await saveVersionAs(ctx.member, internalPayload());
    createdProfiles.push(v1.profileId);
    const edited = { ...INTERNAL_FIXTURE, jobTitle: "Principal Engineer", skills: [{ name: "Go", rating: "3" }] };
    const v2 = await saveVersionAs(ctx.member, internalPayload({ profileId: v1.profileId, data: edited, source: "edit", label: "Edited" }));
    const v3 = await saveVersionAs(
      ctx.member,
      internalPayload({ profileId: v1.profileId, kind: "role_specific", parentVersionId: v2.versionId, label: "Java Backend", source: "edit" }),
    );
    assert.deepEqual([v1.versionNo, v2.versionNo, v3.versionNo], [1, 2, 3]);
    assert.deepEqual((await getVersionAs(ctx.member, v1.versionId))?.data, INTERNAL_FIXTURE);
    assert.deepEqual((await getVersionAs(ctx.member, v2.versionId))?.data, edited);
    const third = await getVersionAs(ctx.member, v3.versionId);
    assert.deepEqual(third?.data, INTERNAL_FIXTURE);
    assert.equal(third?.meta.kind, "role_specific");
    assert.equal(third?.meta.label, "Java Backend");
  });

  test("a role-specific version without a parent is rejected", async () => {
    await assert.rejects(saveVersionAs(ctx.member, internalPayload({ kind: "role_specific", parentVersionId: null })));
  });

  test("a parent from another profile is rejected", async () => {
    const a = await saveVersionAs(ctx.member, internalPayload());
    const b = await saveVersionAs(ctx.member, internalPayload());
    createdProfiles.push(a.profileId, b.profileId);
    await assert.rejects(
      saveVersionAs(ctx.member, internalPayload({ profileId: a.profileId, kind: "role_specific", parentVersionId: b.versionId })),
    );
  });
});

describe("version numbers stay sequential under concurrent saves", () => {
  test("8 simultaneous saves to one profile get versions 1..9 with no gaps or duplicates", async () => {
    const first = await saveVersionAs(ctx.member, internalPayload());
    createdProfiles.push(first.profileId);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => saveVersionAs(ctx.member, internalPayload({ profileId: first.profileId, label: `Concurrent ${i}`, source: "edit" }))),
    );
    const numbers = [first.versionNo, ...results.map((r) => r.versionNo)].sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("a user cannot read another user's profile or version through the app's data layer", () => {
  let memberVersion: string;
  let memberProfile: string;

  before(async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload());
    memberVersion = saved.versionId;
    memberProfile = saved.profileId;
    createdProfiles.push(memberProfile);
  });

  for (const who of ["member2", "admin", "manager", "checker"] as const) {
    test(`${who} gets null for the member's version and profile (My Profiles is strictly your own)`, async () => {
      assert.equal(await getVersionAs(ctx[who], memberVersion), null);
      assert.equal(await getMyProfileAs(ctx[who], memberProfile), null);
    });
  }

  test("the owner can read both", async () => {
    assert.ok(await getVersionAs(ctx.member, memberVersion));
    assert.ok(await getMyProfileAs(ctx.member, memberProfile));
  });
});
