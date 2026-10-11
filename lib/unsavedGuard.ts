/**
 * Purpose: pure decision logic for the unsaved-changes guard: is there unsaved work (hasUnsavedWork), and does
 * this link click leave the current page inside the app, so we must ask first (isInAppNavigation)? Kept free of DOM/React so it is unit-tested (lib/unsavedGuard.test.ts).
 * Links to other sites, new tabs, downloads, hash-only changes and non-http(s) schemes are not intercepted;
 * leaving the site entirely is covered by the browser's own `beforeunload` prompt.
 */

/** What the Review screen knows about the current profile. */
export interface WorkState {
  /** A profile is loaded in the form (uploaded, blank, or opened from My Profiles). */
  hasProfile: boolean;
  /** At least one version of it has been saved. */
  saved: boolean;
  /** Edited since the last save (or since it was opened). */
  dirty: boolean;
  /** The DOCX was downloaded and nothing has been edited since. */
  downloaded: boolean;
}

/**
 * True when leaving would lose work: a profile that was never saved, or one edited since its last save,
 * unless its DOCX has been downloaded since the last edit (the user already has the result).
 */
export function hasUnsavedWork(s: WorkState): boolean {
  if (!s.hasProfile || s.downloaded) return false;
  return s.dirty || !s.saved;
}

/** The facts about a click on an anchor that matter for the decision. */
export interface LinkClick {
  /** The anchor's resolved absolute URL (`a.href`). */
  href: string;
  /** The anchor's `target` attribute, or null. */
  target: string | null;
  /** True when the anchor has a `download` attribute. */
  download: boolean;
  /** MouseEvent.button (0 = primary). */
  button: number;
  /** True when ctrl, meta, shift or alt was held (open in new tab/window, save as...). */
  modifier: boolean;
  /** True when something else already cancelled the click. */
  defaultPrevented: boolean;
}

/** True when the click would navigate away from `currentUrl` within the same site. */
export function isInAppNavigation(click: LinkClick, currentUrl: string): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.modifier || click.download) return false;
  if (click.target && click.target !== "_self") return false;
  let to: URL;
  let from: URL;
  try {
    to = new URL(click.href, currentUrl);
    from = new URL(currentUrl);
  } catch {
    return false;
  }
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  if (to.origin !== from.origin) return false;
  return to.pathname !== from.pathname || to.search !== from.search;
}
