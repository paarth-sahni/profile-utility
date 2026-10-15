/**
 * Purpose: proves that the DATABASE enforces access per role (TASK-02 step 7). Every check signs in as a
 * seeded fictional user with the publishable (anon) key, exactly like a browser would, and talks straight to
 * the local Supabase API, so only Row Level Security, grants and triggers stand between the caller and the data.
 *
 * Requires the local stack with the seed applied: `npm run db:start && npm run db:reset`.
 * Run: `npm run test:rls` (reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from .env.local).
 * Fictional data only. The service-role key is never used here. Tests clean up what they create.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

const PASSWORD = "password123";
const ROLES = ["member", "member2", "checker", "manager", "admin"] as const;
type RoleName = (typeof ROLES)[number];

/** Tables keyed by version_id, then the ones keyed through a project / experience row. */
const VERSION_TABLES = [
  "version_education",
  "version_projects",
  "version_skills",
  "version_list_items",
  "version_experience",
  "version_review_flags",
] as const;
const PROJECT_TABLES = ["project_technologies", "project_responsibilities"] as const;
const HIGHLIGHT_TABLE = "experience_highlights";
const ALL_TABLES = [
  "app_users",
  "profiles",
  "profile_versions",
  ...VERSION_TABLES,
  ...PROJECT_TABLES,
  HIGHLIGHT_TABLE,
  "checker_reviews",
  "review_items",
  "audit_log",
  "app_settings",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local (see .env.example) and run via npm run test:rls.`);
  }
  return value;
}

function newClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signedIn(role: RoleName): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: `${role}@example.test`, password: PASSWORD });
  if (error) throw new Error(`Sign-in as ${role} failed: ${error.message}. Did you run npm run db:reset?`);
  return client;
}

const rows = (res: Result): Row[] => (Array.isArray(res.data) ? (res.data as Row[]) : []);
/** A request that returned an error or touched no row counts as "nothing happened". */
const nothingHappened = (res: Result): boolean => res.error !== null || rows(res).length === 0;
const ids = (list: Row[], key: string): string[] => list.map((r) => String(r[key]));

const roleOf = new Map<RoleName, SupabaseClient>();
const anon = newClient();
let userId: Record<RoleName, string>;
/** Seeded fixtures, read through the admin's own session (admin may read everything). */
let profileA: string; // internal, owned by member
let profileB: string; // external, owned by admin
let profileC: string; // internal, owned by member2
let versionsA: string[];
let versionsB: string[];
let versionsC: string[];

const db = (r: RoleName): SupabaseClient => {
  const client = roleOf.get(r);
  if (!client) throw new Error(`no session for ${r}`);
  return client;
};

before(async () => {
  for (const r of ROLES) roleOf.set(r, await signedIn(r));

  const users = rows(await db("admin").from("app_users").select("id,email"));
  userId = Object.fromEntries(
    ROLES.map((r) => [r, String(users.find((u) => u.email === `${r}@example.test`)?.id)]),
  ) as Record<RoleName, string>;

  const profiles = rows(await db("admin").from("profiles").select("id,owner_id,candidate_name"));
  profileA = String(profiles.find((p) => p.owner_id === userId.member)?.id);
  profileB = String(profiles.find((p) => p.owner_id === userId.admin)?.id);
  profileC = String(profiles.find((p) => p.owner_id === userId.member2)?.id);
  assert.ok(
    profileA !== "undefined" && profileB !== "undefined" && profileC !== "undefined",
    "seed profiles missing: run npm run db:reset",
  );

  const versions = rows(await db("admin").from("profile_versions").select("id,profile_id"));
  versionsA = ids(versions.filter((v) => v.profile_id === profileA), "id");
  versionsB = ids(versions.filter((v) => v.profile_id === profileB), "id");
  versionsC = ids(versions.filter((v) => v.profile_id === profileC), "id");
  assert.equal(versionsA.length, 2);
  assert.equal(versionsB.length, 2);
  assert.equal(versionsC.length, 1);
});

after(async () => {
  for (const client of roleOf.values()) await client.auth.signOut();
});

describe("app_users: each role gets exactly its rows", () => {
  const expected: Record<RoleName, number> = { member: 1, member2: 1, checker: 1, manager: 5, admin: 5 };
  for (const r of ROLES) {
    test(`${r} sees ${expected[r]} row(s)`, async () => {
      const res = await db(r).from("app_users").select("id,email,role");
      assert.equal(res.error, null);
      // Count only the seeded @example.test users: real people who signed in with Google on this laptop
      // also have app_users rows, and must not change the result.
      const seeded = rows(res).filter((u) => String(u.email).endsWith("@example.test"));
      assert.equal(seeded.length, expected[r]);
      if (r === "member" || r === "member2" || r === "checker") {
        // These roles may read only themselves, so the TOTAL (not just the seeded count) must be 1.
        assert.equal(rows(res).length, 1);
        assert.equal(rows(res)[0]?.id, userId[r]);
      }
    });
  }
});

describe("profiles: each role gets exactly its rows", () => {
  const expected: Record<RoleName, string[]> = {
    member: ["A"], member2: ["C"], checker: ["A", "B", "C"], manager: ["A", "B", "C"], admin: ["A", "B", "C"],
  };
  const idOf = (k: string): string => (k === "A" ? profileA : k === "B" ? profileB : profileC);
  for (const r of ROLES) {
    test(`${r} sees profiles ${expected[r].join("+")}`, async () => {
      const res = await db(r).from("profiles").select("id");
      assert.equal(res.error, null);
      const want = expected[r].map(idOf).sort();
      // Roles that read everything also see profiles that real people saved on this laptop, so compare only
      // the seeded ones. Members must match exactly: any extra row would be a leak.
      const all = ids(rows(res), "id");
      const seen = r === "member" || r === "member2" ? all : all.filter((id) => [profileA, profileB, profileC].includes(id));
      assert.deepEqual(seen.sort(), want);
    });
  }

  // Member-vs-member (A vs C, both directions) and member-vs-admin (B): nothing readable by guessing ids.
  const foreignTo: Array<{ who: "member" | "member2"; label: string; profile: () => string; versions: () => string[] }> = [
    { who: "member", label: "member2's profile", profile: () => profileC, versions: () => versionsC },
    { who: "member", label: "the admin's profile", profile: () => profileB, versions: () => versionsB },
    { who: "member2", label: "member's profile", profile: () => profileA, versions: () => versionsA },
    { who: "member2", label: "the admin's profile", profile: () => profileB, versions: () => versionsB },
  ];
  for (const f of foreignTo) {
    test(`${f.who} cannot read ${f.label}, its versions or rebuild them, by guessing ids`, async () => {
      const m = db(f.who);
      assert.ok(nothingHappened(await m.from("profiles").select("*").eq("id", f.profile())));
      assert.ok(nothingHappened(await m.from("profile_versions").select("*").eq("profile_id", f.profile())));
      for (const v of f.versions()) {
        assert.ok(nothingHappened(await m.from("profile_versions").select("*").eq("id", v)));
        const rebuilt = await m.rpc("get_profile_version", { p_version_id: v });
        assert.equal(rebuilt.data, null, "get_profile_version must return nothing for someone else's version");
      }
    });
  }

  test("each member can rebuild their own version", async () => {
    const cases = [["member", versionsA[0], "Alex Sample"], ["member2", versionsC[0], "Jamie Placeholder"]] as const;
    for (const [who, version, name] of cases) {
      const rebuilt = await db(who).rpc("get_profile_version", { p_version_id: version });
      assert.equal(rebuilt.error, null);
      assert.equal((rebuilt.data as { data: { name: string } }).data.name, name);
    }
  });
});

describe("anon reads and writes nothing", () => {
  for (const table of ALL_TABLES) {
    test(`anon cannot read or write ${table}`, async () => {
      assert.ok(nothingHappened(await anon.from(table).select("*")));
      assert.ok(nothingHappened(await anon.from(table).insert({}).select()));
      assert.ok(nothingHappened(await anon.from(table).delete().neq("created_at", "1970-01-01").select()));
    });
  }

  test("anon cannot call the save or rebuild functions", async () => {
    assert.notEqual((await anon.rpc("get_profile_version", { p_version_id: versionsA[0] })).error, null);
    const save = await anon.rpc("save_profile_version", {
      p_profile_id: null, p_template: "internal", p_kind: "base", p_label: "x", p_parent: null,
      p_source: "scratch", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
    });
    assert.notEqual(save.error, null);
  });
});

/** A fully filled fictional profile of each template, so every child table gets rows. */
const FULL_INTERNAL = {
  name: "Scratch Internal", jobTitle: "Engineer", experienceSummary: "3+ Years", specialization: "Testing", overview: "x",
  education: [{ year: "2020", qualification: "B.E., Riverside University" }],
  projects: [{ duration: "2021 - 2022", title: "Scratch Project", toolsAndTechnologies: ["Go", "Redis"], teamSize: "2-3", role: "Dev",
    projectLink: "", description: "d", responsibilities: ["Built it", "Tested it"] }],
  skills: [{ name: "Go", rating: "4" }], certifications: ["Cert"], tools: ["Git"], managerialExperience: ["Led"],
  domains: ["Retail"], languages: ["English"],
};
const FULL_EXTERNAL = {
  name: "Scratch External", jobTitle: "Engineer", experienceSummary: "3+ Years", specialization: "Testing", overview: "x",
  education: [{ year: "2020", qualification: "B.E., Riverside University" }],
  skills: ["Go"], tools: ["Git"], certifications: ["Cert"],
  projects: [{ duration: "2021 - 2022", client: "Northwind", teamSize: "2", role: "Dev", description: "d", responsibilities: ["Built it"] }],
  experience: [{ company: "Contoso", position: "Dev", duration: "2020 - 2022", highlights: ["Shipped"] }],
};

async function saveAs(r: RoleName, template: "internal" | "external", profile: object): Promise<string> {
  const res = await db(r).rpc("save_profile_version", {
    p_profile_id: null, p_template: template, p_kind: "base", p_label: "Base", p_parent: null, p_source: "scratch",
    p_profile: profile, p_flags: [{ path: "name", reason: "check" }], p_analysis: null, p_prompt_plan: null,
  });
  assert.equal(res.error, null, `fixture save as ${r} failed: ${res.error?.message}`);
  const vid = String((res.data as Row[])[0].new_version_id);
  return String(rows(await db(r).from("profile_versions").select("profile_id").eq("id", vid))[0].profile_id);
}

describe("child tables follow their version's access", () => {
  const MEMBERS = ["member", "member2"] as const;
  type Member = (typeof MEMBERS)[number];
  const scratchProfiles: string[] = [];
  /** Version / project / experience keys each member is entitled to (their own profiles), via the admin session. */
  const own: Record<Member, { versions: string[]; projects: string[]; experience: string[] }> = {
    member: { versions: [], projects: [], experience: [] },
    member2: { versions: [], projects: [], experience: [] },
  };

  before(async () => {
    // Own AND foreign rows in EVERY child table, for both members: A (member, internal) and C (member2, internal)
    // cover the internal tables, an external scratch profile per member covers the external ones, and the admin's
    // B (external) plus an internal scratch profile are foreign to both.
    scratchProfiles.push(await saveAs("admin", "internal", FULL_INTERNAL));
    scratchProfiles.push(await saveAs("member", "external", FULL_EXTERNAL));
    scratchProfiles.push(await saveAs("member2", "external", FULL_EXTERNAL));
    const admin = db("admin");
    for (const m of MEMBERS) {
      const mine = ids(rows(await admin.from("profiles").select("id").eq("owner_id", userId[m])), "id");
      own[m].versions = ids(rows(await admin.from("profile_versions").select("id").in("profile_id", mine)), "id");
      own[m].projects = ids(rows(await admin.from("version_projects").select("id").in("version_id", own[m].versions)), "id");
      own[m].experience = ids(rows(await admin.from("version_experience").select("id").in("version_id", own[m].versions)), "id");
    }
  });
  after(async () => {
    for (const id of scratchProfiles) await db("admin").from("profiles").delete().eq("id", id);
  });

  for (const m of MEMBERS) {
    const other: Member = m === "member" ? "member2" : "member";

    for (const table of VERSION_TABLES) {
      test(`${table}: ${m} sees exactly their own versions' rows, none of ${other}'s; checker and manager see all`, async () => {
        const all = rows(await db("admin").from(table).select("version_id"));
        const mineExpected = all.filter((r) => own[m].versions.includes(String(r.version_id)));
        const othersRows = all.filter((r) => own[other].versions.includes(String(r.version_id)));
        const foreign = all.filter((r) => !own[m].versions.includes(String(r.version_id)));
        assert.ok(mineExpected.length > 0 && othersRows.length > 0 && foreign.length > 0, `fixtures must put own, ${other}'s and foreign rows in ${table}`);
        const seen = rows(await db(m).from(table).select("version_id"));
        assert.deepEqual(ids(seen, "version_id").sort(), ids(mineExpected, "version_id").sort());
        assert.ok(seen.every((r) => !own[other].versions.includes(String(r.version_id))), `${m} read ${other}'s rows in ${table}`);
        for (const r of ["checker", "manager"] as const) {
          assert.equal(rows(await db(r).from(table).select("version_id")).length, all.length);
        }
      });
    }

    for (const table of PROJECT_TABLES) {
      test(`${table}: ${m} sees exactly their own projects' rows, none of ${other}'s`, async () => {
        const all = rows(await db("admin").from(table).select("project_id"));
        const mineExpected = all.filter((r) => own[m].projects.includes(String(r.project_id)));
        const othersRows = all.filter((r) => own[other].projects.includes(String(r.project_id)));
        assert.ok(mineExpected.length > 0 && othersRows.length > 0, `fixtures must put own and ${other}'s rows in ${table}`);
        const seen = rows(await db(m).from(table).select("project_id"));
        assert.deepEqual(ids(seen, "project_id").sort(), ids(mineExpected, "project_id").sort());
        assert.ok(seen.every((r) => !own[other].projects.includes(String(r.project_id))), `${m} read ${other}'s rows in ${table}`);
        assert.equal(rows(await db("manager").from(table).select("project_id")).length, all.length);
      });
    }

    test(`${HIGHLIGHT_TABLE}: ${m} sees exactly their own experience rows' highlights, none of ${other}'s`, async () => {
      const all = rows(await db("admin").from(HIGHLIGHT_TABLE).select("experience_id"));
      const mineExpected = all.filter((r) => own[m].experience.includes(String(r.experience_id)));
      const othersRows = all.filter((r) => own[other].experience.includes(String(r.experience_id)));
      assert.ok(mineExpected.length > 0 && othersRows.length > 0, `fixtures must put own and ${other}'s rows in the highlights table`);
      const seen = rows(await db(m).from(HIGHLIGHT_TABLE).select("experience_id"));
      assert.deepEqual(ids(seen, "experience_id").sort(), ids(mineExpected, "experience_id").sort());
      assert.equal(rows(await db("checker").from(HIGHLIGHT_TABLE).select("experience_id")).length, all.length);
    });
  }

  test("a member cannot add rows to a saved version, even their own (versions are immutable)", async () => {
    const res = await db("member")
      .from("version_skills")
      .insert({ version_id: versionsA[0], position: 99, name: "Injected", rating: "5" })
      .select();
    assert.ok(nothingHappened(res), "a later request must not append to an existing version");
  });

  test("a member cannot add rows to someone else's version (another member's or the admin's)", async () => {
    const cases = [["member", versionsC[0]], ["member", versionsB[0]], ["member2", versionsA[0]], ["member2", versionsB[0]]] as const;
    for (const [who, version] of cases) {
      const res = await db(who).from("version_skills").insert({ version_id: version, position: 99, name: "Injected", rating: "5" }).select();
      assert.ok(nothingHappened(res), `${who} injected a row into ${version}`);
    }
  });

  test("checker and manager cannot insert child rows at all", async () => {
    for (const r of ["checker", "manager"] as const) {
      const res = await db(r).from("version_skills").insert({ version_id: versionsA[0], position: 98, name: "x" }).select();
      assert.ok(nothingHappened(res), `${r} inserted a child row`);
    }
  });
});

describe("nobody can UPDATE or DELETE a version or its rows", () => {
  for (const r of ROLES) {
    test(`${r} cannot update or delete a version`, async () => {
      for (const v of [versionsA[0], versionsB[0], versionsC[0]]) {
        assert.ok(nothingHappened(await db(r).from("profile_versions").update({ label: "Tampered" }).eq("id", v).select()));
      }
      const check = rows(await db("admin").from("profile_versions").select("id,label").in("id", [...versionsA, ...versionsB, ...versionsC]));
      assert.ok(check.every((v) => v.label !== "Tampered"));
      if (r !== "admin") {
        assert.ok(nothingHappened(await db(r).from("profile_versions").delete().eq("id", versionsA[0]).select()));
      }
    });

    test(`${r} cannot update a child row`, async () => {
      const res = await db(r).from("version_skills").update({ name: "Tampered" }).eq("version_id", versionsA[0]).select();
      assert.ok(nothingHappened(res));
      const check = rows(await db("admin").from("version_skills").select("name").eq("version_id", versionsA[0]));
      assert.ok(check.every((s) => s.name !== "Tampered"));
    });
  }

  test("only admin may delete a version (the profile's versions are restored by the re-seed, so test on a scratch one)", async () => {
    const saved = await db("member").rpc("save_profile_version", {
      p_profile_id: null, p_template: "internal", p_kind: "base", p_label: "scratch", p_parent: null,
      p_source: "scratch", p_profile: { name: "Scratch Person" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
    });
    assert.equal(saved.error, null);
    const vid = String((saved.data as Row[])[0].new_version_id);
    assert.ok(nothingHappened(await db("member").from("profile_versions").delete().eq("id", vid).select()));
    assert.ok(nothingHappened(await db("manager").from("profile_versions").delete().eq("id", vid).select()));
    const gone = await db("admin").from("profile_versions").delete().eq("id", vid).select();
    assert.equal(gone.error, null);
    assert.equal(rows(gone).length, 1);
    // remove the now empty scratch profile
    const owner = rows(await db("admin").from("profiles").select("id").eq("candidate_name", "Scratch Person"));
    for (const p of owner) await db("admin").from("profiles").delete().eq("id", p.id);
  });
});

describe("roles cannot be changed by the person they belong to", () => {
  test("a member cannot change their own or another member's role", async () => {
    for (const [who, target] of [["member", "member"], ["member2", "member2"], ["member", "member2"], ["member2", "member"]] as const) {
      for (const role of ["admin", "manager", "checker"]) {
        assert.ok(nothingHappened(await db(who).from("app_users").update({ role }).eq("id", userId[target]).select()), `${who} changed ${target} to ${role}`);
      }
    }
    for (const m of ["member", "member2"] as const) {
      const fresh = rows(await db("admin").from("app_users").select("role").eq("id", userId[m]));
      assert.equal(fresh[0]?.role, "team_member");
    }
  });

  test("a manager and a checker cannot change anyone's role", async () => {
    for (const r of ["manager", "checker"] as const) {
      assert.ok(nothingHappened(await db(r).from("app_users").update({ role: "admin" }).eq("id", userId.member).select()));
    }
  });

  test("a member cannot change another column of app_users (email, id)", async () => {
    assert.ok(nothingHappened(await db("member").from("app_users").update({ email: "x@example.test" }).eq("id", userId.member).select()));
  });

  test("an admin cannot change their own role, but can change someone else's", async () => {
    const own = await db("admin").from("app_users").update({ role: "manager" }).eq("id", userId.admin).select();
    assert.ok(nothingHappened(own));
    assert.equal(rows(await db("admin").from("app_users").select("role").eq("id", userId.admin))[0]?.role, "admin");

    const other = await db("admin").from("app_users").update({ role: "checker" }).eq("id", userId.member).select();
    try {
      assert.equal(other.error, null);
      assert.equal(rows(other)[0]?.role, "checker");
    } finally {
      await db("admin").from("app_users").update({ role: "team_member" }).eq("id", userId.member);
    }
    assert.equal(rows(await db("admin").from("app_users").select("role").eq("id", userId.member))[0]?.role, "team_member");
  });

  test("an admin cannot change columns other than role", async () => {
    assert.ok(nothingHappened(await db("admin").from("app_users").update({ full_name: "Renamed" }).eq("id", userId.member).select()));
  });
});

describe("profiles: who may create and change them", () => {
  test("every role can create a profile they own (team member, checker, manager, admin)", async () => {
    for (const r of ["member", "checker", "manager", "admin"] as const) {
      const res = await db(r).from("profiles").insert({ owner_id: userId[r], template: "internal", candidate_name: "Own Scratch" }).select();
      try {
        assert.equal(res.error, null, `${r} could not create their own profile`);
        assert.equal(rows(res).length, 1);
      } finally {
        for (const p of rows(res)) await db("admin").from("profiles").delete().eq("id", String(p.id));
      }
    }
  });

  test("checker and manager cannot create, update or delete a profile owned by someone else", async () => {
    for (const r of ["checker", "manager"] as const) {
      assert.ok(nothingHappened(await db(r).from("profiles").insert({ owner_id: userId.member, template: "internal" }).select()), `${r} created a profile for member`);
      for (const target of [profileA, profileB, profileC]) {
        assert.ok(nothingHappened(await db(r).from("profiles").update({ candidate_name: "Tampered" }).eq("id", target).select()), `${r} updated ${target}`);
        assert.ok(nothingHappened(await db(r).from("profiles").delete().eq("id", target).select()), `${r} deleted ${target}`);
      }
    }
    const names = rows(await db("admin").from("profiles").select("candidate_name"));
    assert.ok(names.every((n) => n.candidate_name !== "Tampered"));
  });

  test("a member cannot create a profile owned by someone else", async () => {
    for (const owner of [userId.admin, userId.member2]) {
      const res = await db("member").from("profiles").insert({ owner_id: owner, template: "internal" }).select();
      assert.ok(nothingHappened(res));
    }
  });

  test("a member cannot update or delete someone else's profile (another member's or the admin's)", async () => {
    const cases = [["member", profileC], ["member", profileB], ["member2", profileA], ["member2", profileB]] as const;
    for (const [who, target] of cases) {
      assert.ok(nothingHappened(await db(who).from("profiles").update({ candidate_name: "Tampered" }).eq("id", target).select()), `${who} updated ${target}`);
      assert.ok(nothingHappened(await db(who).from("profiles").delete().eq("id", target).select()), `${who} deleted ${target}`);
    }
    const names = rows(await db("admin").from("profiles").select("candidate_name"));
    assert.ok(names.every((n) => n.candidate_name !== "Tampered"));
  });

  test("a member cannot reassign their profile, nor point it at another profile's version", async () => {
    assert.ok(nothingHappened(await db("member").from("profiles").update({ owner_id: userId.admin }).eq("id", profileA).select()));
    assert.ok(nothingHappened(await db("member").from("profiles").update({ template: "external" }).eq("id", profileA).select()));
    for (const v of [versionsB[0], versionsC[0]]) {
      const hijack = await db("member").from("profiles").update({ current_version_id: v }).eq("id", profileA).select();
      assert.ok(nothingHappened(hijack));
    }
    assert.ok(nothingHappened(await db("member").from("profiles").update({ owner_id: userId.member2 }).eq("id", profileA).select()));
  });

  test("a member can archive and restore their own profile", async () => {
    const on = await db("member").from("profiles").update({ archived: true }).eq("id", profileA).select();
    try {
      assert.equal(on.error, null);
      assert.equal(rows(on).length, 1);
    } finally {
      await db("member").from("profiles").update({ archived: false }).eq("id", profileA);
    }
  });
});

describe("save_profile_version runs as the caller", () => {
  test("a member saves two versions; numbers are sequential; admin cleans up", async () => {
    const profile = { name: "Scratch Person", jobTitle: "Tester", experienceSummary: "1+ Years", specialization: "Testing", overview: "x" };
    const first = await db("member").rpc("save_profile_version", {
      p_profile_id: null, p_template: "internal", p_kind: "base", p_label: "Base", p_parent: null,
      p_source: "scratch", p_profile: profile, p_flags: [], p_analysis: null, p_prompt_plan: null,
    });
    assert.equal(first.error, null);
    const v1 = (first.data as Row[])[0];
    assert.equal(v1.new_version_no, 1);
    const pid = String(rows(await db("member").from("profile_versions").select("profile_id").eq("id", v1.new_version_id as string))[0].profile_id);
    try {
      const second = await db("member").rpc("save_profile_version", {
        p_profile_id: pid, p_template: "internal", p_kind: "role_specific", p_label: "Java", p_parent: v1.new_version_id,
        p_source: "edit", p_profile: { ...profile, overview: "y" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
      });
      assert.equal(second.error, null);
      assert.equal((second.data as Row[])[0].new_version_no, 2);
      // another member's profile cannot be saved onto, nor by a manager or a checker
      for (const [target, template] of [[profileB, "external"], [profileC, "internal"]] as const) {
        const intoOther = await db("member").rpc("save_profile_version", {
          p_profile_id: target, p_template: template, p_kind: "base", p_label: "x", p_parent: null,
          p_source: "edit", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
        });
        assert.notEqual(intoOther.error, null, "a member must not save onto someone else's profile");
      }
      const intoA = await db("member2").rpc("save_profile_version", {
        p_profile_id: profileA, p_template: "internal", p_kind: "base", p_label: "x", p_parent: null,
        p_source: "edit", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
      });
      assert.notEqual(intoA.error, null, "member2 must not save onto member's profile");
      for (const r of ["manager", "checker"] as const) {
        const denied = await db(r).rpc("save_profile_version", {
          p_profile_id: pid, p_template: "internal", p_kind: "base", p_label: "x", p_parent: null,
          p_source: "edit", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
        });
        assert.notEqual(denied.error, null, `${r} must not be able to save onto member's profile`);
      }
    } finally {
      await db("admin").from("profiles").delete().eq("id", pid);
    }
  });
});

describe("primary profile: only the owner can set it", () => {
  const primaryOf = async (owner: RoleName): Promise<string | null> =>
    (rows(await db("admin").from("profiles").select("id").eq("owner_id", userId[owner]).eq("is_primary", true))[0]?.id as string) ?? null;
  const scratch = { name: "Primary Scratch", jobTitle: "Tester", experienceSummary: "1+ Years", specialization: "", overview: "x" };
  const submit = (r: RoleName, profileId: string | null, makePrimary: boolean) =>
    db(r).rpc("submit_profile_version", {
      p_profile_id: profileId, p_template: "internal", p_kind: "base", p_label: "", p_parent: null, p_source: profileId ? "edit" : "scratch",
      p_profile: scratch, p_flags: [], p_analysis: null, p_prompt_plan: null, p_make_primary: makePrimary,
    });

  test("nobody writes is_primary directly: not the owner, not an admin (insert or update)", async () => {
    const before = await primaryOf("member");
    for (const r of ["member", "admin"] as const) {
      const res = await db(r).from("profiles").update({ is_primary: true }).eq("id", profileA).select();
      assert.ok(nothingHappened(res), `${r} updated is_primary directly`);
    }
    const ins = await db("member").from("profiles").insert({ owner_id: userId.member, template: "internal", candidate_name: "x", is_primary: true }).select();
    assert.notEqual(ins.error, null, "a profile cannot be inserted as primary");
    assert.equal(await primaryOf("member"), before);
  });

  test("nobody else can make someone's profile primary through the function (member2, checker, manager, admin)", async () => {
    const before = await primaryOf("member");
    for (const r of ["member2", "checker", "manager", "admin"] as const) {
      const res = await db(r).rpc("set_primary_profile", { p_profile_id: profileA });
      assert.notEqual(res.error, null, `${r} set member's primary`);
    }
    assert.equal(await primaryOf("member"), before);
  });

  test("the owner switches atomically; Submit with the box saves and switches; a new version keeps the primary", async () => {
    const before = await primaryOf("member");
    const created: string[] = [];
    try {
      const x = rows(await submit("member", null, false))[0];
      const y = rows(await submit("member", null, true))[0];
      created.push(String(x.profile_id), String(y.profile_id));
      assert.equal(y.is_primary, true, "Submit with the box makes the profile primary");
      assert.equal(await primaryOf("member"), y.profile_id);
      assert.equal((await db("member").rpc("set_primary_profile", { p_profile_id: x.profile_id })).error, null, "the owner may switch");
      const mine = rows(await db("member").from("profiles").select("id,is_primary").eq("is_primary", true));
      assert.deepEqual(mine.map((p) => p.id), [x.profile_id], "exactly one primary after the switch");
      const v2 = rows(await submit("member", String(y.profile_id), false))[0];
      assert.equal(v2.is_primary, false, "a new version of another profile does not take the primary");
      assert.equal(await primaryOf("member"), x.profile_id);
      // someone else's profile cannot become the caller's primary either
      assert.notEqual((await db("member").rpc("set_primary_profile", { p_profile_id: profileC })).error, null);
    } finally {
      for (const id of created) await db("admin").from("profiles").delete().eq("id", id);
      if (before) await db("member").rpc("set_primary_profile", { p_profile_id: before });
    }
  });
});

describe("checker and manager: create, submit and set primary on their OWN profile; never on someone else's", () => {
  const doc = { name: "Own Role Profile", jobTitle: "Lead", experienceSummary: "5+ Years", specialization: "", overview: "x" };
  const submit = (r: RoleName, profileId: string | null, makePrimary: boolean) =>
    db(r).rpc("submit_profile_version", {
      p_profile_id: profileId, p_template: "internal", p_kind: "base", p_label: "", p_parent: null, p_source: profileId ? "edit" : "scratch",
      p_profile: doc, p_flags: [], p_analysis: null, p_prompt_plan: null, p_make_primary: makePrimary,
    });

  for (const r of ["checker", "manager"] as const) {
    test(`${r}: own profile works end to end, someone else's is refused`, async () => {
      const before = rows(await db(r).from("profiles").select("id").eq("owner_id", userId[r]).eq("is_primary", true))[0]?.id ?? null;
      const created: string[] = [];
      try {
        // create + submit (first profile becomes primary when there is none yet)
        const first = await submit(r, null, false);
        assert.equal(first.error, null, `${r} could not submit a new profile`);
        const a = rows(first)[0];
        created.push(String(a.profile_id));
        assert.equal(rows(await db("admin").from("profiles").select("owner_id").eq("id", String(a.profile_id)))[0]?.owner_id, userId[r], "owned by the caller");
        if (!before) assert.equal(a.is_primary, true, "the first profile becomes primary");
        // a second profile with "Mark as primary": saves and switches
        const second = await submit(r, null, true);
        assert.equal(second.error, null);
        const b = rows(second)[0];
        created.push(String(b.profile_id));
        assert.equal(b.is_primary, true);
        // set primary back to the first, and save a new version of it
        assert.equal((await db(r).rpc("set_primary_profile", { p_profile_id: a.profile_id })).error, null, `${r} could not set primary`);
        const v2 = await submit(r, String(a.profile_id), false);
        assert.equal(v2.error, null);
        assert.equal(rows(v2)[0].new_version_no, 2);
        assert.equal(rows(v2)[0].is_primary, true);
        // archive and restore their own profile
        assert.equal(rows(await db(r).from("profiles").update({ archived: false }).eq("id", String(b.profile_id)).select()).length, 1);

        // someone else's profile: no save, no new version row, no update, no primary
        for (const target of [profileA, profileC]) {
          assert.notEqual((await submit(r, target, false)).error, null, `${r} saved onto ${target}`);
          assert.ok(nothingHappened(await db(r).from("profile_versions").insert({ profile_id: target, version_no: 99, kind: "base", source: "edit", created_by: userId[r] }).select()), `${r} added a version to ${target}`);
          assert.ok(nothingHappened(await db(r).from("profiles").update({ candidate_name: "Tampered" }).eq("id", target).select()), `${r} updated ${target}`);
          assert.notEqual((await db(r).rpc("set_primary_profile", { p_profile_id: target })).error, null, `${r} set primary on ${target}`);
        }
        assert.equal(rows(await db("admin").from("profile_versions").select("id").eq("version_no", 99)).length, 0);
        // and they still read everyone's profiles (read-only)
        assert.ok(rows(await db(r).from("profiles").select("id").eq("id", profileA)).length === 1, `${r} can still read member's profile`);
      } finally {
        for (const id of created) await db("admin").from("profiles").delete().eq("id", id);
        if (before) await db(r).rpc("set_primary_profile", { p_profile_id: before });
      }
    });
  }
});

describe("audit_log", () => {
  test("members and checkers read nothing; manager and admin read; nobody can change or delete a row", async () => {
    // make sure at least one row exists (the seed and the tests above already wrote some)
    for (const r of ["member", "member2", "checker"] as const) assert.ok(nothingHappened(await db(r).from("audit_log").select("*")), `${r} read audit_log`);
    for (const r of ["manager", "admin"] as const) assert.ok(rows(await db(r).from("audit_log").select("id")).length > 0, `${r} cannot read audit_log`);
    for (const r of ROLES) {
      assert.ok(nothingHappened(await db(r).from("audit_log").update({ action: "tampered" }).gte("id", 0).select()));
      assert.ok(nothingHappened(await db(r).from("audit_log").delete().gte("id", 0).select()));
    }
  });

  test("a user can only append an audit row naming themselves", async () => {
    const forged = await db("member").from("audit_log").insert({ actor_id: userId.admin, action: "forged", entity: "x" }).select();
    assert.ok(nothingHappened(forged));
  });
});

describe("checker reviews", () => {
  let reviewOnA: string; // by the checker, on member's profile
  let reviewOnB: string; // by the checker, on the admin's profile
  let reviewOnC: string; // by the checker, on member2's profile
  let otherReview: string; // owned by the manager's id (made by admin): a checker's OWN-vs-OTHERS probe
  let otherItem: string;

  const add = async (r: RoleName, version: string, checkerId: string): Promise<string> => {
    const res = await db(r).from("checker_reviews").insert({ version_id: version, checker_id: checkerId }).select();
    assert.equal(res.error, null, `fixture review failed: ${res.error?.message}`);
    return String(rows(res)[0].id);
  };
  const addItem = async (r: RoleName, review: string, path: string): Promise<string> => {
    const res = await db(r).from("review_items").insert({ review_id: review, path, reason: "check" }).select();
    assert.equal(res.error, null, `fixture item failed: ${res.error?.message}`);
    return String(rows(res)[0].id);
  };

  before(async () => {
    reviewOnA = await add("checker", versionsA[0], userId.checker);
    reviewOnB = await add("checker", versionsB[0], userId.checker);
    reviewOnC = await add("checker", versionsC[0], userId.checker);
    await addItem("checker", reviewOnA, "skills.0");
    await addItem("checker", reviewOnB, "name");
    await addItem("checker", reviewOnC, "skills.1");
    // Only one checker is seeded, so the admin (all rights) makes a review that belongs to someone else.
    otherReview = await add("admin", versionsB[1], userId.manager);
    otherItem = await addItem("admin", otherReview, "overview");
  });
  after(async () => {
    for (const id of [reviewOnA, reviewOnB, reviewOnC, otherReview]) {
      await db("admin").from("checker_reviews").delete().eq("id", id); // cascades to items
    }
  });

  test("a checker cannot create a review under someone else's name; members and managers cannot create reviews", async () => {
    const forged = await db("checker").from("checker_reviews").insert({ version_id: versionsA[0], checker_id: userId.admin }).select();
    assert.ok(nothingHappened(forged));
    for (const r of ["member", "member2", "manager"] as const) {
      const res = await db(r).from("checker_reviews").insert({ version_id: versionsA[0], checker_id: userId[r] }).select();
      assert.ok(nothingHappened(res), `${r} created a review`);
    }
    const forgedItem = await db("checker").from("review_items").insert({ review_id: otherReview, path: "x", reason: "x" }).select();
    assert.ok(nothingHappened(forgedItem), "a checker added an item to someone else's review");
  });

  test("each member reads reviews and items on their own profile only (member-vs-member)", async () => {
    for (const [who, mine, theirs] of [["member", reviewOnA, reviewOnC], ["member2", reviewOnC, reviewOnA]] as const) {
      const reviews = ids(rows(await db(who).from("checker_reviews").select("id")), "id");
      assert.deepEqual(reviews, [mine], `${who} must see only their own review`);
      assert.ok(!reviews.includes(theirs));
      const items = rows(await db(who).from("review_items").select("review_id"));
      assert.ok(items.length > 0 && items.every((i) => i.review_id === mine), `${who} saw items of another profile`);
    }
  });

  test("a checker reads ALL reviews and items, including other people's; manager and admin read all too", async () => {
    const everyReview = [reviewOnA, reviewOnB, reviewOnC, otherReview];
    for (const r of ["checker", "manager", "admin"] as const) {
      const seen = ids(rows(await db(r).from("checker_reviews").select("id")), "id");
      for (const id of everyReview) assert.ok(seen.includes(id), `${r} cannot read review ${id}`);
      const items = ids(rows(await db(r).from("review_items").select("id")), "id");
      assert.ok(items.includes(otherItem), `${r} cannot read someone else's review item`);
    }
    const adminCount = rows(await db("admin").from("checker_reviews").select("id")).length;
    assert.equal(rows(await db("checker").from("checker_reviews").select("id")).length, adminCount);
  });

  test("a checker can update their own review and items", async () => {
    assert.equal((await db("checker").from("checker_reviews").update({ status: "approved" }).eq("id", reviewOnA).select()).error, null);
    const item = await db("checker").from("review_items").update({ resolved: true }).eq("review_id", reviewOnA).select();
    assert.equal(item.error, null);
    assert.ok(rows(item).length > 0);
    assert.equal(rows(await db("admin").from("checker_reviews").select("status").eq("id", reviewOnA))[0]?.status, "approved");
  });

  test("a checker cannot update or delete someone else's review or item (read-only on others')", async () => {
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").update({ status: "approved" }).eq("id", otherReview).select()));
    assert.ok(nothingHappened(await db("checker").from("review_items").update({ resolved: true }).eq("id", otherItem).select()));
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").delete().eq("id", otherReview).select()));
    assert.ok(nothingHappened(await db("checker").from("review_items").delete().eq("id", otherItem).select()));
    const review = rows(await db("admin").from("checker_reviews").select("status").eq("id", otherReview))[0];
    const item = rows(await db("admin").from("review_items").select("resolved").eq("id", otherItem))[0];
    assert.equal(review?.status, "pending");
    assert.equal(item?.resolved, false);
  });

  test("members and managers cannot update reviews or items", async () => {
    for (const r of ["member", "member2", "manager"] as const) {
      assert.ok(nothingHappened(await db(r).from("checker_reviews").update({ status: "changes_requested" }).eq("id", reviewOnA).select()));
      assert.ok(nothingHappened(await db(r).from("review_items").update({ resolved: true }).eq("review_id", reviewOnA).select()));
    }
  });

  test("a checker cannot move a review to another checker or version", async () => {
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").update({ checker_id: userId.admin }).eq("id", reviewOnB).select()));
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").update({ version_id: versionsB[1] }).eq("id", reviewOnB).select()));
  });
});

describe("app_settings is unreachable from the API", () => {
  for (const r of ROLES) {
    test(`${r} cannot read or change app_settings`, async () => {
      assert.ok(nothingHappened(await db(r).from("app_settings").select("*")));
      assert.ok(nothingHappened(await db(r).from("app_settings").update({ value: "on" }).eq("key", "allow_example_test").select()));
    });
  }
});
