import assert from "node:assert/strict";
import { test } from "node:test";
import { findViolations, highlightsByPath, violationsByPath, toDto } from "./compliance/check";
import { buildMatcher, type RegistryName } from "./compliance/match";
import { normalizeHeader, normalizeName, tokenize } from "./compliance/normalize";
import { blankResume, type ExternalResume, type InternalResume } from "./schemas";

// Fictional names only.
const NAMES: RegistryName[] = [
  { id: "1", name: "Acme Limited", types: ["client", "legal"] },
  { id: "2", name: "Project Falcon", types: ["project"] },
  { id: "3", name: "Zenith", types: ["client"] },
  { id: "4", name: "Acme Bank Limited", types: ["legal"] },
  { id: "5", name: "AT&T Labs", types: ["client"] },
];
const matcher = buildMatcher(NAMES);

test("normalizeName: case, spaces, punctuation, accents, ampersand", () => {
  assert.equal(normalizeName("  ACME   Limited "), "acme limited");
  assert.equal(normalizeName("Acme, Limited."), "acme limited");
  assert.equal(normalizeName("Café Société"), "cafe societe");
  assert.equal(normalizeName("AT&T"), "at and t");
  assert.equal(normalizeName("A & B"), "a and b");
  assert.equal(normalizeName("---"), "");
  assert.equal(normalizeName("Ａｃｍｅ"), "acme"); // full-width letters
});

test("normalizeName does not merge look-alikes", () => {
  assert.notEqual(normalizeName("Acme Ltd"), normalizeName("Acme Limited"));
  assert.notEqual(normalizeName("Acme"), normalizeName("Acme Limited"));
});

test("normalizeHeader ignores case, spaces and punctuation", () => {
  assert.equal(normalizeHeader(" New  Client Name "), "newclientname");
  assert.equal(normalizeHeader("Legal_Name"), "legalname");
  assert.equal(normalizeHeader(42), "");
});

test("tokenize keeps offsets into the original text", () => {
  const t = tokenize("Hi, Acme-Ltd!");
  assert.deepEqual(t.map((x) => [x.value, x.start, x.end]), [["hi", 0, 2], ["acme", 4, 8], ["ltd", 9, 12]]);
});

test("scan: exact, case-insensitive, punctuation and spacing differences", () => {
  for (const text of ["Built for Acme Limited.", "built for ACME   LIMITED", "built for acme, limited!"]) {
    const m = matcher.scan(text);
    assert.equal(m.length, 1, text);
    assert.equal(m[0].nameId, "1");
  }
});

test("scan returns offsets and the text as typed", () => {
  const text = "Delivered for  Acme   Limited today";
  const [m] = matcher.scan(text);
  assert.equal(text.slice(m.start, m.end), "Acme   Limited");
  assert.equal(m.matchedText, "Acme   Limited");
});

test("scan: whole-word only, no substring hits", () => {
  assert.deepEqual(matcher.scan("Zenithal growth and zenithcorp"), []);
  assert.deepEqual(matcher.scan("Acmeville Limited"), []);
  assert.equal(matcher.scan("The Zenith account").length, 1);
});

test("scan: project names are matched independently", () => {
  const m = matcher.scan("Led Project Falcon end to end");
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].types, ["project"]);
});

test("scan: longest match wins and overlaps are not double reported", () => {
  const m = matcher.scan("Worked with Acme Bank Limited");
  assert.equal(m.length, 1);
  assert.equal(m[0].nameId, "4");
});

test("scan: several matches in one text, in order", () => {
  const m = matcher.scan("Acme Limited and Zenith, then Project Falcon");
  assert.deepEqual(m.map((x) => x.nameId), ["1", "3", "2"]);
});

test("scan: ampersand names match with and without the symbol", () => {
  assert.equal(matcher.scan("AT&T Labs engagement").length, 1);
  assert.equal(matcher.scan("at and t labs engagement").length, 1);
});

test("scan: empty registry or empty text finds nothing", () => {
  assert.deepEqual(buildMatcher([]).scan("Acme Limited"), []);
  assert.deepEqual(matcher.scan(""), []);
  assert.equal(buildMatcher([{ id: "x", name: "---", types: ["client"] }]).size, 0);
});

const internal = (): InternalResume => ({ ...(blankResume("internal") as InternalResume) });
const external = (): ExternalResume => ({ ...(blankResume("external") as ExternalResume) });

test("findViolations: internal profile, several fields, list items, nested paths", () => {
  const d = internal();
  d.overview = "Automation for Acme Limited.";
  d.projects = [
    { ...d.projects[0], title: "Project Falcon", responsibilities: ["Fine", "Built it for Zenith"] },
  ];
  const v = findViolations(matcher, d);
  assert.deepEqual(v.map((x) => x.path).sort(), ["overview", "projects.0.responsibilities.1", "projects.0.title"]);
  assert.deepEqual(Object.keys(violationsByPath(v)).sort(), ["overview", "projects.0.responsibilities.1", "projects.0.title"]);
  assert.deepEqual(highlightsByPath(v).overview, [{ start: 15, end: 27 }]);
});

test("findViolations: external profile client and employer fields", () => {
  const d = external();
  d.projects = [{ ...d.projects[0], client: "Zenith", description: "Fine" }];
  d.experience = [{ ...d.experience[0], company: "Acme Limited", highlights: ["ok"] }];
  const paths = findViolations(matcher, d).map((x) => x.path).sort();
  assert.deepEqual(paths, ["experience.0.company", "projects.0.client"]);
});

test("findViolations: a clean profile and N/A placeholders give nothing", () => {
  const d = internal();
  d.overview = "Built AI-assisted workflow automation for insurance claims.";
  d.specialization = "N/A";
  assert.deepEqual(findViolations(matcher, d), []);
});

test("findViolations: content changed after a check is judged on the latest content", () => {
  const d = internal();
  d.overview = "For Acme Limited";
  assert.equal(findViolations(matcher, d).length, 1);
  d.overview = "For a large insurer";
  assert.equal(findViolations(matcher, d).length, 0);
  d.jobTitle = "Zenith lead"; // reintroduced elsewhere
  assert.equal(findViolations(matcher, d).length, 1);
});

test("toDto exposes only path, offsets, typed text and name types", () => {
  const d = internal();
  d.overview = "For Zenith";
  const dto = toDto(findViolations(matcher, d)[0]);
  assert.deepEqual(Object.keys(dto).sort(), ["end", "matchedText", "path", "start", "types"]);
});
