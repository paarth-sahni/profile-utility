/**
 * Purpose: the ONLY way server code gets a Supabase client. It is built from the signed-in user's
 * session cookies and the publishable key, so Row Level Security applies to every query.
 * The service-role key is never used here (seed/admin scripts only). Server-only.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Reads a required env var; throws a generic error (no values) if it is missing. */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[supabase] ${name} is not set`);
    throw new Error("Supabase is not configured.");
  }
  return value;
}

/** Creates a per-request Supabase client acting as the signed-in user (or as anon if signed out). */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // proxy.ts refreshes the session cookies on every request.
        }
      },
    },
  });
}
