/**
 * Purpose: keeps registered names out of the extraction metadata that is stored with a saved profile version. The review flags,
 * the analysis notes and the prompt plan are free text written by the model (or sent by the caller). They are never printed in
 * the document and the person cannot see or edit them, so a match here must not block the save (it could never be fixed):
 * the text is replaced or dropped instead. Everything that is a fixed choice (enums, booleans) cannot hold a name and is left alone.
 * Pure: runs on the server with the registry matcher.
 */
import type { Matcher } from "./match";

/** What replaces a flag reason or note that contained a registered name. */
export const REDACTED_TEXT = "Removed: this note contained a restricted name.";

type Flag = { path: string; reason: string };
type Analysis = { notes: string[]; earliestProfessionalStart: string } & Record<string, unknown>;

export type Metadata<A extends Analysis = Analysis> = { reviewFlags: Flag[]; analysis?: A | null; promptPlan: string[]; label?: string };

/** The same metadata with matching text redacted (a new object; the input is not changed) and how many pieces were changed. */
export function redactMetadata<A extends Analysis>(matcher: Matcher, meta: Metadata<A>): { value: Metadata<A>; redacted: number } {
  if (matcher.size === 0) return { value: meta, redacted: 0 };
  let redacted = 0;
  const hit = (text: string) => matcher.scan(text).length > 0;

  const reviewFlags = meta.reviewFlags.map((f) => {
    let { path, reason } = f;
    if (hit(path)) {
      path = "";
      redacted++;
    }
    if (hit(reason)) {
      reason = REDACTED_TEXT;
      redacted++;
    }
    return path === f.path && reason === f.reason ? f : { path, reason };
  });

  let analysis = meta.analysis;
  if (analysis) {
    const notes = analysis.notes.map((n) => {
      if (!hit(n)) return n;
      redacted++;
      return REDACTED_TEXT;
    });
    let earliest = analysis.earliestProfessionalStart;
    if (hit(earliest)) {
      earliest = "";
      redacted++;
    }
    analysis = { ...analysis, notes, earliestProfessionalStart: earliest };
  }

  // the version label is free text sent by the caller; blank means the server names the version itself (Base, v2, ...)
  let label = meta.label;
  if (label !== undefined && hit(label)) {
    label = "";
    redacted++;
  }

  const promptPlan = meta.promptPlan.filter((p) => {
    if (!hit(p)) return true;
    redacted++;
    return false;
  });

  return redacted === 0 ? { value: meta, redacted: 0 } : { value: { reviewFlags, analysis, promptPlan, label }, redacted };
}
