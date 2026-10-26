/**
 * Purpose: /manage — name search over all profiles for managers and admins. Server-rendered; the search is a
 * plain GET form (?q=). Other roles see an access-denied view, and the data layer refuses them as well (403).
 */
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import ManageAccessDenied from "@/components/ManageAccessDenied";
import { PrimaryBadge } from "@/components/MarkPrimaryButton";
import PageHero from "@/components/PageHero";
import { getCurrentUser } from "@/lib/auth";
import { ForbiddenError, searchProfilesByName, type ManagedProfileSummary } from "@/lib/db/profiles";
import { profileDisplayName } from "@/lib/docxReady";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Manage profiles — Profile Generator" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/manage");
  if (user.role !== "manager" && user.role !== "admin") return <ManageAccessDenied />;

  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";

  let results: ManagedProfileSummary[] = [];
  let failed = false;
  try {
    results = await searchProfilesByName(q);
  } catch (e) {
    if (e instanceof ForbiddenError) return <ManageAccessDenied />;
    console.error("[manage] search failed");
    failed = true;
  }

  return (
    <div className="w-full text-ink">
      <PageHero title="Manage profiles" subtitle="Search team members by name. Each shows their primary profile. Read-only." compact />

      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5">
        <Form action="/manage" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="manage-q" className="mb-1 block text-xs font-medium text-ink-light">
              Team member name
            </label>
            <input
              id="manage-q"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={q}
              placeholder="e.g. Alex Sample"
              className="w-full border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
            Search
          </button>
        </Form>

        <div className="mt-5" aria-live="polite">
          {failed ? (
            <p className="border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">We could not run that search. Please try again.</p>
          ) : results.length === 0 ? (
            <div className="border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
              <p className="text-lg font-medium text-ink-dark">{q ? "No primary profiles match that name" : "No primary profiles yet"}</p>
              {q && <p className="mt-1 text-sm text-ink-light">Check the spelling, or try part of the name.</p>}
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-light">
                {q ? `${results.length} ${results.length === 1 ? "result" : "results"} for “${q}”` : "Most recently updated team members"}
              </p>
              <ul className="divide-y divide-hairline border border-gray-200 bg-white">
                {results.map((p) => (
                  <li key={p.id}>
                    <Link href={`/manage/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium text-ink-dark">
                          <span className="truncate">{profileDisplayName(p.candidateName, p.jobTitle)}</span>
                          {p.isPrimary && <PrimaryBadge />}
                        </p>
                        <p className="truncate text-xs text-ink-light">
                          owner {p.ownerName || p.ownerEmail || "unknown"}
                        </p>
                      </div>
                      <span className="text-xs text-ink-light">{fmt(p.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
