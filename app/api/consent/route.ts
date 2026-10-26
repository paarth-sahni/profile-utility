/**
 * Purpose: POST /api/consent — records, in the append-only audit_log, that the signed-in user ticked
 * "I confirm the information in this profile is accurate and may be shared" before submitting, downloading or
 * opening a profile in Google Docs. Metadata only (who, what, which template, which wording): no profile content
 * is sent or stored, so this works for external profiles too, which are never saved. The actor always comes from
 * the session, and the database insert policy only accepts a row naming the caller.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { consentAuditRow, parseConsentRequest } from "@/lib/consent";
import { allowRequest } from "@/lib/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!allowRequest(`consent:${user.id}`, 120, 10 * 60 * 1000)) {
    return err(429, "RATE_LIMITED", "Too many requests. Please wait a moment.");
  }

  let body: unknown;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10_000) return err(413, "TOO_LARGE", "That request is too large.");
    body = await request.json();
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  const req = parseConsentRequest(body);
  if (!req) return err(400, "BAD_REQUEST", "Please confirm the statement to continue.");

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("audit_log").insert(consentAuditRow(user.id, req));
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[consent] could not record consent");
    return err(500, "CONSENT_FAILED", "We could not record your confirmation. Please try again.");
  }
}
