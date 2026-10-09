/**
 * Purpose: the app's login API for server code (pages, route handlers, server actions).
 *   getCurrentUser() -> { id, email, role } or null when signed out / expired / not an InfoBeans account
 *   requireUser()    -> same, but redirects to /login when signed out
 * The role is read from public.app_users through the caller's own session (RLS applies). It is never
 * taken from the JWT or user_metadata, which a user could influence. Pure rules live in lib/authRules.ts
 * (use that file from proxy.ts, client components and tests). Server-only.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail, sessionExpired } from "@/lib/authRules";

export * from "@/lib/authRules";

export type AppRole = Database["public"]["Enums"]["app_role"];

export interface CurrentUser {
  id: string;
  email: string;
  role: AppRole;
}

/** The signed-in user, or null. Cached per request, so calling it many times costs one lookup. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser(); // verified with the auth server, not just decoded
    if (!user?.email || !isAllowedEmail(user.email) || sessionExpired(user.last_sign_in_at)) return null;
    const { data } = await supabase.from("app_users").select("role").eq("id", user.id).maybeSingle();
    if (!data) return null;
    return { id: user.id, email: user.email, role: data.role };
  } catch {
    return null;
  }
});

/** Like getCurrentUser(), but sends signed-out visitors to /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
