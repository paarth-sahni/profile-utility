/**
 * Purpose: shown instead of the generic 404 when a saved profile does not exist or the signed-in user may not see it
 * (app/profiles/[id]/not-found.tsx and app/manage/[id]/not-found.tsx). Both cases get the same words, so nothing
 * leaks about whether someone else's profile exists.
 */
import Link from "next/link";

export const PROFILE_NOT_FOUND = "This profile doesn't exist or you don't have access to it";

export default function ProfileNotFound() {
  return (
    <div className="w-full text-ink">
      <main className="mx-auto w-full max-w-6xl px-4 py-16">
        <div data-profile-not-found className="border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <h1 className="text-lg font-medium text-ink-dark">{PROFILE_NOT_FOUND}</h1>
          <Link
            href="/profiles"
            className="mt-6 inline-block bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Go to My Profiles
          </Link>
        </div>
      </main>
    </div>
  );
}
