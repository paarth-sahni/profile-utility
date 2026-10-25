/** Purpose: POST /auth/signout — ends the session and returns to /login. */
import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/publicOrigin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", publicOrigin(request.headers, request.nextUrl.origin)), { status: 303 });
}
