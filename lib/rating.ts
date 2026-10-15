/**
 * Purpose: the rules for a skill rating on the internal profile: above 0 and at most 5, with at most one decimal
 * (4, 4.5, 4.8, 5). `acceptRatingInput` filters what can be typed (so 6 or 5.5 never appear in the box), and
 * `isValidRating` is the final check used by the schema before a profile can be previewed, saved or exported.
 * `normalizeRating` cleans a value that came from somewhere else (the resume reader): in range it is rounded to one
 * decimal, out of range it becomes "" so the person has to enter it. Pure; unit-tested in lib/rating.test.ts.
 */

export const RATING_MESSAGE = "Enter a rating above 0 and up to 5 (one decimal, e.g. 4.5)";

/** True for "4", "4.5", "5", "5.0", "0.5"; false for "", "0", "5.1", "6", "4.55", "4." and anything not a number. */
export function isValidRating(value: string): boolean {
  const v = value.trim();
  if (!/^\d(\.\d)?$/.test(v)) return false;
  const n = Number(v);
  return n > 0 && n <= 5;
}

/**
 * What the rating box may show after a keystroke: `next` when it is still a valid beginning of a rating
 * ("", "4", "4.", "4.8", ".5", "5", "5.0"), otherwise `previous` (the keystroke is ignored).
 */
export function acceptRatingInput(previous: string, next: string): string {
  if (next === "") return "";
  const m = /^(\d?)(?:\.(\d?))?$/.exec(next);
  if (!m) return previous;
  const whole = m[1];
  const decimal = m[2];
  if (whole !== "" && Number(whole) > 5) return previous;
  if (whole === "5" && decimal !== undefined && decimal !== "" && decimal !== "0") return previous;
  return next;
}

/** A rating from outside the form (the resume reader): rounded to one decimal when it is in range, "" otherwise. */
export function normalizeRating(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 5) return "";
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? String(rounded) : "";
}
