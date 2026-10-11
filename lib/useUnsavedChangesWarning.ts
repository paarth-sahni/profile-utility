"use client";

/**
 * Purpose: warns before the user loses unsaved work. While `dirty` is true it
 *  1. sets a `beforeunload` handler (refresh, close tab, typing a new address, leaving the site), and
 *  2. intercepts clicks on in-app links (Next <Link> navigations do not fire `beforeunload`) and asks
 *     for confirmation with window.confirm; "Cancel" stops the navigation.
 * Not covered: the browser Back/Forward buttons inside the app (no reliable hook for them in the App Router).
 */
import { useEffect } from "react";
import { isInAppNavigation } from "./unsavedGuard";

export const UNSAVED_MESSAGE = "You have unsaved changes. If you leave this page they will be lost. Leave anyway?";

/** Installs the warning while `dirty` is true; removes it when false or on unmount. */
export function useUnsavedChangesWarning(dirty: boolean, message: string = UNSAVED_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return;

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
      if (leaving && !window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}
