import assert from "node:assert/strict";
import { test } from "node:test";
import { gateResponse } from "./compliance/gate";
import { buildMatcher } from "./compliance/match";
import { RegistryUnavailableError } from "./compliance/registryCache";
import { PDF_RATE_MESSAGE, handlePdfPost, type PdfDeps } from "./pdfHandler";
import type { ExternalResume, InternalResume } from "./schemas";

// Fictional names only.
const matcher = buildMatcher([{ id: "n1", name: "Example Client One", types: ["client"] }]);

const INTERNAL: InternalResume = {
  name: "Asha Rao", jobTitle: "Engineer", experienceSummary: "6+ Years of Industry Experience", specialization: "",
  overview: "Built a claims platform.", education: [{ year: "2016", qualification: "B.E." }], projects: [],
  skills: [{ name: "Go", rating: "4" }], certifications: [], tools: [], managerialExperience: [], domains: [], languages: [],
};
const EXTERNAL: ExternalResume = {
  name: "Asha Rao", jobTitle: "Engineer", experienceSummary: "6+ Years of Industry Experience", specialization: "", overview: "Built a claims platform.",
  education: [{ year: "2016", qualification: "B.E." }], skills: ["Go"], tools: [], certifications: [], projects: [], experience: [],
  achievements: [], customSections: [],
};
const DOWNLOAD = { action: "download", accepted: true };

const request = (body: unknown) => new Request("http://test/api/pdf", { method: "POST", body: JSON.stringify(body) });

function setup(over: Partial<PdfDeps> = {}) {
  const calls: string[] = [];
  const deps: PdfDeps = {
    getUserId: async () => "user-1",
    allow: () => true,
    gate: async (template, data) => (calls.push("gate"), gateResponse(template, data, { mode: "on", getMatcher: async () => matcher })),
    render: async () => (calls.push("render"), new Uint8Array([37, 80, 68, 70])),
    recordDownloadConsent: async (userId, template) => void calls.push(`consent:${userId}:${template}`),
    ownerIbCode: async () => null,
    ...over,
  };
  return { deps, calls };
}

test("a download: checks, then the PDF, then the consent row (for the signed-in user), then the file", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition") ?? "", /AshaRao_Engineer_InfoBeans\.pdf/);
  assert.deepEqual(calls, ["gate", "render", "consent:user-1:internal"]);
});

test("a preview (no consent) records nothing", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["gate", "render"]);
});

test("an incomplete profile: 422 INCOMPLETE with every field to fix; nothing rendered, no consent row", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: { ...INTERNAL, overview: "", skills: [{ name: "", rating: "4" }] }, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 422);
  const json = (await res.json()) as { error: { code: string; fields: { path: string }[] } };
  assert.equal(json.error.code, "INCOMPLETE");
  assert.deepEqual(json.error.fields.map((f) => f.path).sort(), ["overview", "skills.0.name"]);
  assert.deepEqual(calls, []);
});

test("an internal profile naming a registered client: 422 COMPLIANCE, nothing rendered, no consent row", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: { ...INTERNAL, jobTitle: "Lead, Example Client One" }, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 422);
  const json = (await res.json()) as { error: { code: string; matches: { path: string }[] } };
  assert.deepEqual([json.error.code, json.error.matches[0].path], ["COMPLIANCE", "jobTitle"]);
  assert.deepEqual(calls, ["gate"]);
});

test("a registered client named only in the Overview is not checked (the check covers the name, job title and projects)", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: { ...INTERNAL, overview: "Built it for Example Client One." }, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["gate", "render", "consent:user-1:internal"]);
});

test("an external profile with the same name is not checked: the PDF is made and the consent recorded", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "external", data: { ...EXTERNAL, overview: "Built it for Example Client One." }, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["gate", "render", "consent:user-1:external"]);
});

test("registry unavailable (internal): 503, nothing rendered, no consent row", async () => {
  const { deps, calls } = setup({
    gate: async (template, data) => (calls.push("gate"), gateResponse(template, data, { mode: "on", getMatcher: async () => { throw new RegistryUnavailableError(); } })),
  });
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 503);
  assert.deepEqual(calls, ["gate"]);
});

test("the PDF cannot be made: 500 (503 without LibreOffice) and no consent row", async () => {
  for (const [code, status] of [["CONVERSION_FAILED", 500], ["CONVERTER_MISSING", 503]] as const) {
    const { deps, calls } = setup({ render: async () => { calls.push("render"); throw Object.assign(new Error("x"), { code }); } });
    const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, consent: DOWNLOAD }), deps);
    assert.equal(res.status, status);
    assert.ok(!calls.some((c) => c.startsWith("consent")));
  }
});

test("the consent row cannot be written: 500 CONSENT_FAILED and no PDF is sent", async () => {
  const { deps } = setup({ recordDownloadConsent: async () => { throw new Error("db"); } });
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, consent: DOWNLOAD }), deps);
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CONSENT_FAILED");
});

test("anything but the accepted download consent is a 400 before any work", async () => {
  for (const consent of [{ action: "download", accepted: false }, { action: "submit", accepted: true }, "yes", null]) {
    const { deps, calls } = setup();
    const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, consent }), deps);
    assert.equal(res.status, 400, JSON.stringify(consent));
    assert.deepEqual(calls, []);
  }
});

test("signed out 401, rate limit 429 with a clear message, unknown template 400", async () => {
  assert.equal((await handlePdfPost(request({ template: "internal", data: INTERNAL }), setup({ getUserId: async () => null }).deps)).status, 401);
  const limited = await handlePdfPost(request({ template: "internal", data: INTERNAL }), setup({ allow: () => false }).deps);
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { error: { message: string } }).error.message, PDF_RATE_MESSAGE);
  assert.match(PDF_RATE_MESSAGE, /60 in 10 minutes/);
  assert.equal((await handlePdfPost(request({ template: "other", data: {} }), setup().deps)).status, 400);
});

const fileNameOf = (res: Response) => decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "");

test("file name: IBCode_NameSurname_Role_InfoBeans.pdf with the owner's IB code, the fallback name without one or on a failure", async () => {
  const asked: [string, string | null][] = [];
  const withCode = setup({ ownerIbCode: async (userId, versionId) => (asked.push([userId, versionId]), "ib1234") });
  assert.equal(fileNameOf(await handlePdfPost(request({ template: "internal", data: INTERNAL }), withCode.deps)), "ib1234_AshaRao_Engineer_InfoBeans.pdf");
  assert.deepEqual(asked, [["user-1", null]], "the signed-in user is the owner when no saved version is named");
  const version = "00000000-0000-4000-8000-000000000001";
  await handlePdfPost(request({ template: "internal", data: INTERNAL, versionId: version }), withCode.deps);
  assert.deepEqual(asked[1], ["user-1", version], "a saved version: its owner is looked up");
  const none = setup();
  assert.equal(fileNameOf(await handlePdfPost(request({ template: "external", data: EXTERNAL }), none.deps)), "AshaRao_Engineer_InfoBeans.pdf");
  const failing = setup({ ownerIbCode: async () => { throw new Error("teams down"); } });
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL }), failing.deps);
  assert.equal(res.status, 200);
  assert.equal(fileNameOf(res), "AshaRao_Engineer_InfoBeans.pdf");
});

test("a versionId that is not a version id is a bad request (before anything runs)", async () => {
  const { deps, calls } = setup();
  const res = await handlePdfPost(request({ template: "internal", data: INTERNAL, versionId: "../x" }), deps);
  assert.equal(res.status, 400);
  assert.deepEqual(calls, []);
});
