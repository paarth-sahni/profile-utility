/** Purpose: unit tests for lib/teamList.ts (Profile Hub team list filters). Fictional people only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterTeam, parseTeamFilters, teamHref } from "./teamList";
import type { Employee } from "./teamsClient";

const e = (name: string, ibCode: string | null, deliveryUnit: string, department: string): Employee => ({ name, ibCode, email: `${name.split(" ")[0].toLowerCase()}@example.test`, role: "Engineer", deliveryUnit, department, managerEmail: null });
const PEOPLE = [e("Zara Fictional", "IB1001", "Unit A", "Engineering"), e("arun Sample", "IB2002", "Unit B", "Quality"), e("Mina Example", null, "Unit A", "Quality")];

test("parseTeamFilters: My team by default; unexpected values fall back", () => {
  assert.deepEqual(parseTeamFilters({}), { scope: "mine", deliveryUnit: "", department: "", q: "" });
  assert.deepEqual(parseTeamFilters({ scope: "all", du: " Unit A ", dept: ["Quality", "x"], q: "ar" }), { scope: "all", deliveryUnit: "Unit A", department: "Quality", q: "ar" });
  assert.equal(parseTeamFilters({ scope: "everyone" }).scope, "mine");
  assert.equal(parseTeamFilters({ q: "x".repeat(500) }).q.length, 100);
});

test("filterTeam: unit, department, name or IB code; sorted by name", () => {
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "", department: "", q: "" }).map((p) => p.name), ["arun Sample", "Mina Example", "Zara Fictional"]);
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "Unit A", department: "", q: "" }).map((p) => p.name), ["Mina Example", "Zara Fictional"]);
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "Unit A", department: "Quality", q: "" }).map((p) => p.name), ["Mina Example"]);
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "", department: "", q: "SAMPLE" }).map((p) => p.name), ["arun Sample"]);
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "", department: "", q: "ib10" }).map((p) => p.name), ["Zara Fictional"], "IB code prefix, any case");
  assert.deepEqual(filterTeam(PEOPLE, { deliveryUnit: "", department: "", q: "1001" }), [], "an IB code matches from its start only");
});

test("teamHref: leaves defaults out and keeps what is set", () => {
  assert.equal(teamHref({ scope: "mine", deliveryUnit: "", department: "", q: "" }), "/manage?tab=team");
  assert.equal(teamHref({ scope: "all", deliveryUnit: "Unit A", department: "", q: " Asha " }), "/manage?tab=team&scope=all&du=Unit+A&q=Asha");
});
