import type { Metadata } from "next";
import LoginCard from "@/components/LoginCard";
import { LOGIN_ERRORS, safeNextPath } from "@/lib/authRules";

export const metadata: Metadata = {
  title: "Sign in — Profile Generator",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <LoginCard
        next={safeNextPath(next)}
        initialError={error ? (LOGIN_ERRORS[error] ?? LOGIN_ERRORS.failed) : null}
      />
    </main>
  );
}
