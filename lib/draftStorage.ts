/**
 * Purpose: the storage half of draft recovery, kept tiny (no schemas) so the nav's sign-out can import it.
 * Drafts live ONLY in sessionStorage (this tab, gone when the tab closes), never localStorage, and are never
 * sent anywhere. Every function tolerates storage being unavailable or full (private windows, quotas).
 */
import type { TemplateId } from "./schemas";

/** The slice of the Storage API used here (so tests can pass a fake). */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const DRAFT_PREFIX = "profile-draft:v1:";

/** One draft per template (a person can have the internal and external forms open in different tabs). */
export const draftKey = (template: TemplateId): string => `${DRAFT_PREFIX}${template}`;

/** This tab's sessionStorage, or null when the browser blocks it. */
export function getSessionStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Removes the draft for one template. */
export function clearDraft(storage: DraftStorage | null, template: TemplateId): void {
  try {
    storage?.removeItem(draftKey(template));
  } catch {
    // nothing to clear if storage is unavailable
  }
}

// Set once the user signs out. The page is about to unload, and its `pagehide` handler would otherwise write the
// unsaved draft straight back after it was cleared. Lives only as long as the page.
let suspended = false;

/** True after sign-out began: drafts must not be written any more on this page. */
export function draftsSuspended(): boolean {
  return suspended;
}

/** Lets drafts be written again (tests; or if the sign-out request failed and the user stays on the page). */
export function resumeDrafts(): void {
  suspended = false;
}

/** Sign-out: delete every draft AND stop this page from writing new ones. */
export function clearDraftsOnSignOut(storage: DraftStorage | null): void {
  suspended = true;
  clearAllDrafts(storage);
}

/** Removes every draft. Leaves unrelated keys alone. */
export function clearAllDrafts(storage: DraftStorage | null): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    // nothing to clear if storage is unavailable
  }
}
