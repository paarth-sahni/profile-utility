"use client";

/**
 * Purpose: protects unsaved work. While `dirty` is true it
 *  1. sets a `beforeunload` handler: the browser's own prompt for refresh, closing the tab, typing a new address and
 *     leaving the site (that prompt cannot be styled, so it stays native), and
 *  2. intercepts clicks on in-app links (Next <Link> navigations do not fire `beforeunload`): the click is stopped and
 *     the target is returned as `pendingHref`, so the caller can show its own branded dialog and then call `leave()`
 *     (navigate there) or `stay()` (forget it).
 * Not covered: the browser Back/Forward buttons inside the app (no reliable hook for them in the App Router).
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isInAppNavigation, toRouterPath } from "./unsavedGuard";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface LeaveGuard {
  /** The link the user tried to follow while there is unsaved work, or null. */
  pendingHref: string | null;
  /** The user chose to stay: forget the link. */
  stay: () => void;
  /** The user chose to leave anyway: go to the link. */
  leave: () => void;
}

/** Installs the guard while `dirty` is true; removes it when false or on unmount. */
export function useUnsavedChangesWarning(dirty: boolean): LeaveGuard {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) {
      setPendingHref(null);
      return;
    }

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required by some browsers; the text itself is never shown
    };

    // Capture phase on `document` runs before React's handlers on the root, so stopPropagation() also
    // stops Next's <Link> from navigating.
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const leaving = isInAppNavigation(
        {
          href: anchor.href,
          target: anchor.getAttribute("target"),
          download: anchor.hasAttribute("download"),
          button: e.button,
          modifier: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey,
          defaultPrevented: e.defaultPrevented,
        },
        window.location.href,
      );
      if (!leaving) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(anchor.href);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const stay = useCallback(() => setPendingHref(null), []);
  const leave = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (!href) return;
    const path = toRouterPath(href, window.location.href, BASE_PATH);
    if (path) router.push(path);
    else window.location.assign(href);
  }, [pendingHref, router]);

  return { pendingHref, stay, leave };
}
