/** Purpose: unit tests for lib/ownerCodes.ts (owners' IB codes for the list names) with fakes; fictional people only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ibCodeOf, ibCodesByEmail } from "./ownerCodes";
import type { Employee } from "./teamsClient";

const person = (email: string, ibCode: string | null): Employee => ({ ibCode, email, name: "Fictional", role: null, deliveryUnit: null, department: null, managerEmail: null });
const people = [person("a@example.test", "7224"), person("b@example.test", null), person("c@example.test", "IB9")];

test("one email through byEmail, several through the cached list; people without a code are left out", async () => {
  const asked: string[] = [];
  const teams = {
    byEmail: async (e: string) => (asked.push(`one:${e}`), { ok: true as const, data: people.find((p) => p.email === e) ?? null }),
    all: async () => (asked.push("all"), { ok: true as const, data: people }),
  };
  assert.equal(await ibCodeOf(teams, " A@example.test "), "7224");
  const codes = await ibCodesByEmail(teams, ["a@example.test", "b@example.test", "c@example.test", null]);
  assert.deepEqual([...codes], [["a@example.test", "7224"], ["c@example.test", "IB9"]]);
  assert.deepEqual(asked, ["one:a@example.test", "all"]);
  assert.equal(await ibCodeOf(teams, null), null);
});

test("a failure, a throw or a slow answer gives no codes (the page is never held up)", async () => {
  const failing = { byEmail: async () => ({ ok: false as const, error: "timeout" }), all: async () => ({ ok: false as const, error: "timeout" }) };
  assert.equal(await ibCodeOf(failing, "a@example.test"), null);
  const throwing = { byEmail: async () => { throw new Error("x"); }, all: async () => { throw new Error("x"); } };
  assert.equal((await ibCodesByEmail(throwing, ["a@example.test", "c@example.test"])).size, 0);
  const slow = { byEmail: () => new Promise<never>(() => {}), all: () => new Promise<never>(() => {}) };
  const started = Date.now();
  assert.equal((await ibCodesByEmail(slow, ["a@example.test"], 20)).size, 0);
  assert.ok(Date.now() - started < 1000);
});
