/**
 * Purpose: POST /api/compliance/check — the live check behind the red marks on the Edit step. Body: { template, data }.
 * Answers { enforced, violations } where each violation is { path, start, end, matchedText, types } for text the caller typed.
 * The registry list itself is never sent to the browser. Signed-in users only, rate-limited per user. When enforcement is off
 * ("enforced": false) nothing is checked and nothing is highlighted. When it is on and the registry cannot be loaded the answer is
 * 503 (the UI then blocks Preview, the same as the server gate does). This is advice for editing; the real gate is on
 * /api/pdf and /api/profiles. Nothing is stored and no profile content is logged.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toDto } from "@/lib/compliance/check";
import { checkProfile, complianceMode } from "@/lib/compliance/gate";
import { getRegistryMatcher } from "@/lib/compliance/registry";
import { RegistryUnavailableError } from "@/lib/compliance/registryCache";
import { allowRequest } from "@/lib/rateLimit";
import type { TemplateId } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200_000;
const TEMPLATES: readonly TemplateId[] = ["internal", "external"];

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!allowRequest(`compliance:${user.id}`, 240, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "Too many checks in a short time. Please wait a moment.");
  }

  let body: { template?: unknown; data?: unknown };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return err(413, "TOO_LARGE", "That profile is too large.");
    body = JSON.parse(raw);
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  if (!body || typeof body !== "object" || !TEMPLATES.includes(body.template as TemplateId) || typeof body.data !== "object" || body.data === null) {
    return err(400, "BAD_REQUEST", "Unknown profile type.");
  }

  try {
    const out = await checkProfile(body.data, { mode: complianceMode(), getMatcher: getRegistryMatcher });
    return NextResponse.json({ enforced: out.enforced, violations: out.violations.map(toDto) });
  } catch (e) {
    if (e instanceof RegistryUnavailableError) {
      return err(503, "REGISTRY_UNAVAILABLE", "The client-name check is not available right now.");
    }
    throw e;
  }
}
