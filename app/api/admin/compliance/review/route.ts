/**
 * Purpose: POST /api/admin/compliance/review — an administrator decides about a registry name that has disappeared from the
 * sheet: "keep" (it stays enforced), "deactivate" (it is no longer enforced) or "reactivate". Removal is never automatic.
 * Administrators only: checked here AND inside the database function, which audits the decision. Runs as the signed-in user, so
 * no service key is involved. Body: { nameId, decision, note? }.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAdministerRegistry } from "@/lib/authRules";
import { resetRegistryCache } from "@/lib/compliance/registry";
import { allowRequest } from "@/lib/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });
const DECISIONS = ["keep", "deactivate", "reactivate"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return err(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (!canAdministerRegistry(user.role)) return err(403, "FORBIDDEN", "Only an administrator can review registry names.");
  if (!allowRequest(`registry-review:${user.id}`, 60, 10 * 60 * 1000)) return err(429, "RATE_LIMITED", "Too many requests. Please wait a moment.");

  let body: { nameId?: unknown; decision?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return err(400, "BAD_REQUEST", "We could not read that request.");
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (typeof body.nameId !== "string" || !UUID.test(body.nameId) || !DECISIONS.includes(body.decision as (typeof DECISIONS)[number])) {
    return err(400, "BAD_REQUEST", "That decision could not be recorded.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("compliance_review_name", { p_name_id: body.nameId, p_decision: body.decision, p_note: note || null });
  if (error) {
    if (error.code === "42501") return err(403, "FORBIDDEN", "Only an administrator can review registry names.");
    if (error.code === "P0002") return err(404, "NOT_FOUND", "That name was not found.");
    if (error.code === "22023") return err(400, "BAD_REQUEST", "That decision does not apply to this name now.");
    console.error("[registry-review] failed");
    return err(500, "FAILED", "We could not record that decision. Please try again.");
  }
  resetRegistryCache();
  return NextResponse.json({ ok: true });
}
