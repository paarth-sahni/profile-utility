/**
 * Purpose: rules for the local "unsaved draft" of the Review form, kept in sessionStorage so a session that
 * ends (or a failed save with 401) does not lose the user's edits. A draft is offered back ("Restore your
 * unsaved changes?") only to the SAME signed-in user, for the same template, while still fresh, and only if it
 * passes validation again; anything else is deleted. Never sent to the server. Pure apart from the storage
 * object passed in, so it is unit-tested (lib/draft.test.ts). Storage helpers: lib/draftStorage.ts.
 */
import { z } from "zod";
import { type DraftStorage, clearDraft, draftKey, draftsSuspended } from "./draftStorage";
import { type ResumeAnalysis, type ReviewFlag, resumeAnalysisSchema, reviewFlagSchema } from "./extract.types";
import { lenientSchemaFor } from "./profilePayload";
import type { ResumeData, TemplateId } from "./schemas";
import { type WorkState, hasUnsavedWork } from "./unsavedGuard";

/** Drafts older than this are discarded instead of offered. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type DraftSource = "upload" | "scratch" | "saved";

/** Everything needed to put the Review form back as it was. */
export interface Draft {
  v: 1;
  /** The signed-in user who owns the draft. A different user never sees it. */
  userId: string;
  template: TemplateId;
  source: DraftSource;
  data: ResumeData;
  reviewFlags: ReviewFlag[];
  analysis: ResumeAnalysis | null;
  promptPlan: string[];
  /** Saved-profile info, so a restored form keeps saving to the same profile (null if never saved). */
  profileId: string | null;
  versionId: string | null;
  versionNo: number | null;
  label: string;
  /** Epoch ms when the draft was written. */
  savedAt: number;
}

const envelope = z.object({
  v: z.literal(1),
  userId: z.string().min(1),
  template: z.enum(["internal", "external"]),
  source: z.enum(["upload", "scratch", "saved"]),
  data: z.unknown(),
  reviewFlags: z.array(reviewFlagSchema).max(200),
  analysis: resumeAnalysisSchema.nullable(),
  promptPlan: z.array(z.string().max(100)).max(50),
  profileId: z.string().uuid().nullable(),
  versionId: z.string().uuid().nullable(),
  versionNo: z.number().int().positive().nullable(),
  label: z.string().max(60),
  savedAt: z.number(),
});

/** What the Review screen knows when deciding whether a draft is worth keeping. */
export interface DraftState extends WorkState {
  source: DraftSource | null;
  /** The user changed something in the form (beyond what was loaded). */
  edited: boolean;
}

/**
 * Keep a draft while there is unsaved work (same rule as the leave warning), except for a blank form nobody
 * has typed into yet: restoring an empty form helps no one.
 */
export function shouldKeepDraft(s: DraftState): boolean {
  if (!hasUnsavedWork(s)) return false;
  return !(s.source === "scratch" && !s.edited);
}

/** Writes the draft; returns false (never throws) when storage is unavailable or full, or after sign-out began. */
export function writeDraft(storage: DraftStorage | null, draft: Draft): boolean {
  try {
    if (!storage || draftsSuspended()) return false;
    storage.setItem(draftKey(draft.template), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads this tab's draft for `template`. Returns null — and deletes the stored value — when it is corrupt,
 * invalid, too old, from another template, or from another user.
 */
export function readDraft(
  storage: DraftStorage | null,
  opts: { userId: string; template: TemplateId; now?: number },
): Draft | null {
  if (!storage) return null;
  const now = opts.now ?? Date.now();
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(opts.template));
  } catch {
    return null;
  }
  if (raw === null) return null;

  const discard = (): null => {
    clearDraft(storage, opts.template);
    return null;
  };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return discard();
  }
  const env = envelope.safeParse(json);
  if (!env.success) return discard();
  const d = env.data;
  if (d.userId !== opts.userId || d.template !== opts.template) return discard();
  if (now - d.savedAt > DRAFT_MAX_AGE_MS || d.savedAt > now + 60_000) return discard();
  const data = lenientSchemaFor(d.template).safeParse(d.data);
  if (!data.success) return discard();
  return { ...d, data: data.data as ResumeData };
}
