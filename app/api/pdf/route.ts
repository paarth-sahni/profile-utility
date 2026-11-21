/**
 * Purpose: POST /api/pdf — turns a profile into the PDF that Preview shows and Download PDF saves. Signed-in users
 * only, rate-limited per user. Body: { template, data, consent? }; the data must pass the strict schema and the "N/A"
 * check (the same gate as every export). When COMPLIANCE_ENFORCE=on an internal profile is first checked against the
 * client-name registry (422 COMPLIANCE, or 503 if the registry cannot be loaded); external profiles are not checked
 * (docs/COMPLIANCE.md). A download sends `consent: { action: "download", accepted: true }`, recorded only after every
 * check passed and the PDF was made. The Word template is filled exactly as in the browser and converted by LibreOffice
 * (lib/pdfRender.ts). The request logic and its order are in lib/pdfHandler.ts (tested with fakes); this file wires the
 * real parts. The file name carries the owner's IB code from the Teams data when there is one (lib/pdfOwner.ts; `versionId`
 * names a saved version, whose owner is read with the user's own session). Nothing is stored and no profile content is
 * logged; the response is not cached.
 */
import { getCurrentUser } from "@/lib/auth";
import { complianceGate } from "@/lib/compliance/registry";
import { consentAuditRow } from "@/lib/consent";
import { PDF_RATE_LIMIT, handlePdfPost } from "@/lib/pdfHandler";
import { versionOwnerEmailForLead } from "@/lib/db/teamProfiles";
import { ownerIbCodeWith } from "@/lib/pdfOwner";
import { renderProfilePdf } from "@/lib/pdfRender";
import { allowRequest } from "@/lib/rateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accessFor } from "@/lib/teamAccess";
import { teams } from "@/lib/teamsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePdfPost(request, {
    getUserId: async () => (await getCurrentUser())?.id ?? null,
    allow: (userId) => allowRequest(`pdf:${userId}`, PDF_RATE_LIMIT.max, PDF_RATE_LIMIT.windowMs),
    gate: complianceGate,
    render: renderProfilePdf,
    recordDownloadConsent: async (userId, template) => {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("audit_log").insert(consentAuditRow(userId, { template, action: "download", accepted: true }));
      if (error) throw error;
    },
    ownerIbCode: (_userId, versionId) =>
      ownerIbCodeWith(
        {
          userEmail: async () => (await getCurrentUser())?.email ?? null,
          versionOwnerEmail: async (id) => {
            const supabase = await createSupabaseServerClient();
            const { data } = await supabase
              .from("profile_versions")
              .select("profile:profiles!profile_versions_profile_id_fkey(owner:app_users!profiles_owner_id_fkey(email))")
              .eq("id", id)
              .maybeSingle();
            const profile = data?.profile as unknown as { owner?: { email?: string | null } | null } | null;
            if (profile?.owner?.email) return profile.owner.email;
            // a lead may download profiles RLS does not show them (/profile/<ib_code>): the owner through the lead reads
            const user = await getCurrentUser();
            return user ? versionOwnerEmailForLead(await accessFor(user, teams), id) : null;
          },
          teams,
        },
        versionId,
      ),
  });
}
