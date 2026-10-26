/** Purpose: shown on /manage pages to signed-in users whose role is not manager or admin (the data layer says 403 too). */
import Link from "next/link";

export default function ManageAccessDenied() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-medium text-ink-dark">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-ink-light">Only managers and admins can search all profiles.</p>
      <Link href="/profiles" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
        Go to My Profiles
      </Link>
    </main>
  );
}
