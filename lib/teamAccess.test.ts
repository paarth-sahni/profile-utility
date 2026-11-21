/** Purpose: unit tests for lib/teamAccess.ts: who gets the team list and whose profile link they may open. Fictional emails. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { accessFor, canOpenProfileOf, canSeeTeamList, decideAccess } from "./teamAccess";

const yes = { ok: true as const, data: true };
const no = { ok: true as const, data: false };
const down = { ok: false as const, error: "timeout" };

test("staff, leads and members", () => {
  assert.deepEqual(decideAccess("manager", no), { level: "staff", teamsAvailable: true });
  assert.deepEqual(decideAccess("admin", yes), { level: "staff", teamsAvailable: true });
  assert.deepEqual(decideAccess("team_member", yes), { level: "lead", teamsAvailable: true }, "a team_member with reportees is a lead");
  assert.deepEqual(decideAccess("checker", yes), { level: "lead", teamsAvailable: true });
  assert.deepEqual(decideAccess("team_member", no), { level: "member", teamsAvailable: true });
  assert.deepEqual(decideAccess("checker", no), { level: "member", teamsAvailable: true });
});

test("Teams data unavailable: team members keep only their own access, managers and admins keep theirs", () => {
  assert.deepEqual(decideAccess("team_member", down), { level: "member", teamsAvailable: false });
  assert.deepEqual(decideAccess("manager", down), { level: "staff", teamsAvailable: false });
});

test("the team list and profile links", () => {
  const member = decideAccess("team_member", no);
  const lead = decideAccess("team_member", yes);
  const staff = decideAccess("admin", down);
  assert.equal(canSeeTeamList(member), false);
  assert.equal(canSeeTeamList(lead), true);
  assert.equal(canSeeTeamList(staff), true);
  assert.equal(canOpenProfileOf(member, "me@example.test", "ME@example.test "), true, "your own profile, whatever the case");
  assert.equal(canOpenProfileOf(member, "me@example.test", "other@example.test"), false);
  assert.equal(canOpenProfileOf(lead, "me@example.test", "other@example.test"), true);
  assert.equal(canOpenProfileOf(staff, "me@example.test", "other@example.test"), true);
});

test("accessFor asks the Teams data about the signed-in user's own email", async () => {
  const asked: string[] = [];
  const access = await accessFor({ email: "lead@example.test", role: "team_member" }, { hasReportees: async (e) => (asked.push(e), yes) });
  assert.equal(access.level, "lead");
  assert.deepEqual(asked, ["lead@example.test"]);
});
