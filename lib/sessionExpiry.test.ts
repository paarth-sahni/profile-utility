/** Purpose: unit tests for the session-expiry banner rules (timing, phases, wording). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_MAX_AGE_MS } from "./authRules";
import { EXPIRY_WARNING_MS, expiryMessage, expiryPhase, minutesLeft, sessionRemainingMs } from "./sessionExpiry";

const MIN = 60_000;
const NOW = Date.parse("2026-10-12T12:00:00Z");

test("the hard limit is 2 hours and the warning starts 5 minutes before it", () => {
  assert.equal(SESSION_MAX_AGE_MS, 2 * 60 * MIN);
  assert.equal(EXPIRY_WARNING_MS, 5 * MIN);
});

test("sessionRemainingMs counts down from the last sign-in", () => {
  assert.equal(sessionRemainingMs("2026-10-12T12:00:00Z", NOW), 2 * 60 * MIN);
  assert.equal(sessionRemainingMs("2026-10-12T10:30:00Z", NOW), 30 * MIN);
  assert.equal(sessionRemainingMs("2026-10-12T10:00:00Z", NOW), 0);
  assert.equal(sessionRemainingMs("2026-10-12T08:00:00Z", NOW), 0, "never negative");
});

test("sessionRemainingMs treats a missing or invalid sign-in time as over", () => {
  assert.equal(sessionRemainingMs(null, NOW), 0);
  assert.equal(sessionRemainingMs(undefined, NOW), 0);
  assert.equal(sessionRemainingMs("garbage", NOW), 0);
});

test("expiryPhase: none until 5 minutes remain, warning up to the end, then expired", () => {
  assert.equal(expiryPhase(2 * 60 * MIN), "none");
  assert.equal(expiryPhase(5 * MIN + 1), "none");
  assert.equal(expiryPhase(5 * MIN), "warning");
  assert.equal(expiryPhase(1), "warning");
  assert.equal(expiryPhase(0), "expired");
  assert.equal(expiryPhase(-1000), "expired");
});

test("minutesLeft rounds up", () => {
  assert.equal(minutesLeft(5 * MIN), 5);
  assert.equal(minutesLeft(4 * MIN + 1), 5);
  assert.equal(minutesLeft(60_000), 1);
  assert.equal(minutesLeft(1), 1);
  assert.equal(minutesLeft(0), 0);
});

test("expiryMessage: nothing to say before the warning window", () => {
  assert.equal(expiryMessage(30 * MIN, true), null);
  assert.equal(expiryMessage(5 * MIN + 1, false), null);
});

test("expiryMessage: the 5-minute warning asks to Submit from Preview when there is unsaved work", () => {
  assert.equal(expiryMessage(5 * MIN, true), "Your session ends in 5 minutes — go to Preview & Submit to save your profile (or download your PDF).");
  assert.equal(expiryMessage(2 * MIN, true), "Your session ends in 2 minutes — go to Preview & Submit to save your profile (or download your PDF).");
  assert.equal(expiryMessage(60_000, true), "Your session ends in 1 minute — go to Preview & Submit to save your profile (or download your PDF).");
  assert.equal(expiryMessage(30_000, true), "Your session ends in less than a minute — go to Preview & Submit to save your profile (or download your PDF).");
});

test("expiryMessage: without unsaved work it only reassures", () => {
  assert.equal(expiryMessage(5 * MIN, false), "Your session ends in 5 minutes. Your latest changes are saved.");
});

test("expiryMessage: after the end it tells the user to sign in again", () => {
  assert.match(expiryMessage(0, true) ?? "", /session has ended.*restore/);
  assert.equal(expiryMessage(0, false), "Your session has ended. Sign in again to continue.");
});

test("expiryMessage for external profiles (never saved): asks for a download, never says anything is saved", () => {
  assert.equal(expiryMessage(30 * MIN, true, false), null);
  assert.equal(expiryMessage(5 * MIN, true, false), "Your session ends in 5 minutes — download your PDF now. External profiles are not saved.");
  assert.equal(expiryMessage(30_000, true, false), "Your session ends in less than a minute — download your PDF now. External profiles are not saved.");
  assert.equal(expiryMessage(2 * MIN, false, false), "Your session ends in 2 minutes.");
  assert.match(expiryMessage(0, true, false) ?? "", /session has ended.*kept in this tab/);
  for (const [canSave, ms] of [[true, 5 * MIN], [false, 5 * MIN], [true, 0], [false, 0]] as const) {
    assert.doesNotMatch(expiryMessage(ms, canSave, false) ?? "", /changes are saved|save your profile|Submit/i);
  }
});
