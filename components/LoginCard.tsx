"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function GoogleMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
    </span>
  );
}

export default function LoginCard({ next, initialError }: { next: string; initialError: string | null }) {
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // drive.file lets the app touch only files it creates itself (for "Open in Google Docs").
        // Supabase adds email/profile automatically. Add the same scope under Data Access in Google Cloud.
        scopes: "https://www.googleapis.com/auth/drive.file",
        redirectTo: `${window.location.origin}${BASE}/auth/callback?next=${encodeURIComponent(next)}`,
        // `hd` only pre-selects the InfoBeans Workspace in Google's picker; the server re-checks the domain.
        queryParams: { hd: "infobeans.com", prompt: "select_account" },
      },
    });
    if (err) {
      setError("We couldn't reach Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-up w-full max-w-md">
      <div className="mb-8 flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="h-10 w-auto" />
        <div className="text-2xl font-semibold text-ink">
          Profile <span className="text-brand-500">Generator</span>
        </div>
        <span className="h-0.5 w-16 rounded-full bg-brand-500" />
      </div>

      <section className="border border-hairline bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Sign in to Profile Generator</h1>
        <p className="mt-1 text-sm text-ink-light">Use your InfoBeans credentials to get in</p>

        {error && (
          <div role="alert" className="mt-4 border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-3 bg-brand-500 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              Redirecting to Google…
            </>
          ) : (
            <>
              <GoogleMark />
              Sign in with Google
            </>
          )}
        </button>

        <p className="mt-4 text-xs text-ink-light">
          Only @infobeans.com accounts can sign in. Trouble signing in? Contact your administrator.
        </p>
      </section>
    </div>
  );
}
