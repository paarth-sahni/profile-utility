/** Purpose: unit tests for isInAppNavigation (which link clicks the unsaved-changes guard must intercept). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isInAppNavigation, type LinkClick } from "./unsavedGuard";

const HERE = "http://localhost:3000/internal?version=abc";
const click = (over: Partial<LinkClick>): LinkClick => ({
  href: "http://localhost:3000/profiles",
  target: null,
  download: false,
  button: 0,
  modifier: false,
  defaultPrevented: false,
  ...over,
});

test("a plain click to another page of the app is intercepted", () => {
  assert.equal(isInAppNavigation(click({}), HERE), true);
});

test("the same page with a different query is a navigation", () => {
  assert.equal(isInAppNavigation(click({ href: "http://localhost:3000/internal?version=def" }), HERE), true);
});

test("a hash-only change or the same URL is not a navigation", () => {
  assert.equal(isInAppNavigation(click({ href: "http://localhost:3000/internal?version=abc#top" }), HERE), false);
  assert.equal(isInAppNavigation(click({ href: HERE }), HERE), false);
});

test("other sites are left to beforeunload", () => {
  assert.equal(isInAppNavigation(click({ href: "https://example.com/" }), HERE), false);
});

test("non-http schemes are ignored", () => {
  assert.equal(isInAppNavigation(click({ href: "mailto:someone@example.test" }), HERE), false);
  assert.equal(isInAppNavigation(click({ href: "javascript:void(0)" }), HERE), false);
});

test("new tab, download, modified and non-primary clicks are ignored", () => {
  assert.equal(isInAppNavigation(click({ target: "_blank" }), HERE), false);
  assert.equal(isInAppNavigation(click({ download: true }), HERE), false);
  assert.equal(isInAppNavigation(click({ modifier: true }), HERE), false);
  assert.equal(isInAppNavigation(click({ button: 1 }), HERE), false);
  assert.equal(isInAppNavigation(click({ defaultPrevented: true }), HERE), false);
});

test("target _self counts as same tab", () => {
  assert.equal(isInAppNavigation(click({ target: "_self" }), HERE), true);
});

test("an unparseable URL is ignored rather than throwing", () => {
  assert.equal(isInAppNavigation(click({ href: "http://[bad" }), HERE), false);
});
