/**
 * Purpose: what the Review pages need to know about the current sign-in: the user's id (to tie local drafts to
 * the right person) and how much of the hard sign-in limit is left (for the expiry banner). Read through
 * auth.getUser(), which the auth server verifies. Cached per request. Server-only.
 */
import "server-only";
import { cache } from "react";
import { sessionExpired } from "@/lib/authRules";
import { sessionRemainingMs } from "@/lib/sessionExpiry";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SessionInfo {
  userId: string;
  /** Milliseconds left of the sign-in limit when the page was rendered. */
  remainingMs: number;
}

/** The current sign-in's id and time left, or null when signed out or already expired. */
export const getSessionInfo = cache(async (): Promise<SessionInfo | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u || sessionExpired(u.last_sign_in_at)) return null;
    return { userId: u.id, remainingMs: sessionRemainingMs(u.last_sign_in_at) };
  } catch {
    return null;
  }
});
