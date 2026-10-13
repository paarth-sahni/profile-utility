/**
 * Purpose: /manage/[id] — read-only view of any profile for managers and admins: its version history and a
 * preview of the chosen version (?v=<versionId>, default: the current one). No editing; Download PDF and (for
 * managers / admins) Open in Google Docs export the version shown.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import GoogleDocsForVersion from "@/components/GoogleDocsForVersion";
import ManageAccessDenied from "@/components/ManageAccessDenied";
import PageHero from "@/components/PageHero";
import ProfilePreview from "@/components/ProfilePreview";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { ForbiddenError, getProfileForManager, getVersionForManager } from "@/lib/db/profiles";

export const metadata: Metadata = { title: "Profile (read-only) — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ManageProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/manage/${id}`)}`);
  if (user.role !== "manager" && user.role !== "admin") return <ManageAccessDenied />;

  const rawV = (await searchParams).v;
  const wanted = Array.isArray(rawV) ? rawV[0] : rawV;

  let found: Awaited<ReturnType<typeof getProfileForManager>>;
  try {
    found = await getProfileForManager(id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <ManageAccessDenied />;
    throw e;
  }
  if (!found) notFound();
  const { profile, versions, latestVersionId } = found;

  // Only versions that belong to this profile can be shown.
  const shownId = versions.find((v) => v.id === wanted)?.id ?? latestVersionId;
  const shown = shownId ? await getVersionForManager(shownId) : null;

  return (
    <div className="w-full text-ink">
      <PageHero
        title={profile.candidateName || "Untitled profile"}
        subtitle={`${profile.template === "internal" ? "Internal" : "External"} profile · ${profile.versionCount} ${profile.versionCount === 1 ? "version" : "versions"} · owner ${profile.ownerName || profile.ownerEmail || "unknown"} · read-only`}
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <Link href="/manage" className="mb-8 inline-block text-sm font-medium text-brand-600 hover:underline">
          ← Manage profiles
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div>
            {shown ? (
              <>
                {/* Read-only: exports are made from the version you are viewing; nothing is changed or saved. */}
                <div className="mb-4 flex flex-wrap items-start gap-2">
                  <DownloadPdfButton template={shown.template} data={shown.data} versionId={shown.meta.versionId} />
                  {canUseGoogleDocs(user.role) && <GoogleDocsForVersion template={shown.template} data={shown.data} />}
                </div>
                <ProfilePreview template={shown.template} data={shown.data} />
              </>
            ) : (
              <p className="text-sm text-ink-light">This version could not be displayed.</p>
            )}
          </div>
          <aside>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-light">Version history</h2>
            <ol className="space-y-3">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/manage/${profile.id}?v=${v.id}`}
                    aria-current={v.id === shownId ? "true" : undefined}
                    className={`block rounded-xl border bg-white p-4 hover:border-brand-300 ${v.id === shownId ? "border-brand-500" : "border-gray-200"}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-ink-dark">
                        v{v.versionNo}
                        {v.label ? ` · ${v.label}` : ""}
                      </p>
                      {v.kind === "role_specific" && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Role-specific</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-light">{fmt(v.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </main>
    </div>
  );
}
