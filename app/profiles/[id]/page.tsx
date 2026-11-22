import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import MarkPrimaryButton, { PrimaryBadge } from "@/components/MarkPrimaryButton";
import ProfileViewLayout from "@/components/ProfileViewLayout";
import SavedProfileDocument from "@/components/SavedProfileDocument";
import { getMyProfile, getVersion } from "@/lib/db/profiles";

export const metadata: Metadata = { title: "Profile — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * One of my own profiles, laid out like every profile page (components/ProfileViewLayout.tsx): the document from the top, the
 * person's name in a rail that stays in view (with "Open latest in editor" and the version history under it), "← My Profiles" at
 * the top left, and Download PDF in the dock at the bottom right (it downloads the version shown, the latest).
 */
export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mine = await getMyProfile(id);
  if (!mine) notFound(); // missing OR somebody else's: same answer, nothing leaked

  const { profile, versions, latestVersionId } = mine;
  const loaded = await Promise.all(versions.map((v) => getVersion(v.id)));
  const byId = new Map(versions.map((v, i) => [v.id, loaded[i]]));
  const latest = latestVersionId ? byId.get(latestVersionId) ?? loaded[0] : loaded[0];
  const home = profile.template === "internal" ? "/internal" : "/external";

  return (
    <ProfileViewLayout
      backHref="/profiles"
      backLabel="My Profiles"
      name={profile.candidateName}
      role={profile.jobTitle}
      facts={[`${profile.template === "internal" ? "Internal" : "External"} profile · ${profile.versionCount} ${profile.versionCount === 1 ? "version" : "versions"}`]}
      badges={profile.template === "internal" ? (profile.isPrimary ? <PrimaryBadge /> : <MarkPrimaryButton profileId={profile.id} />) : undefined}
      rail={
        <div className="space-y-5">
          {latestVersionId && (
            <Link
              href={`${home}?version=${latestVersionId}`}
              className="block bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
            >
              Open latest in editor
            </Link>
          )}
          <section aria-labelledby="version-history">
            <h2 id="version-history" className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-light">
              Version history
            </h2>
            <ol className="space-y-3">
              {versions.map((v) => {
                const full = byId.get(v.id);
                return (
                  <li key={v.id} className="border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-ink-dark">
                        v{v.versionNo}
                        {v.label ? ` · ${v.label}` : ""}
                      </p>
                      {v.kind === "role_specific" && <span className="shrink-0 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Role-specific</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-light">{fmt(v.createdAt)}</p>
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      <Link href={`${home}?version=${v.id}`} className="border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50">
                        Open in editor
                      </Link>
                      {full && <DownloadPdfButton template={full.template} data={full.data} versionId={v.id} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      }
      actions={latest ? <DownloadPdfButton dock template={latest.template} data={latest.data} versionId={latestVersionId ?? versions[0]?.id ?? ""} /> : undefined}
    >
      {latest ? <SavedProfileDocument template={latest.template} data={latest.data} /> : <p className="text-sm text-ink-light">This version could not be displayed.</p>}
    </ProfileViewLayout>
  );
}
