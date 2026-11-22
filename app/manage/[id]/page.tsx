/**
 * Purpose: /manage/[id] — read-only view of a team member's PRIMARY profile for managers and admins: the InfoBeans
 * document (same as Preview) of its current version, nothing else (no version history, no other profiles: those are a
 * later feature). Any other profile id answers 404. No editing; Download PDF and (for managers / admins) Open in
 * Google Docs, in the fixed action bar at the bottom right, export what is shown. Laid out like every profile page
 * (components/ProfileViewLayout.tsx): the document from the top, the person's name in a rail that stays in view.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import GoogleDocsForVersion from "@/components/GoogleDocsForVersion";
import ManageAccessDenied from "@/components/ManageAccessDenied";
import { PrimaryBadge } from "@/components/MarkPrimaryButton";
import ProfileViewLayout from "@/components/ProfileViewLayout";
import SavedProfileDocument from "@/components/SavedProfileDocument";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { ForbiddenError, getProfileForManager, getVersionForManager } from "@/lib/db/profiles";
import { ibCodeOf } from "@/lib/ownerCodes";
import { teams } from "@/lib/teamsClient";

export const metadata: Metadata = { title: "Profile (read-only) — Profile Generator" };
export const dynamic = "force-dynamic";

export default async function ManageProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/manage/${id}`)}`);
  if (user.role !== "manager" && user.role !== "admin") return <ManageAccessDenied />;

  let found: Awaited<ReturnType<typeof getProfileForManager>>;
  try {
    found = await getProfileForManager(id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <ManageAccessDenied />;
    throw e;
  }
  if (!found) notFound(); // missing, or not the member's primary profile
  const { profile, latestVersionId } = found;
  const [shown, ibCode] = await Promise.all([latestVersionId ? getVersionForManager(latestVersionId) : null, ibCodeOf(teams, profile.ownerEmail)]);
  const owner = profile.ownerName || profile.ownerEmail || "unknown";

  return (
    <ProfileViewLayout
      backHref="/manage?tab=search"
      backLabel="Profile Hub"
      name={profile.candidateName}
      role={profile.jobTitle}
      facts={[...(ibCode ? [`IB code ${ibCode}`] : []), `Owner: ${owner}`, "Primary profile · read-only"]}
      badges={<PrimaryBadge />}
      // Read-only: exports are made from the version shown; nothing is changed or saved.
      actions={
        shown ? (
          <>
            {canUseGoogleDocs(user.role) && <GoogleDocsForVersion dock template={shown.template} data={shown.data} accountEmail={user.email} />}
            <DownloadPdfButton dock template={shown.template} data={shown.data} versionId={shown.meta.versionId} />
          </>
        ) : undefined
      }
    >
      {shown ? <SavedProfileDocument template={shown.template} data={shown.data} /> : <p className="text-sm text-ink-light">This profile could not be displayed.</p>}
    </ProfileViewLayout>
  );
}
