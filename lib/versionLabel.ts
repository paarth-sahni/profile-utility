/**
 * Purpose: the rules for the "Version label" box on the Review screen. The first save of a profile defaults to
 * "Base"; after that the box is pre-filled with the next version number ("v2", "v3", ...) instead of sitting
 * empty; a role-specific version always asks for a name (e.g. "Java Backend"). Pure; unit-tested
 * (lib/versionLabel.test.ts).
 */

export const BASE_LABEL = "Base";
/** Same limit as the database column and the save API. */
export const MAX_LABEL_LENGTH = 60;

/** What the label box should contain: "" for a role-specific version, else "Base" (never saved) or "v<next>". */
export function defaultLabel(opts: { lastSavedNo: number | null; roleSpecific: boolean }): string {
  if (opts.roleSpecific) return "";
  return opts.lastSavedNo === null ? BASE_LABEL : `v${opts.lastSavedNo + 1}`;
}

export type ResolvedLabel = { ok: true; label: string } | { ok: false; message: string };

/**
 * The label to save. A blank box falls back to the default for a normal version; a role-specific version must be
 * named, so a blank box is an error with a message to show.
 */
export function resolveLabel(input: string, opts: { lastSavedNo: number | null; roleSpecific: boolean }): ResolvedLabel {
  const label = input.trim().slice(0, MAX_LABEL_LENGTH);
  if (opts.roleSpecific) {
    return label ? { ok: true, label } : { ok: false, message: "Give this role-specific version a name, for example \"Java Backend\"." };
  }
  return { ok: true, label: label || defaultLabel({ lastSavedNo: opts.lastSavedNo, roleSpecific: false }) };
}
