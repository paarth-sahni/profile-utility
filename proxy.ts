/**
 * Purpose: runs before protected routes. Refreshes the Supabase session cookies and enforces sign-in:
 * pages redirect to /login, /api/extract answers 401. Public pages (instructions, style guide) are not matched.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_AFTER_LOGIN, safeNextPath, sessionExpired } from "@/lib/authRules";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() verifies the token with the auth server (unlike getSession()).
  const {
    data: { user: rawUser },
  } = await supabase.auth.getUser();

  // Hard 1-hour limit: refresh tokens would otherwise keep a session alive indefinitely.
  let user = rawUser;
  let expired = false;
  if (rawUser && sessionExpired(rawUser.last_sign_in_at)) {
    await supabase.auth.signOut(); // clears the cookies on `response`
    user = null;
    expired = true;
  }

  /** Redirect that keeps the cookie changes (e.g. sign-out) made on `response`. */
  const redirectTo = (url: URL) => {
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  const { pathname, search } = request.nextUrl;

  if (pathname === "/login") {
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = safeNextPath(request.nextUrl.searchParams.get("next"), DEFAULT_AFTER_LOGIN);
      url.search = "";
      return redirectTo(url);
    }
    if (expired) {
      const url = request.nextUrl.clone();
      url.search = "?error=session";
      return redirectTo(url);
    }
    return response;
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Your session has expired. Please sign in again." } }, { status: 401 });
      response.cookies.getAll().forEach((c) => res.cookies.set(c));
      return res;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?${expired ? "error=session&" : ""}next=${encodeURIComponent(pathname + search)}`;
    return redirectTo(url);
  }

  return response;
}

export const config = {
  matcher: ["/login", "/internal", "/external", "/profiles/:path*", "/api/extract", "/api/profiles"],
};
