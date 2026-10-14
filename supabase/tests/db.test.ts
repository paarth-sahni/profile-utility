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
  ExternalNotSavedError,
  ForbiddenError,
  ProfileNotFoundError,
  getMyProfileAs,
  getProfileForManagerAs,
  getVersionAs,
  getVersionForManagerAs,
  listMyProfilesAs,
  saveVersionAs,
  searchProfilesByNameAs,
  setPrimaryProfileAs,
  type DbContext,
} from "../../lib/db/profilesCore";
import type { SavePayload } from "../../lib/profilePayload";
import { EXTERNAL_FIXTURE, INTERNAL_FIXTURE, MINIMAL_EXTERNAL_FIXTURE, MINIMAL_INTERNAL_FIXTURE } from "./fixtures";

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
/** The member's primary profile before the run (saving here can set it), restored afterwards. */
let memberPrimaryBefore: string | null = null;

const primaryOf = async (c: DbContext): Promise<string | null> =>
  ((await c.supabase.from("profiles").select("id").eq("owner_id", c.userId).eq("is_primary", true).maybeSingle()).data?.id as string | undefined) ?? null;

before(async () => {
  for (const r of ["member", "member2", "admin", "manager", "checker"] as const) ctx[r] = await contextFor(r);
  memberPrimaryBefore = await primaryOf(ctx.member);
});

after(async () => {
  // Clean up through the admin's session (admin may delete profiles; versions and children cascade).
  if (createdProfiles.length) await ctx.admin.supabase.from("profiles").delete().in("id", createdProfiles);
  if (memberPrimaryBefore && !createdProfiles.includes(memberPrimaryBefore)) await setPrimaryProfileAs(ctx.member, memberPrimaryBefore);
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
  // The search lists ONE row per team member (their primary profile, else their latest), and a name matches when any of
  // their profiles matches, so results are checked by WHO was found. Seeded people: Alex Sample (member), Jamie
  // Placeholder (member2), and Riley Example: the admin's EXTERNAL profile, which is never listed or searchable.
  const ALEX = "member@example.test";
  const JAMIE = "member2@example.test";
  const SEEDED = [ALEX, JAMIE, "admin@example.test"];

  for (const who of ["manager", "admin"] as const) {
    test(`${who} finds a seeded profile by a partial name`, async () => {
      const hits = await searchProfilesByNameAs(ctx[who], "alex samp");
      assert.equal(hits[0]?.ownerEmail, ALEX);
    });

    test(`${who}: an empty query lists every seeded person once`, async () => {
      const hits = await searchProfilesByNameAs(ctx[who], "");
      const owners = hits.map((h) => h.ownerEmail);
      for (const o of [ALEX, JAMIE]) assert.equal(owners.filter((x) => x === o).length, 1, `${o} must be listed exactly once`);
      assert.ok(!hits.some((h) => h.candidateName === "Riley Example"), "an external profile must not be listed");
    });
  }

  test("a similar (misspelled) name still matches (trigram)", async () => {
    const hits = await searchProfilesByNameAs(ctx.manager, "Jamie Placeholdr");
    assert.equal(hits[0]?.ownerEmail, JAMIE);
  });

  // Typos and prefixes (pg_trgm word_similarity + word-prefix match). Only the seeded names are asserted, because
  // real people's profiles may also exist in a developer's local database.
  const names = async (q: string): Promise<string[]> => (await searchProfilesByNameAs(ctx.manager, q)).map((h) => h.ownerEmail);

  for (const q of ["alx", "aelx", "alex sampl", "alex", "Alex Samp", "sam", "lex"]) {
    test(`"${q}" finds Alex Sample and no other seeded person`, async () => {
      const found = (await names(q)).filter((n) => SEEDED.includes(n));
      assert.deepEqual(found, [ALEX]);
    });
  }

  test("a full name does not drag in similar-sounding names (Sample vs Example)", async () => {
    assert.deepEqual((await names("Alex Sample")).filter((n) => SEEDED.includes(n)), [ALEX]);
  });

  test("a short typo of another name finds that person only", async () => {
    assert.deepEqual((await names("jmie")).filter((n) => SEEDED.includes(n)), [JAMIE]);
    assert.deepEqual((await names("riley")).filter((n) => SEEDED.includes(n)), [], "the external Riley Example is not searchable");
  });

  for (const q of ["zzz", "bob", "xavier", "michael", "qwerty"]) {
    test(`unrelated "${q}" matches no seeded profile`, async () => {
      assert.deepEqual((await names(q)).filter((n) => SEEDED.includes(n)), []);
    });
  }

  test("the best match ranks first", async () => {
    const hits = await searchProfilesByNameAs(ctx.manager, "alex sampl");
    assert.equal(hits[0]?.ownerEmail, ALEX);
    assert.ok(hits[0].score > 0.8);
  });

  test("LIKE wildcards in the query are literal", async () => {
    assert.deepEqual(await searchProfilesByNameAs(ctx.manager, "%"), []);
    assert.deepEqual(await searchProfilesByNameAs(ctx.manager, "_"), []);
  });

  test("the manager finds a profile a member just saved", async () => {
    const saved = await saveVersionAs(ctx.member, internalPayload({ data: { ...INTERNAL_FIXTURE, name: "Zebediah Searchable" } }));
    createdProfiles.push(saved.profileId);
    // the person is found; the row shows their primary profile (or their latest one)
    const hits = await searchProfilesByNameAs(ctx.manager, "zebediah");
    assert.equal(hits[0]?.ownerEmail, "member@example.test");
    const shown = await getProfileForManagerAs(ctx.manager, hits[0].id);
    assert.ok(hits[0].id === saved.profileId || shown?.otherProfiles.some((p) => p.id === saved.profileId), "the saved profile is reachable from the person's row");
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
    // the seeded profile itself (the search shows the member's primary / latest profile, which tests may have added)
    const { data } = await ctx.manager.supabase.from("profiles").select("id").eq("candidate_name", "Alex Sample").eq("owner_id", ctx.member.userId).single();
    const alex = data!;
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

  test("an external profile is never saved: the data layer refuses it before anything is written", async () => {
    const external = { template: "external", kind: "base", label: "Client CV", source: "scratch", data: EXTERNAL_FIXTURE, reviewFlags: [], analysis: null, promptPlan: [] };
    await assert.rejects(saveVersionAs(ctx.member, external as unknown as SavePayload), ExternalNotSavedError);
    await assert.rejects(saveVersionAs(ctx.member, { ...external, data: MINIMAL_EXTERNAL_FIXTURE } as unknown as SavePayload), ExternalNotSavedError);
    const { count } = await ctx.member.supabase.from("profiles").select("id", { count: "exact", head: true }).eq("owner_id", ctx.member.userId).eq("template", "external");
    assert.equal(count, 0, "no external profile row may exist");
  });

  test("a minimal profile (required fields only, every optional section empty) round-trips", async () => {
    const internal = await saveVersionAs(ctx.member, internalPayload({ data: MINIMAL_INTERNAL_FIXTURE }));
    createdProfiles.push(internal.profileId);
    assert.deepEqual((await getVersionAs(ctx.member, internal.versionId))?.data, MINIMAL_INTERNAL_FIXTURE);
  });

  test("My Profiles and the manager search list internal profiles only (an old external row stays hidden)", async () => {
    // Simulates a row saved before the rule: written straight through the SQL function, which still supports it.
    const legacy = await ctx.member.supabase.rpc("save_profile_version", {
      p_profile_id: null, p_template: "external", p_kind: "base", p_label: "Legacy", p_parent: null, p_source: "scratch",
      p_profile: { ...MINIMAL_EXTERNAL_FIXTURE, name: "Zed Legacyexternal" }, p_flags: [], p_analysis: null, p_prompt_plan: [],
    });
    assert.ok(!legacy.error, "legacy external row must be creatable for this test");
    const internal = await saveVersionAs(ctx.member, internalPayload({ data: { ...MINIMAL_INTERNAL_FIXTURE, name: "Zed Legacyinternal" } }));
    createdProfiles.push(internal.profileId);
    const mine = await listMyProfilesAs(ctx.member);
    assert.ok(mine.some((p) => p.id === internal.profileId), "the internal profile is listed");
    assert.ok(mine.every((p) => p.template === "internal"), "only internal profiles are listed");
    const found = await searchProfilesByNameAs(ctx.manager, "Zed Legacy");
    assert.ok(found.some((p) => p.ownerEmail === "member@example.test"), "the manager finds the person (one row: their primary or latest profile)");
    assert.ok(found.every((p) => p.template === "internal"), "the manager search never returns an external profile");
    // the display name <Name>-<Role>-InfoBeans needs the current version's job title in every listing
    const title = MINIMAL_INTERNAL_FIXTURE.jobTitle;
    assert.equal(mine.find((p) => p.id === internal.profileId)?.jobTitle, title, "My Profiles list");
    const row = found.find((p) => p.ownerEmail === "member@example.test");
    assert.equal(typeof row?.jobTitle, "string", "manager search rows carry the job title");
    if (row?.id === internal.profileId) assert.equal(row.jobTitle, title, "manager search");
    assert.equal((await getMyProfileAs(ctx.member, internal.profileId))?.profile.jobTitle, title, "own profile page");
    assert.equal((await getProfileForManagerAs(ctx.manager, internal.profileId))?.profile.jobTitle, title, "manager profile page");
    const { data: legacyRows } = await ctx.member.supabase.from("profiles").select("id").eq("candidate_name", "Zed Legacyexternal");
    for (const r of legacyRows ?? []) createdProfiles.push(r.id);
  });

  test("a blank label is replaced by the automatic one: Base, then v2, v3 (numbered per profile)", async () => {
    const v1 = await saveVersionAs(ctx.member, internalPayload({ label: "" }));
    createdProfiles.push(v1.profileId);
    const v2 = await saveVersionAs(ctx.member, internalPayload({ label: "", profileId: v1.profileId, source: "edit" }));
    const v3 = await saveVersionAs(ctx.member, internalPayload({ label: "", profileId: v1.profileId, source: "edit" }));
    const labels = await Promise.all([v1, v2, v3].map(async (v) => (await getVersionAs(ctx.member, v.versionId))?.meta.label));
    assert.deepEqual(labels, ["Base", "v2", "v3"]);
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

describe("primary profile through the data layer", () => {
  test("Submit with makePrimary sets it; a plain save keeps it; listings and the manager search show it", async () => {
    const x = await saveVersionAs(ctx.member, internalPayload({ data: { ...INTERNAL_FIXTURE, name: "Primus Firstsaved" } }));
    const y = await saveVersionAs(ctx.member, internalPayload({ data: { ...INTERNAL_FIXTURE, name: "Primus Secondsaved" }, makePrimary: true }));
    createdProfiles.push(x.profileId, y.profileId);
    assert.equal(y.isPrimary, true);
    assert.equal(await primaryOf(ctx.member), y.profileId);
    // a new version of the other profile does not move the primary
    const x2 = await saveVersionAs(ctx.member, internalPayload({ profileId: x.profileId, source: "edit", data: { ...INTERNAL_FIXTURE, name: "Primus Firstsaved" } }));
    assert.equal(x2.isPrimary, false);
    // a new version of the primary profile keeps it primary
    const y2 = await saveVersionAs(ctx.member, internalPayload({ profileId: y.profileId, source: "edit", data: { ...INTERNAL_FIXTURE, name: "Primus Secondsaved" } }));
    assert.equal(y2.isPrimary, true);
    const mine = await listMyProfilesAs(ctx.member);
    assert.deepEqual(mine.filter((p) => p.isPrimary).map((p) => p.id), [y.profileId], "My Profiles shows exactly one primary");
    // the manager sees this person once, as the primary profile
    const hits = (await searchProfilesByNameAs(ctx.manager, "Primus")).filter((h) => h.ownerEmail === "member@example.test");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, y.profileId);
    assert.equal(hits[0].isPrimary, true);
    // its page lists the person's other profiles, read-only
    const page = await getProfileForManagerAs(ctx.manager, y.profileId);
    assert.equal(page?.profile.isPrimary, true);
    assert.ok(page?.otherProfiles.some((p) => p.id === x.profileId && !p.isPrimary));
    assert.ok(!page?.otherProfiles.some((p) => p.id === y.profileId), "the shown profile is not repeated");
    // switching with setPrimaryProfile
    await setPrimaryProfileAs(ctx.member, x.profileId);
    assert.equal(await primaryOf(ctx.member), x.profileId);
  });

  test("only the owner may set it: someone else's profile is not found", async () => {
    const mine = await saveVersionAs(ctx.member, internalPayload({ data: { ...INTERNAL_FIXTURE, name: "Primus Ownersonly" } }));
    createdProfiles.push(mine.profileId);
    for (const who of ["member2", "manager", "admin"] as const) {
      await assert.rejects(setPrimaryProfileAs(ctx[who], mine.profileId), ProfileNotFoundError, `${who} set member's primary`);
    }
    await assert.rejects(setPrimaryProfileAs(ctx.member, "not-a-uuid"), ProfileNotFoundError);
  });
});

describe("every role saves their OWN profile (checker and manager too), never someone else's", () => {
  for (const who of ["checker", "manager"] as const) {
    test(`${who} creates, submits, sets primary and lists their own profiles; cannot touch member's`, async () => {
      const before = await primaryOf(ctx[who]);
      const a = await saveVersionAs(ctx[who], internalPayload({ data: { ...INTERNAL_FIXTURE, name: `Ownrole ${who} One` } }));
      const b = await saveVersionAs(ctx[who], internalPayload({ data: { ...INTERNAL_FIXTURE, name: `Ownrole ${who} Two` }, makePrimary: true }));
      createdProfiles.push(a.profileId, b.profileId);
      try {
        assert.equal(b.isPrimary, true);
        const a2 = await saveVersionAs(ctx[who], internalPayload({ profileId: a.profileId, source: "edit", data: { ...INTERNAL_FIXTURE, name: `Ownrole ${who} One` } }));
        assert.equal(a2.versionNo, 2);
        await setPrimaryProfileAs(ctx[who], a.profileId);
        assert.equal(await primaryOf(ctx[who]), a.profileId);
        const mine = await listMyProfilesAs(ctx[who]);
        assert.ok([a.profileId, b.profileId].every((id) => mine.some((p) => p.id === id)), "My Profiles lists them");
        assert.ok(mine.every((p) => p.template === "internal"));
        // someone else's profile stays out of reach
        const memberProfile = (await listMyProfilesAs(ctx.member))[0];
        await assert.rejects(saveVersionAs(ctx[who], internalPayload({ profileId: memberProfile.id, source: "edit" })), ProfileNotFoundError);
        await assert.rejects(setPrimaryProfileAs(ctx[who], memberProfile.id), ProfileNotFoundError);
        assert.equal(await getMyProfileAs(ctx[who], memberProfile.id), null);
      } finally {
        if (before) await setPrimaryProfileAs(ctx[who], before);
      }
    });
  }
});

