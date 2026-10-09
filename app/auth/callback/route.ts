/**
 * Purpose: OAuth return point. Exchanges the Google code for a session, then enforces the InfoBeans
 * domain (defence in depth on top of the DB trigger). Any failure ends at /login with a friendly error.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, safeNextPath } from "@/lib/authRules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const fail = (code: string) => NextResponse.redirect(`${origin}/login?error=${code}`);

  if (searchParams.get("error")) return fail(searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = searchParams.get("code");
  if (!code) return fail("failed");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail("failed");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAllowedEmail(user?.email)) {
    await supabase.auth.signOut();
    return fail("domain");
  }

  return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get("next"))}`);
}
