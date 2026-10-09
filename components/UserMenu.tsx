"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type NavUser = { name: string; email: string; avatarUrl: string | null };

/** Up to two initials from a display name (falls back to the email's first letter). */
function initialsOf(user: NavUser): string {
  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? user.email[0] ?? "?").toUpperCase();
}

function Avatar({ user, size }: { user: NavUser; size: "sm" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const dim = size === "lg" ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";
  if (user.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dim} rounded-full object-cover`}
      />
    );
  }
  return (
    <span className={`${dim} flex items-center justify-center rounded-full bg-brand-500 font-semibold text-white`} aria-hidden>
      {initialsOf(user)}
    </span>
  );
}

export default function UserMenu({ user }: { user: NavUser }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 ring-1 ring-hairline transition hover:ring-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <Avatar user={user} size="sm" />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-light transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-up absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-xl border border-hairline bg-white shadow-lg"
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-light" title={user.email}>
                {user.email}
              </p>
            </div>
          </div>
          <div className="border-t border-hairline p-1.5">
            <Link
              href="/profiles"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-brand-50 hover:text-brand-600"
            >
              My Profiles
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-colors hover:bg-brand-50 hover:text-brand-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
