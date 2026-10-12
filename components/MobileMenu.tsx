"use client";

/**
 * Purpose: the phone navigation. A menu button opens a left sidebar (drawer) with the same links as the desktop header,
 * so the header itself can stay clean: menu button, app title, profile icon. Closes on backdrop tap, Esc, a link tap
 * or any page change; locks page scrolling while open; returns focus to the menu button.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
}

export default function MobileMenu({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const openBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  // a page change closes the drawer
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const button = openBtn.current;
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={openBtn}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-drawer"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {/* In a portal: the header's backdrop blur would otherwise make "fixed" relative to the header. */}
      {open &&
        createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside
            id="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="drawer-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="h-9 w-auto" />
              <button
                ref={closeBtn}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-light transition hover:bg-brand-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              <ul className="space-y-1">
                {links.map((link) => {
                  const active = !link.external && pathname === link.href;
                  const cls = `flex items-center rounded-lg px-4 py-3 text-base font-medium transition-colors ${
                    active ? "bg-brand-50 text-brand-600" : "text-ink hover:bg-gray-50"
                  }`;
                  return (
                    <li key={link.href}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className={cls} aria-current={active ? "page" : undefined}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        </div>,
          document.body,
        )}
    </>
  );
}
