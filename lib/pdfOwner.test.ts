/** Purpose: unit tests for lib/pdfOwner.ts (whose IB code names the PDF) with fakes; fictional people only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerIbCodeWith, type OwnerLookup } from "./pdfOwner";
import type { Employee } from "./teamsClient";

const person = (email: string, ibCode: string | null): Employee => ({ ibCode, email, name: "Fictional", role: null, deliveryUnit: null, department: null, managerEmail: null });

function lookup(over: Partial<OwnerLookup> = {}): OwnerLookup & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    userEmail: async () => "me@example.test",
    versionOwnerEmail: async (id) => (id === "v-other" ? "other@example.test" : null),
    teams: {
      byEmail: async (email) => {
        asked.push(email);
        return { ok: true, data: email === "me@example.test" ? person(email, "IB1") : email === "other@example.test" ? person(email, "IB2") : null };
      },
    },
    ...over,
  };
}

test("the signed-in user's IB code, or a saved version's owner's", async () => {
  const l = lookup();
  assert.equal(await ownerIbCodeWith(l, null), "IB1");
  assert.equal(await ownerIbCodeWith(l, "v-other"), "IB2", "the owner of the version, not the person downloading");
  assert.deepEqual(l.asked, ["me@example.test", "other@example.test"]);
});

test("null when the version cannot be read, the person has no IB code, or the Teams data fails", async () => {
  assert.equal(await ownerIbCodeWith(lookup(), "v-unreadable"), null);
  assert.equal(await ownerIbCodeWith(lookup({ teams: { byEmail: async (e) => ({ ok: true, data: person(e, null) }) } }), null), null);
  assert.equal(await ownerIbCodeWith(lookup({ teams: { byEmail: async () => ({ ok: false, error: "timeout" }) } }), null), null);
  assert.equal(await ownerIbCodeWith(lookup({ userEmail: async () => { throw new Error("session"); } }), null), null);
});
