/**
 * Purpose: POST /api/profiles — saves a new version of the signed-in user's INTERNAL profile.
 * External (client-facing) profiles are never stored: template "external" is refused with 400 EXTERNAL_NOT_SAVED.
 * With COMPLIANCE_ENFORCE=on the content is checked against the client-name registry first (422 COMPLIANCE / 503).
 * A Submit also carries the consent tick, which is recorded only after those checks pass (never before a refusal).
 * Ownership comes from the session, never from the request body. Errors are generic and nothing about
 * the profile content is logged. The request logic is in lib/profilesHandler.ts (tested with fakes); this file wires the real parts.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { complianceGate, sanitizeSaveMetadata } from "@/lib/compliance/registry";
import { consentAuditRow } from "@/lib/consent";
import { ExternalNotSavedError, ProfileNotFoundError, saveVersion } from "@/lib/db/profiles";
import { handleProfilesPost } from "@/lib/profilesHandler";
import { allowRequest } from "@/lib/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  return handleProfilesPost(request, {
    getUserId: async () => (await getCurrentUser())?.id ?? null,
    allow: (userId) => allowRequest(`save:${userId}`, 60, 10 * 60 * 1000),
    gate: complianceGate,
    sanitize: sanitizeSaveMetadata,
    recordConsent: async (userId) => {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("audit_log").insert(consentAuditRow(userId, { template: "internal", action: "submit", accepted: true }));
      if (error) throw error;
    },
    save: saveVersion,
    saveError: (e) => {
      if (e instanceof ExternalNotSavedError) return err(400, "EXTERNAL_NOT_SAVED", "External profiles are not saved. Download the PDF instead.");
      if (e instanceof ProfileNotFoundError) return err(404, "NOT_FOUND", "We could not find that profile.");
      return null;
    },
  });
}
