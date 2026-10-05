/**
 * Purpose: turn a review-flag dot path ("projects.0.duration") into a human-readable label
 * ("Project 1 → Duration") using the same labels as the validation error messages.
 */
import { describeFieldPath } from "./schemas";

/** Converts a dot path from the model into a readable label; unknown paths fall back to the raw text. */
export function describeFlagPath(path: string): string {
  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  return segments.length > 0 ? describeFieldPath(segments) : "This resume";
}
