import type { Metadata } from "next";
import Link from "next/link";
import MarkPrimaryButton, { PrimaryBadge } from "@/components/MarkPrimaryButton";
import PageHero from "@/components/PageHero";
import { listMyProfiles } from "@/lib/db/profiles";
import { profileDisplayName } from "@/lib/docxReady";

export const metadata: Metadata = { title: "My Profiles — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function ProfilesPage() {
  const profiles = await listMyProfiles();

  return (
    <div className="w-full text-ink">
      <PageHero
        title="My Profiles"
        compact
        action={
          <Link href="/internal" className="bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
            Create new profile
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4">

        {profiles.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium text-ink-dark">No saved profiles yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-light">
              Upload a resume or start from a blank form, then choose <strong>Submit</strong> on the Preview &amp; Submit step. It will show
              up here.
            </p>
            <Link href="/internal" className="mt-6 inline-block bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
              Create your first profile
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => (
              <li
                key={p.id}
                data-profile-card={p.id}
                className="flex h-full flex-col border border-gray-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <Link href={`/profiles/${p.id}`} className="block flex-1 p-5 pb-3">
                  <div className="mb-3 flex min-h-[1.375rem] items-center justify-between gap-2">
                    <span>{p.isPrimary && <PrimaryBadge />}</span>
                    <span className="text-xs text-ink-light">{fmt(p.updatedAt)}</span>
                  </div>
                  <p
                    className="line-clamp-2 break-words text-base font-medium leading-snug text-ink-dark"
                    title={profileDisplayName(p.candidateName, p.jobTitle)}
                  >
                    {profileDisplayName(p.candidateName, p.jobTitle)}
                  </p>
                  <p className="mt-1 text-sm text-ink-light">
                    {p.versionCount} {p.versionCount === 1 ? "version" : "versions"}
                  </p>
                </Link>
                {!p.isPrimary && (
                  <div className="px-5 pb-4">
                    <MarkPrimaryButton profileId={p.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
