/**
 * Purpose: entry point for server-side data access (saveVersion, getVersion, listMyProfiles, ...),
 * added in later commits. Every function here builds a user-session client via
 * createSupabaseServerClient(), so RLS applies. Server-only: never import from client components.
 */
import "server-only";

export { createSupabaseServerClient } from "@/lib/supabase/server";
