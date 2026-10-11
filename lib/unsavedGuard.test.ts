/** Purpose: unit tests for isInAppNavigation (which link clicks the unsaved-changes guard must intercept). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasUnsavedWork, isInAppNavigation, toRouterPath, type LinkClick, type WorkState } from "./unsavedGuard";

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

const work = (over: Partial<WorkState>): WorkState => ({ hasProfile: true, saved: false, dirty: false, downloaded: false, ...over });

test("hasUnsavedWork: a fresh extraction or blank form is unsaved even before any edit", () => {
  assert.equal(hasUnsavedWork(work({})), true);
});

test("hasUnsavedWork: nothing loaded means nothing to lose", () => {
  assert.equal(hasUnsavedWork(work({ hasProfile: false })), false);
  assert.equal(hasUnsavedWork(work({ hasProfile: false, dirty: true })), false);
});

test("hasUnsavedWork: saved and unedited is safe; saved then edited is not", () => {
  assert.equal(hasUnsavedWork(work({ saved: true })), false);
  assert.equal(hasUnsavedWork(work({ saved: true, dirty: true })), true);
});

test("hasUnsavedWork: a DOCX download since the last edit clears the warning", () => {
  assert.equal(hasUnsavedWork(work({ downloaded: true })), false);
  assert.equal(hasUnsavedWork(work({ downloaded: true, dirty: true })), false);
  assert.equal(hasUnsavedWork(work({ saved: true, dirty: true, downloaded: true })), false);
});

test("hasUnsavedWork: editing after a download (downloaded reset) warns again", () => {
  assert.equal(hasUnsavedWork(work({ dirty: true, downloaded: false })), true);
});

test("toRouterPath: same-site links become router paths (query and hash kept)", () => {
  assert.equal(toRouterPath("http://localhost:3000/profiles?x=1#top", HERE), "/profiles?x=1#top");
  assert.equal(toRouterPath("/profiles", HERE), "/profiles");
});

test("toRouterPath: the basePath is removed because the router adds it back", () => {
  const here = "https://tools.example.test/profile/internal";
  assert.equal(toRouterPath("https://tools.example.test/profile/profiles", here, "/profile"), "/profiles");
  assert.equal(toRouterPath("https://tools.example.test/profile", here, "/profile"), "/");
  assert.equal(toRouterPath("https://tools.example.test/profiles", here, "/profile"), "/profiles", "only a real prefix is stripped");
});

test("toRouterPath: other sites and unparseable links give null", () => {
  assert.equal(toRouterPath("https://example.com/", HERE), null);
  assert.equal(toRouterPath("http://[bad", HERE), null);
});
