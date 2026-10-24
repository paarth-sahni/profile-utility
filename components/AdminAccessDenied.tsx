/** Purpose: shown on /admin pages to signed-in users who are not administrators (the routes and the database refuse them too). */
import Link from "next/link";

export default function AdminAccessDenied() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-medium text-ink-dark">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm text-ink-light">Only administrators can manage the client-name registry.</p>
      <Link href="/profiles" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
        Go to My Profiles
      </Link>
    </main>
  );
}
