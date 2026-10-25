import assert from "node:assert/strict";
import test from "node:test";
import { publicOrigin } from "./publicOrigin";

const FALLBACK = "http://localhost:3000";
const h = (init: Record<string, string>) => new Headers(init);

test("SITE_URL wins and loses its trailing slash", () => {
  assert.equal(publicOrigin(h({ host: "x.test" }), FALLBACK, "https://profile.example.com/"), "https://profile.example.com");
});

test("an invalid SITE_URL is ignored", () => {
  assert.equal(publicOrigin(h({ host: "x.test" }), FALLBACK, "profile.example.com/path"), "http://x.test");
});

test("forwarded host and proto are used behind a proxy", () => {
  const headers = h({ "x-forwarded-host": "profile.example.com", "x-forwarded-proto": "https", host: "127.0.0.1:3000" });
  assert.equal(publicOrigin(headers, FALLBACK, ""), "https://profile.example.com");
});

test("the first value of a comma list is used", () => {
  assert.equal(publicOrigin(h({ "x-forwarded-host": "a.example.com, b.internal", "x-forwarded-proto": "https, http" }), FALLBACK, ""), "https://a.example.com");
});

test("Host is used when no forwarded headers exist, with the fallback protocol", () => {
  assert.equal(publicOrigin(h({ host: "localhost:3000" }), FALLBACK, ""), "http://localhost:3000");
});

test("no headers or an odd host falls back", () => {
  assert.equal(publicOrigin(h({}), FALLBACK, ""), FALLBACK);
  assert.equal(publicOrigin(h({ host: "evil.test/path@x" }), FALLBACK, ""), FALLBACK);
});
