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
const ROLES = ["member", "checker", "manager", "admin"] as const;
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
let versionsA: string[];
let versionsB: string[];

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
  assert.ok(profileA !== "undefined" && profileB !== "undefined", "seed profiles missing: run npm run db:reset");

  const versions = rows(await db("admin").from("profile_versions").select("id,profile_id"));
  versionsA = ids(versions.filter((v) => v.profile_id === profileA), "id");
  versionsB = ids(versions.filter((v) => v.profile_id === profileB), "id");
  assert.equal(versionsA.length, 2);
  assert.equal(versionsB.length, 2);
});

after(async () => {
  for (const client of roleOf.values()) await client.auth.signOut();
});

describe("app_users: each role gets exactly its rows", () => {
  const expected: Record<RoleName, number> = { member: 1, checker: 1, manager: 4, admin: 4 };
  for (const r of ROLES) {
    test(`${r} sees ${expected[r]} row(s)`, async () => {
      const res = await db(r).from("app_users").select("id,email,role");
      assert.equal(res.error, null);
      assert.equal(rows(res).length, expected[r]);
      if (r === "member" || r === "checker") assert.equal(rows(res)[0]?.id, userId[r]);
    });
  }
});

describe("profiles: each role gets exactly its rows", () => {
  const expected: Record<RoleName, string[]> = { member: ["A"], checker: ["A", "B"], manager: ["A", "B"], admin: ["A", "B"] };
  for (const r of ROLES) {
    test(`${r} sees profiles ${expected[r].join("+")}`, async () => {
      const res = await db(r).from("profiles").select("id");
      assert.equal(res.error, null);
      const seen = ids(rows(res), "id").sort();
      const want = expected[r].map((k) => (k === "A" ? profileA : profileB)).sort();
      assert.deepEqual(seen, want);
    });
  }

  test("a member cannot read another user's profile by guessing its id", async () => {
    const m = db("member");
    assert.ok(nothingHappened(await m.from("profiles").select("*").eq("id", profileB)));
    assert.ok(nothingHappened(await m.from("profile_versions").select("*").eq("profile_id", profileB)));
    for (const v of versionsB) {
      assert.ok(nothingHappened(await m.from("profile_versions").select("*").eq("id", v)));
      const rebuilt = await m.rpc("get_profile_version", { p_version_id: v });
      assert.equal(rebuilt.data, null, "get_profile_version must return nothing for someone else's version");
    }
  });

  test("a member can rebuild their own version", async () => {
    const rebuilt = await db("member").rpc("get_profile_version", { p_version_id: versionsA[0] });
    assert.equal(rebuilt.error, null);
    assert.equal((rebuilt.data as { data: { name: string } }).data.name, "Alex Sample");
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
  const scratchProfiles: string[] = [];
  /** Version / project / experience keys the member is entitled to (their own profiles), via the admin session. */
  let ownVersions: string[];
  let ownProjects: string[];
  let ownExperience: string[];

  before(async () => {
    // Foreign rows in EVERY table: an internal profile owned by admin; an external one owned by the member
    // (B, owned by admin, is the foreign external one). Together with A these cover each child table both ways.
    scratchProfiles.push(await saveAs("admin", "internal", FULL_INTERNAL));
    scratchProfiles.push(await saveAs("member", "external", FULL_EXTERNAL));
    const admin = db("admin");
    const mine = ids(rows(await admin.from("profiles").select("id").eq("owner_id", userId.member)), "id");
    ownVersions = ids(rows(await admin.from("profile_versions").select("id").in("profile_id", mine)), "id");
    ownProjects = ids(rows(await admin.from("version_projects").select("id").in("version_id", ownVersions)), "id");
    ownExperience = ids(rows(await admin.from("version_experience").select("id").in("version_id", ownVersions)), "id");
  });
  after(async () => {
    for (const id of scratchProfiles) await db("admin").from("profiles").delete().eq("id", id);
  });

  for (const table of VERSION_TABLES) {
    test(`${table}: member sees exactly their own versions' rows; checker, manager and admin see all`, async () => {
      const all = rows(await db("admin").from(table).select("version_id"));
      const foreign = all.filter((r) => !ownVersions.includes(String(r.version_id)));
      const own = all.filter((r) => ownVersions.includes(String(r.version_id)));
      assert.ok(foreign.length > 0 && own.length > 0, `fixtures must put own and foreign rows in ${table}`);
      const mine = rows(await db("member").from(table).select("version_id"));
      assert.deepEqual(ids(mine, "version_id").sort(), ids(own, "version_id").sort());
      for (const r of ["checker", "manager"] as const) {
        assert.equal(rows(await db(r).from(table).select("version_id")).length, all.length);
      }
    });
  }

  for (const table of PROJECT_TABLES) {
    test(`${table}: member sees exactly their own projects' rows`, async () => {
      const all = rows(await db("admin").from(table).select("project_id"));
      const foreign = all.filter((r) => !ownProjects.includes(String(r.project_id)));
      const own = all.filter((r) => ownProjects.includes(String(r.project_id)));
      assert.ok(foreign.length > 0 && own.length > 0, `fixtures must put own and foreign rows in ${table}`);
      const mine = rows(await db("member").from(table).select("project_id"));
      assert.deepEqual(ids(mine, "project_id").sort(), ids(own, "project_id").sort());
      assert.equal(rows(await db("manager").from(table).select("project_id")).length, all.length);
    });
  }

  test(`${HIGHLIGHT_TABLE}: member sees exactly their own experience rows' highlights`, async () => {
    const all = rows(await db("admin").from(HIGHLIGHT_TABLE).select("experience_id"));
    const foreign = all.filter((r) => !ownExperience.includes(String(r.experience_id)));
    const own = all.filter((r) => ownExperience.includes(String(r.experience_id)));
    assert.ok(foreign.length > 0 && own.length > 0, "fixtures must put own and foreign rows in the highlights table");
    const mine = rows(await db("member").from(HIGHLIGHT_TABLE).select("experience_id"));
    assert.deepEqual(ids(mine, "experience_id").sort(), ids(own, "experience_id").sort());
    assert.equal(rows(await db("checker").from(HIGHLIGHT_TABLE).select("experience_id")).length, all.length);
  });

  test("a member cannot add rows to a saved version, even their own (versions are immutable)", async () => {
    const res = await db("member")
      .from("version_skills")
      .insert({ version_id: versionsA[0], position: 99, name: "Injected", rating: "5" })
      .select();
    assert.ok(nothingHappened(res), "a later request must not append to an existing version");
  });

  test("a member cannot add rows to someone else's version", async () => {
    const res = await db("member")
      .from("version_skills")
      .insert({ version_id: versionsB[0], position: 99, name: "Injected", rating: "5" })
      .select();
    assert.ok(nothingHappened(res));
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
      for (const v of [versionsA[0], versionsB[0]]) {
        assert.ok(nothingHappened(await db(r).from("profile_versions").update({ label: "Tampered" }).eq("id", v).select()));
      }
      const check = rows(await db("admin").from("profile_versions").select("id,label").in("id", [...versionsA, ...versionsB]));
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
  test("a member cannot change their own role", async () => {
    for (const role of ["admin", "manager", "checker"]) {
      assert.ok(nothingHappened(await db("member").from("app_users").update({ role }).eq("id", userId.member).select()));
    }
    const fresh = rows(await db("admin").from("app_users").select("role").eq("id", userId.member));
    assert.equal(fresh[0]?.role, "team_member");
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
  test("checker and manager cannot create a profile", async () => {
    for (const r of ["checker", "manager"] as const) {
      const res = await db(r).from("profiles").insert({ owner_id: userId[r], template: "internal" }).select();
      assert.ok(nothingHappened(res), `${r} created a profile`);
    }
  });

  test("a member cannot create a profile owned by someone else", async () => {
    const res = await db("member").from("profiles").insert({ owner_id: userId.admin, template: "internal" }).select();
    assert.ok(nothingHappened(res));
  });

  test("a member cannot update someone else's profile", async () => {
    assert.ok(nothingHappened(await db("member").from("profiles").update({ candidate_name: "Tampered" }).eq("id", profileB).select()));
    assert.ok(nothingHappened(await db("member").from("profiles").delete().eq("id", profileA).select()));
  });

  test("a member cannot reassign their profile, nor point it at another profile's version", async () => {
    assert.ok(nothingHappened(await db("member").from("profiles").update({ owner_id: userId.admin }).eq("id", profileA).select()));
    assert.ok(nothingHappened(await db("member").from("profiles").update({ template: "external" }).eq("id", profileA).select()));
    const hijack = await db("member").from("profiles").update({ current_version_id: versionsB[0] }).eq("id", profileA).select();
    assert.ok(nothingHappened(hijack));
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
      // another member's profile cannot be saved onto, and a manager cannot save at all
      const intoB = await db("member").rpc("save_profile_version", {
        p_profile_id: profileB, p_template: "external", p_kind: "base", p_label: "x", p_parent: null,
        p_source: "edit", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
      });
      assert.notEqual(intoB.error, null);
      for (const r of ["manager", "checker"] as const) {
        const denied = await db(r).rpc("save_profile_version", {
          p_profile_id: null, p_template: "internal", p_kind: "base", p_label: "x", p_parent: null,
          p_source: "scratch", p_profile: { name: "x" }, p_flags: [], p_analysis: null, p_prompt_plan: null,
        });
        assert.notEqual(denied.error, null, `${r} must not be able to save`);
      }
    } finally {
      await db("admin").from("profiles").delete().eq("id", pid);
    }
  });
});

describe("audit_log", () => {
  test("members and checkers read nothing; manager and admin read; nobody can change or delete a row", async () => {
    // make sure at least one row exists (the seed and the tests above already wrote some)
    for (const r of ["member", "checker"] as const) assert.ok(nothingHappened(await db(r).from("audit_log").select("*")), `${r} read audit_log`);
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
  let reviewOnA: string;
  let reviewOnB: string;
  before(async () => {
    const a = await db("checker").from("checker_reviews").insert({ version_id: versionsA[0], checker_id: userId.checker }).select();
    const b = await db("checker").from("checker_reviews").insert({ version_id: versionsB[0], checker_id: userId.checker }).select();
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    reviewOnA = String(rows(a)[0].id);
    reviewOnB = String(rows(b)[0].id);
    const item = await db("checker").from("review_items").insert({ review_id: reviewOnA, path: "skills.0", reason: "check rating" }).select();
    assert.equal(item.error, null);
    assert.equal((await db("checker").from("review_items").insert({ review_id: reviewOnB, path: "name", reason: "check" }).select()).error, null);
  });
  after(async () => {
    for (const id of [reviewOnA, reviewOnB]) await db("admin").from("checker_reviews").delete().eq("id", id); // cascades to items
  });

  test("a checker cannot create a review under someone else's name; members and managers cannot create reviews", async () => {
    const forged = await db("checker").from("checker_reviews").insert({ version_id: versionsA[0], checker_id: userId.admin }).select();
    assert.ok(nothingHappened(forged));
    for (const r of ["member", "manager"] as const) {
      const res = await db(r).from("checker_reviews").insert({ version_id: versionsA[0], checker_id: userId[r] }).select();
      assert.ok(nothingHappened(res), `${r} created a review`);
    }
  });

  test("a member reads reviews and items on their own profile only", async () => {
    const reviews = ids(rows(await db("member").from("checker_reviews").select("id")), "id");
    assert.deepEqual(reviews, [reviewOnA]);
    const items = rows(await db("member").from("review_items").select("review_id"));
    assert.ok(items.length > 0 && items.every((i) => i.review_id === reviewOnA));
  });

  test("checker, manager and admin read what their role allows", async () => {
    for (const r of ["checker", "manager", "admin"] as const) {
      const seen = ids(rows(await db(r).from("checker_reviews").select("id")), "id");
      assert.ok(seen.includes(reviewOnA) && seen.includes(reviewOnB), `${r} cannot read both reviews`);
    }
  });

  test("a checker can update their own review; members and managers cannot", async () => {
    assert.equal((await db("checker").from("checker_reviews").update({ status: "approved" }).eq("id", reviewOnA).select()).error, null);
    for (const r of ["member", "manager"] as const) {
      assert.ok(nothingHappened(await db(r).from("checker_reviews").update({ status: "changes_requested" }).eq("id", reviewOnA).select()));
      assert.ok(nothingHappened(await db(r).from("review_items").update({ resolved: true }).eq("review_id", reviewOnA).select()));
    }
    assert.equal(rows(await db("admin").from("checker_reviews").select("status").eq("id", reviewOnA))[0]?.status, "approved");
  });

  test("a checker cannot move a review to another checker or version", async () => {
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").update({ checker_id: userId.admin }).eq("id", reviewOnA).select()));
    assert.ok(nothingHappened(await db("checker").from("checker_reviews").update({ version_id: versionsB[1] }).eq("id", reviewOnA).select()));
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
