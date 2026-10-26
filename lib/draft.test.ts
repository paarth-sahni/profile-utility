/** Purpose: unit tests for draft recovery rules (who may see a draft, when it is kept, and storage failures). */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DRAFT_MAX_AGE_MS, type Draft, type DraftState, readDraft, shouldKeepDraft, writeDraft } from "./draft";
import { DRAFT_PREFIX, type DraftStorage, clearAllDrafts, clearDraft, clearDraftsOnSignOut, draftKey, draftsSuspended, resumeDrafts } from "./draftStorage";
import type { InternalResume } from "./schemas";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const USER = "00000000-0000-0000-0000-000000000101";
const OTHER_USER = "00000000-0000-0000-0000-000000000102";
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const DATA: InternalResume = {
  name: "Testy McSample",
  jobTitle: "Engineer",
  experienceSummary: "5+ Years of experience",
  specialization: "Java",
  overview: "Line one.\nLine two.",
  education: [{ year: "2015", qualification: "B.E." }],
  projects: [],
  skills: [{ name: "Java", rating: "" }],
  certifications: [],
  tools: ["Git"],
  managerialExperience: [],
  domains: [],
  languages: ["English"],
};

const draft = (over: Partial<Draft> = {}): Draft => ({
  v: 1,
  userId: USER,
  template: "internal",
  source: "upload",
  data: DATA,
  reviewFlags: [{ path: "overview", reason: "Check wording" }],
  analysis: null,
  promptPlan: ["a"],
  profileId: null,
  versionId: null,
  versionNo: null,
  label: "",
  savedAt: NOW - 1000,
  ...over,
});

/** A Map-backed stand-in for sessionStorage. */
class FakeStorage implements DraftStorage {
  items = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException("quota", "QuotaExceededError");
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  resumeDrafts();
});

const read = (over: { userId?: string; template?: "internal" | "external"; now?: number } = {}) =>
  readDraft(store, { userId: USER, template: "internal", now: NOW, ...over });

test("a draft round-trips for the same user and template", () => {
  assert.equal(writeDraft(store, draft({ source: "saved", profileId: UUID_A, versionId: UUID_B, versionNo: 3, label: "Base" })), true);
  const got = read();
  assert.ok(got);
  assert.deepEqual(got.data, DATA);
  assert.equal(got.profileId, UUID_A);
  assert.equal(got.versionNo, 3);
  assert.deepEqual(got.reviewFlags, [{ path: "overview", reason: "Check wording" }]);
});

test("nothing stored means nothing to offer", () => {
  assert.equal(read(), null);
});

test("a different signed-in user never sees the draft, and it is deleted", () => {
  writeDraft(store, draft());
  assert.equal(read({ userId: OTHER_USER }), null);
  assert.equal(store.getItem(draftKey("internal")), null);
});

test("drafts are per template", () => {
  writeDraft(store, draft());
  assert.equal(read({ template: "external" }), null);
  assert.ok(store.getItem(draftKey("internal")), "the internal draft is untouched by an external read");
});

test("a draft older than the maximum age is discarded", () => {
  writeDraft(store, draft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
  assert.equal(read(), null);
  assert.equal(store.getItem(draftKey("internal")), null);
});

test("a draft just inside the maximum age is kept", () => {
  writeDraft(store, draft({ savedAt: NOW - DRAFT_MAX_AGE_MS + 1000 }));
  assert.ok(read());
});

test("a draft stamped in the future is discarded", () => {
  writeDraft(store, draft({ savedAt: NOW + 10 * 60_000 }));
  assert.equal(read(), null);
});

test("corrupt JSON is discarded without throwing", () => {
  store.setItem(draftKey("internal"), "{not json");
  assert.equal(read(), null);
  assert.equal(store.getItem(draftKey("internal")), null);
});

test("a draft with the wrong shape or a profile that fails validation is discarded", () => {
  store.setItem(draftKey("internal"), JSON.stringify({ ...draft(), v: 2 }));
  assert.equal(read(), null);
  writeDraft(store, draft({ data: { ...DATA, skills: "nope" } as unknown as InternalResume }));
  assert.equal(read(), null);
  assert.equal(store.getItem(draftKey("internal")), null);
});

test("writeDraft reports failure instead of throwing when storage is full or missing", () => {
  store.failWrites = true;
  assert.equal(writeDraft(store, draft()), false);
  assert.equal(writeDraft(null, draft()), false);
  assert.equal(readDraft(null, { userId: USER, template: "internal" }), null);
});

test("clearDraft removes one template; clearAllDrafts removes only draft keys", () => {
  writeDraft(store, draft());
  writeDraft(store, draft({ template: "external", data: DATA as never }));
  store.setItem("something-else", "keep me");
  clearDraft(store, "internal");
  assert.equal(store.getItem(draftKey("internal")), null);
  assert.ok(store.getItem(draftKey("external")));
  clearAllDrafts(store);
  assert.equal(store.getItem(draftKey("external")), null);
  assert.equal(store.getItem("something-else"), "keep me");
  assert.ok(draftKey("internal").startsWith(DRAFT_PREFIX));
});

test("clearing tolerates missing storage", () => {
  clearDraft(null, "internal");
  clearAllDrafts(null);
});

const state = (over: Partial<DraftState> = {}): DraftState => ({
  hasProfile: true,
  saved: false,
  dirty: false,
  downloaded: false,
  source: "upload",
  edited: false,
  ...over,
});

test("shouldKeepDraft: a fresh extraction is kept even before any edit", () => {
  assert.equal(shouldKeepDraft(state()), true);
});

test("shouldKeepDraft: a blank form nobody typed into is not kept, but an edited one is", () => {
  assert.equal(shouldKeepDraft(state({ source: "scratch", edited: false })), false);
  assert.equal(shouldKeepDraft(state({ source: "scratch", edited: true, dirty: true })), true);
});

test("shouldKeepDraft: saved, or downloaded, or nothing loaded clears the draft", () => {
  assert.equal(shouldKeepDraft(state({ saved: true })), false);
  assert.equal(shouldKeepDraft(state({ downloaded: true })), false);
  assert.equal(shouldKeepDraft(state({ hasProfile: false })), false);
});

test("shouldKeepDraft: edits after a save keep a draft again", () => {
  assert.equal(shouldKeepDraft(state({ saved: true, dirty: true, source: "saved", edited: true })), true);
});

test("sign-out deletes every draft and stops later writes (the pagehide flush must not bring it back)", () => {
  writeDraft(store, draft());
  store.setItem("something-else", "keep me");
  clearDraftsOnSignOut(store);
  assert.equal(store.getItem(draftKey("internal")), null);
  assert.equal(store.getItem("something-else"), "keep me");
  assert.equal(draftsSuspended(), true);
  assert.equal(writeDraft(store, draft()), false, "a flush after sign-out writes nothing");
  assert.equal(store.getItem(draftKey("internal")), null);
  resumeDrafts();
  assert.equal(writeDraft(store, draft()), true, "writes work again once resumed");
});
