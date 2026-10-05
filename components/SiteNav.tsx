"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { INTERNAL_FORM_URL } from "@/lib/constants";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function SiteNav() {
  const pathname = usePathname();

  // Resolve the "home" for whichever route is currently browsing. Each route only
  // links to its own flow; the other is reachable only by knowing its URL.
  const home = pathname.startsWith("/external") ? "/external" : "/internal";
  const LINKS: { href: string; label: string; external?: boolean }[] = [
    { href: home, label: "Generator" },
    { href: `${home}/instructions`, label: "Instructions" },
    { href: "/style-guide", label: "Style Guide" },
    // The submission form only applies to the internal profile workflow.
    ...(home === "/internal" ? [{ href: INTERNAL_FORM_URL, label: "Submit Profile", external: true }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href={home} className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="h-[26px] w-auto sm:h-9" />
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map((link) => {
            if (link.external) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative rounded-md px-3 py-1.5 text-sm font-medium text-ink-light transition-colors hover:text-ink"
                >
                  {link.label}
                </a>
              );
            }
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "text-brand-500" : "text-ink-light hover:text-ink"
                }`}
              >
                {link.label}
                {active && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-brand-500" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
