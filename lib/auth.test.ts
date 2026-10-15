import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseGoogleDocs, isAllowedEmail, safeNextPath } from "./authRules";
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

test("sessionExpired enforces the 2-hour sign-in limit", async () => {
  const { sessionExpired, SESSION_MAX_AGE_MS } = await import("./authRules");
  assert.equal(SESSION_MAX_AGE_MS, 2 * 60 * 60 * 1000);
  const now = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(sessionExpired("2026-10-09T11:30:00Z", now), false);
  assert.equal(sessionExpired("2026-10-09T10:59:59Z", now), false); // 1h old: no longer expired
  assert.equal(sessionExpired("2026-10-09T10:00:01Z", now), false); // just under 2h
  assert.equal(sessionExpired("2026-10-09T10:00:00Z", now), true); // exactly 2h
  assert.equal(sessionExpired("2026-10-09T09:59:59Z", now), true);
  assert.equal(sessionExpired(null, now), true);
  assert.equal(sessionExpired("garbage", now), true);
});

test("canUseGoogleDocs: managers and admins only", () => {
  assert.equal(canUseGoogleDocs("manager"), true);
  assert.equal(canUseGoogleDocs("admin"), true);
  for (const r of ["member", "checker", "", null, undefined, "Manager", "root"]) assert.equal(canUseGoogleDocs(r), false, String(r));
});
