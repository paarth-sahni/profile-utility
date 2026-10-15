"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import MobileMenu, { isActiveLink, type NavLink } from "@/components/MobileMenu";
import ProfileGeneratorMark from "@/components/ProfileGeneratorMark";
import UserMenu, { type NavUser } from "@/components/UserMenu";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function SiteNav({ user }: { user?: NavUser | null }) {
  const pathname = usePathname();
  const onLogin = pathname === "/login";

  // Resolve the "home" for whichever route is currently browsing. Each route only
  // links to its own flow; the other is reachable only by knowing its URL.
  const home = pathname.startsWith("/external") ? "/external" : "/internal";
  // ProfileHub (the managers' page, /manage) is shown to managers and admins only, first in their header; the server
  // refuses everyone else as well. Managers: ProfileHub | Generator | My Profiles | Instructions.
  const canManage = user?.role === "manager" || user?.role === "admin";
  const LINKS: NavLink[] = canManage
    ? [
        { href: "/manage", label: "ProfileHub" },
        { href: home, label: "Generator" },
        { href: "/profiles", label: "My Profiles" },
        { href: `${home}/instructions`, label: "Instructions" },
      ]
    : [
        { href: home, label: "Generator" },
        { href: `${home}/instructions`, label: "Instructions" },
        { href: "/profiles", label: "My Profiles" },
      ];

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
      {/* Phones: menu button (opens a left sidebar), app title, profile icon. Nothing else. */}
      <div className="flex items-center gap-2 px-3 py-2.5 md:hidden">
        {onLogin ? (
          <Link href={home} className="mx-auto flex items-center py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="h-9 w-auto" />
          </Link>
        ) : (
          <>
            <MobileMenu links={LINKS} />
            <Link href={home} className="flex min-w-0 flex-1 items-center gap-2">
              <ProfileGeneratorMark className="h-8 w-8 shrink-0" />
              <span className="truncate text-base font-medium text-ink">
                <span className="text-brand-500">Profile Generator</span>
              </span>
            </Link>
            {user && <UserMenu user={user} />}
          </>
        )}
      </div>

      {/* Larger screens: logo, links and profile menu in one row. */}
      <nav className="mx-auto hidden max-w-6xl items-center justify-between px-4 py-3 md:flex">
        <Link href={home} className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="h-12 w-auto" />
        </Link>
        <div className="flex items-center gap-1">
          {!onLogin &&
            LINKS.map((link) => {
              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative px-3 py-1.5 text-sm font-medium text-ink-light transition-colors hover:text-ink"
                  >
                    {link.label}
                  </a>
                );
              }
              const active = isActiveLink(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? "text-brand-500" : "text-ink-light hover:text-ink"
                  }`}
                >
                  {link.label}
                  {active && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 bg-brand-500" />}
                </Link>
              );
            })}
          {user && !onLogin && (
            <div className="ml-3 border-l border-hairline pl-3">
              <UserMenu user={user} />
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
