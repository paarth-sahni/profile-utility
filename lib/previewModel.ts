/**
 * Purpose: small pure helpers for the read-only profile preview (My Profiles, Manage), so it shows what the Word
 * document shows: blank values and "N/A" placeholders count as "not there", empty sections disappear, and
 * ratings read "4/5". No React imports; unit-tested (lib/previewModel.test.ts).
 */
import { isNAValue } from "./schemas";

/** True when the value has real content: not blank and not an "N/A"-style placeholder. */
export const hasText = (value: string | undefined | null): boolean => !!value && value.trim() !== "" && !isNAValue(value);

/** The list without blank / "N/A" entries (so no empty chip and no lone empty bullet). Order is kept. */
export const cleanList = (items: readonly string[] | undefined | null): string[] => (items ?? []).filter((item) => hasText(item));

/** "4" -> "4/5", "4.5" -> "4.5/5"; a blank rating gives ""; anything else (already formatted) is left as it is. */
export function formatRating(rating: string | undefined | null): string {
  const r = (rating ?? "").trim();
  if (!hasText(r)) return "";
  return /^\d+(\.\d+)?$/.test(r) ? `${r}/5` : r;
}

/** True when a project/experience entry has at least one real value among the given fields (lists count if any item is real). */
export const hasContent = (...fields: (string | readonly string[] | undefined | null)[]): boolean =>
  fields.some((f) => (Array.isArray(f) ? cleanList(f).length > 0 : typeof f === "string" && hasText(f)));
