/**
 * Purpose: the request logic of POST /api/pdf, with its parts passed in so the order can be tested with fakes and no
 * LibreOffice (lib/pdfHandler.test.ts); app/api/pdf/route.ts wires the real session, rate limit, gate, renderer and audit
 * insert. The order:
 *   1. signed in (401), rate limit (429), body readable and a known template (400 / 413)
 *   2. the strict check: required fields and "N/A" placeholders (422 INCOMPLETE with `fields: [{ path, message }]`)
 *   3. the client-name gate (422 COMPLIANCE / 503; internal profiles only)
 *   4. the PDF is made (503 when LibreOffice is missing, 500 when it fails)
 *   5. a download (body `consent: { action: "download", accepted: true }`): the consent row is written, only now, after
 *      every check passed and the file exists; if that fails the PDF is not sent (500 CONSENT_FAILED)
 *   6. the file name: IBCode_NameSurname_Role_InfoBeans.pdf with the profile OWNER's IB code (the signed-in user, or the owner of the
 *      saved version named by `versionId`), looked up on the server; NameSurname_Role_InfoBeans.pdf without one or on any failure
 * A preview (no `consent`) records nothing. Nothing is stored and no profile content is logged.
 */
import { checkReadyForDocx, pdfFileName } from "./docxReady";
import type { ResumeData, TemplateId } from "./schemas";

export type PdfDeps = {
  getUserId: () => Promise<string | null>;
  /** The per-user rate limit: false when the user made too many PDFs recently. */
  allow: (userId: string) => boolean;
  gate: (template: TemplateId, data: unknown) => Promise<Response | null>;
  render: (template: TemplateId, data: ResumeData) => Promise<Uint8Array>;
  /** Writes the download consent row for the user; throws on failure. */
  recordDownloadConsent: (userId: string, template: TemplateId) => Promise<void>;
  /** The IB code of the profile's owner (the user, or the owner of `versionId`), or null; may fail (the name falls back). */
  ownerIbCode: (userId: string, versionId: string | null) => Promise<string | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PDF_RATE_LIMIT = { max: 60, windowMs: 10 * 60 * 1000 };
export const PDF_RATE_MESSAGE = "You have made a lot of PDFs in a short time (the limit is 60 in 10 minutes). Please wait a few minutes and try again.";

const MAX_BODY_BYTES = 200_000;
const TEMPLATES: readonly TemplateId[] = ["internal", "external"];

const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/** True for a missing consent (a preview) or the one accepted form for a download; anything else is a bad request. */
const consentOf = (value: unknown): "none" | "download" | "bad" => {
  if (value === undefined) return "none";
  const c = value as { action?: unknown; accepted?: unknown } | null;
  return c && typeof c === "object" && c.action === "download" && c.accepted === true ? "download" : "bad";
};

export async function handlePdfPost(request: Request, deps: PdfDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!deps.allow(userId)) return err(429, "RATE_LIMITED", PDF_RATE_MESSAGE);

  let body: { template?: unknown; data?: unknown; consent?: unknown; versionId?: unknown };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    body = JSON.parse(raw);
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  if (!body || typeof body !== "object" || !TEMPLATES.includes(body.template as TemplateId)) {
    return err(400, "BAD_REQUEST", "Unknown profile type.");
  }
  if (body.versionId !== undefined && !(typeof body.versionId === "string" && UUID.test(body.versionId))) return err(400, "BAD_REQUEST", "Unknown profile version.");
  const consent = consentOf(body.consent);
  if (consent === "bad") return err(400, "BAD_REQUEST", "Please confirm the statement to continue.");
  const template = body.template as TemplateId;
  const ready = checkReadyForDocx(template, body.data as ResumeData);
  if (!ready.ok) return Response.json({ error: { code: "INCOMPLETE", message: ready.message, fields: ready.issues } }, { status: 422 });
  // the client-name rule (internal profiles): one naming a registered client, company or project is refused here, whatever the browser did
  const blocked = await deps.gate(template, ready.data);
  if (blocked) return blocked;

  let pdf: Uint8Array;
  try {
    pdf = await deps.render(template, ready.data);
  } catch (e) {
    const thrown = (e as { code?: unknown } | null)?.code; // PdfError carries CONVERTER_MISSING / CONVERSION_FAILED / TEMPLATE_FAILED
    const code = typeof thrown === "string" ? thrown : "CONVERSION_FAILED";
    console.error(`[pdf] could not make the PDF (${code})`); // the code only: never the profile or the converter's output
    if (code === "CONVERTER_MISSING") return err(503, code, "PDF creation is not available on this server right now. Please contact support.");
    return err(500, code, "We could not create the PDF. Please try again.");
  }
  if (consent === "download") {
    try {
      await deps.recordDownloadConsent(userId, template);
    } catch {
      console.error("[pdf] could not record consent");
      return err(500, "CONSENT_FAILED", "We could not record your confirmation. Please try again.");
    }
  }
  let ibCode: string | null = null;
  try {
    ibCode = await deps.ownerIbCode(userId, (body.versionId as string | undefined) ?? null);
  } catch {
    ibCode = null; // the Teams data is optional: the name falls back
  }
  const name = pdfFileName(ready.data, ibCode);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
