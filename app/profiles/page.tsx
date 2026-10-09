import type { Metadata } from "next";
import Link from "next/link";
import { listMyProfiles } from "@/lib/db/profiles";

export const metadata: Metadata = { title: "My Profiles — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function ProfilesPage() {
  const profiles = await listMyProfiles();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-dark">My Profiles</h1>
          <p className="mt-1 text-sm text-ink-light">Profiles you have saved. Only you can see them.</p>
        </div>
        <Link href="/internal" className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
          New profile
        </Link>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <p className="text-lg font-semibold text-ink-dark">No saved profiles yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-light">
            Upload a resume or start from a blank form, then choose <strong>Save to My Profiles</strong> on the Review
            step. It will show up here.
          </p>
          <Link href="/internal" className="mt-6 inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
            Create your first profile
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/profiles/${p.id}`}
                className="block h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.template === "internal" ? "bg-cream text-ink" : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    {p.template === "internal" ? "Internal" : "External"}
                  </span>
                  <span className="text-xs text-ink-light">{fmt(p.updatedAt)}</span>
                </div>
                <p className="truncate text-lg font-semibold text-ink-dark">{p.candidateName || "Untitled profile"}</p>
                <p className="mt-1 text-sm text-ink-light">
                  {p.versionCount} {p.versionCount === 1 ? "version" : "versions"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
