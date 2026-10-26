/**
 * Purpose: /manage/[id] — read-only view of a team member's PRIMARY profile for managers and admins: the InfoBeans
 * document (same as Preview) of its current version, nothing else (no version history, no other profiles: those are a
 * later feature). Any other profile id answers 404. No editing; Download PDF and (for managers / admins) Open in
 * Google Docs export what is shown.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import GoogleDocsForVersion from "@/components/GoogleDocsForVersion";
import ManageAccessDenied from "@/components/ManageAccessDenied";
import { PrimaryBadge } from "@/components/MarkPrimaryButton";
import PageHero from "@/components/PageHero";
import SavedProfileDocument from "@/components/SavedProfileDocument";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { ForbiddenError, getProfileForManager, getVersionForManager } from "@/lib/db/profiles";
import { profileDisplayName } from "@/lib/docxReady";

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
  const shown = latestVersionId ? await getVersionForManager(latestVersionId) : null;

  return (
    <div className="w-full text-ink">
      <PageHero
        title={profileDisplayName(profile.candidateName, profile.jobTitle)}
        subtitle={`Primary profile · owner ${profile.ownerName || profile.ownerEmail || "unknown"} · read-only`}
        compact
      />

      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <Link href="/manage" className="text-sm font-medium text-brand-600 hover:underline">
            ← Manage profiles
          </Link>
          <PrimaryBadge />
        </div>

        {shown ? (
          <>
            {/* Read-only: exports are made from the version shown; nothing is changed or saved. */}
            <div className="mb-4 flex flex-wrap items-start gap-2">
              <DownloadPdfButton template={shown.template} data={shown.data} versionId={shown.meta.versionId} />
              {canUseGoogleDocs(user.role) && <GoogleDocsForVersion template={shown.template} data={shown.data} accountEmail={user.email} />}
            </div>
            <SavedProfileDocument template={shown.template} data={shown.data} />
          </>
        ) : (
          <p className="text-sm text-ink-light">This profile could not be displayed.</p>
        )}
      </main>
    </div>
  );
}
