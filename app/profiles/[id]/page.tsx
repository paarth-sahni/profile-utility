import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import GoogleDocsForVersion from "@/components/GoogleDocsForVersion";
import MarkPrimaryButton, { PrimaryBadge } from "@/components/MarkPrimaryButton";
import PageHero from "@/components/PageHero";
import ProfilePreview from "@/components/ProfilePreview";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { getMyProfile, getVersion } from "@/lib/db/profiles";
import { profileDisplayName } from "@/lib/docxReady";

export const metadata: Metadata = { title: "Profile — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mine = await getMyProfile(id);
  if (!mine) notFound(); // missing OR somebody else's: same answer, nothing leaked

  const { profile, versions, latestVersionId } = mine;
  const googleDocs = canUseGoogleDocs((await getCurrentUser())?.role); // managers and admins only
  const loaded = await Promise.all(versions.map((v) => getVersion(v.id)));
  const byId = new Map(versions.map((v, i) => [v.id, loaded[i]]));
  const latest = latestVersionId ? byId.get(latestVersionId) ?? loaded[0] : loaded[0];
  const home = profile.template === "internal" ? "/internal" : "/external";

  return (
    <div className="w-full text-ink">
      <PageHero
        title={profileDisplayName(profile.candidateName, profile.jobTitle)}
        subtitle={`${profile.template === "internal" ? "Internal" : "External"} profile · ${profile.versionCount} ${profile.versionCount === 1 ? "version" : "versions"}`}
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/profiles" className="text-sm font-medium text-brand-600 hover:underline">
              ← My Profiles
            </Link>
            {profile.template === "internal" && (profile.isPrimary ? <PrimaryBadge /> : <MarkPrimaryButton profileId={profile.id} />)}
          </div>
          {latestVersionId && (
            <Link
              href={`${home}?version=${latestVersionId}`}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              Open latest in editor
            </Link>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div>{latest ? <ProfilePreview template={latest.template} data={latest.data} /> : <p className="text-sm text-ink-light">This version could not be displayed.</p>}</div>

          <aside>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-light">Version history</h2>
            <ol className="space-y-3">
              {versions.map((v) => {
                const full = byId.get(v.id);
                return (
                  <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-ink-dark">
                        v{v.versionNo}
                        {v.label ? ` · ${v.label}` : ""}
                      </p>
                      {v.kind === "role_specific" && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Role-specific</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-light">{fmt(v.createdAt)}</p>
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <Link
                        href={`${home}?version=${v.id}`}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50"
                      >
                        Open in editor
                      </Link>
                      {full && <DownloadPdfButton template={full.template} data={full.data} versionId={v.id} />}
                      {full && googleDocs && <GoogleDocsForVersion template={full.template} data={full.data} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      </main>
    </div>
  );
}
