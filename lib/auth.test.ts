import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedEmail, safeNextPath } from "./authRules";
import { allowRequest, resetRateLimits } from "./rateLimit";

test("isAllowedEmail accepts only infobeans.com", () => {
  assert.equal(isAllowedEmail("a.b@infobeans.com"), true);
  assert.equal(isAllowedEmail("A.B@InfoBeans.COM"), true);
  assert.equal(isAllowedEmail("a@gmail.com"), false);
  assert.equal(isAllowedEmail("a@infobeans.com.evil.io"), false);
  assert.equal(isAllowedEmail("a@evilinfobeans.com"), false);
  assert.equal(isAllowedEmail(null), false);
});

test("safeNextPath blocks open redirects", () => {
  assert.equal(safeNextPath("/external"), "/external");
  assert.equal(safeNextPath("/external?x=1"), "/external?x=1");
  assert.equal(safeNextPath("//evil.com"), "/internal");
  assert.equal(safeNextPath("https://evil.com"), "/internal");
  assert.equal(safeNextPath("/" + String.fromCharCode(92) + "evil.com"), "/internal");
  assert.equal(safeNextPath("/login"), "/internal");
  assert.equal(safeNextPath(null), "/internal");
});

test("allowRequest enforces a sliding window", () => {
  resetRateLimits();
  assert.equal(allowRequest("u", 2, 1000, 0), true);
  assert.equal(allowRequest("u", 2, 1000, 10), true);
  assert.equal(allowRequest("u", 2, 1000, 20), false);
  assert.equal(allowRequest("other", 2, 1000, 20), true);
  assert.equal(allowRequest("u", 2, 1000, 1500), true);
});

test("sessionExpired enforces the 1-hour sign-in limit", async () => {
  const { sessionExpired } = await import("./authRules");
  const now = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(sessionExpired("2026-10-09T11:30:00Z", now), false);
  assert.equal(sessionExpired("2026-10-09T10:59:59Z", now), true);
  assert.equal(sessionExpired("2026-10-09T11:00:00Z", now), true);
  assert.equal(sessionExpired(null, now), true);
  assert.equal(sessionExpired("garbage", now), true);
});
