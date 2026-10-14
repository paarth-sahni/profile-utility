"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Stepper from "@/components/Stepper";
import UploadProgress from "@/components/UploadProgress";
import ExtractionSummary from "@/components/ExtractionSummary";
import { toFieldErrors as pathIssuesToErrors } from "@/lib/fieldErrors";
import ExternalForm from "@/components/ExternalForm";
import InternalForm from "@/components/InternalForm";
import PreviewStep, { type PrimaryChoice, type SubmittedVersion } from "@/components/PreviewStep";
import { pdfFileName } from "@/lib/docxReady";
import { UploadError, uploadResume } from "@/lib/extractClient";
import { hasUnsavedWork } from "@/lib/unsavedGuard";
import { labelForVersion } from "@/lib/versionLabel";
import { useUnsavedChangesWarning } from "@/lib/useUnsavedChangesWarning";
import { useStepHistory } from "@/lib/useStepHistory";
import SessionExpiryBanner from "@/components/SessionExpiryBanner";
import ConfirmDialog from "@/components/ConfirmDialog";
import DraftRestoreBanner from "@/components/DraftRestoreBanner";
import { type Draft, readDraft, shouldKeepDraft, writeDraft } from "@/lib/draft";
import { clearDraft, getSessionStorage } from "@/lib/draftStorage";
import type { ResumeAnalysis, ReviewFlag } from "@/lib/extract.types";
import type { ExtractResult } from "@/lib/extract.types";
import {
  blankResume,
  describeFieldPath,
  findNAIssues,
  formatYearsExperience,
  schemaFor,
  type ExternalResume,
  type InternalResume,
  type ResumeData,
  type TemplateId,
} from "@/lib/schemas";

// Each route is locked to one template's workflow.
export type Audience = TemplateId; // "internal" | "external"

interface FieldError {
  path: string;
  message: string;
}

/** How the current profile was started: uploaded resume or blank form. */
type Source = "upload" | "scratch" | "saved";

/** A previously saved version opened from My Profiles. */
export interface SavedInitial {
  profileId: string;
  versionId: string;
  versionNo: number;
  label: string;
  data: ResumeData;
  reviewFlags: { path: string; reason: string }[];
}

type UploadStatus = "idle" | "reading" | "structuring" | "finishing";

const STEP_UPLOAD = 1;
const STEP_REVIEW = 2; // "Edit details"
const STEP_PREVIEW = 3;

/** Per-template copy for the "get started" experience (the two choice cards and the upload screen). */
const START: Record<
  TemplateId,
  {
    boxA: { title: string; body: string; cta: string };
    boxB: { title: string; body: string; cta: string };
    uploadTitle: string;
    uploadBody: string;
  }
> = {
  external: {
    boxA: {
      title: "Generate from Candidate Resume",
      body: "Upload the candidate's resume to generate a standardized InfoBeans profile ready for client submission.",
      cta: "Upload resume",
    },
    boxB: {
      title: "Create a Profile from Scratch",
      body: "Start with a blank external profile template and fill in the required details to generate a profile in the InfoBeans standard format.",
      cta: "Get started",
    },
    uploadTitle: "Upload the candidate's resume",
    uploadBody:
      "We'll read the resume and pre-fill the profile for you to review. Anything we had to estimate will be flagged.",
  },
  internal: {
    boxA: {
      title: "Update an Existing Profile",
      body: "Already have an InfoBeans profile? Upload your latest version to update your information and generate a refreshed profile in standard format.",
      cta: "Upload existing profile",
    },
    boxB: {
      title: "Create a Profile from Scratch",
      body: "Creating your profile for the first time? Start with a blank template and build your InfoBeans profile section by section.",
      cta: "Get started",
    },
    uploadTitle: "Upload your existing profile or resume",
    uploadBody:
      "We'll read it and pre-fill your profile for you to review. Anything we had to estimate will be flagged.",
  },
};

const HERO_SUBTEXT: Record<TemplateId, string> = {
  external:
    "Generate a professionally formatted candidate profile in the standard InfoBeans format, ready for client submissions.",
  internal:
    "Your profile is a key branding tool that enables us to showcase your expertise to prospective clients and identify opportunities for role enrichment within the organization.",
};

const STEP_LABELS: Record<TemplateId, string[]> = {
  external: ["Start", "Upload profile", "Edit details", "Preview"],
  internal: ["Start", "Upload profile", "Edit details", "Preview & Submit"],
};


/** What the server knows about the sign-in (see lib/sessionInfo.ts). */
export interface WorkflowSession {
  userId: string;
  remainingMs: number;
}

export default function ProfileWorkflow({
  audience,
  initial,
  session,
  primaryProfileId = null,
}: {
  audience: Audience;
  initial?: SavedInitial | null;
  session?: WorkflowSession | null;
  /** Internal: the signed-in user's primary profile (null when none is marked yet). */
  primaryProfileId?: string | null;
}) {
  const templateId = audience; // the route fixes the template
  const start = START[templateId];

  const [step, setStep] = useState(initial ? STEP_REVIEW : 0);
  const [source, setSource] = useState<Source | null>(initial ? "saved" : null);
  const [data, setData] = useState<ResumeData | null>(initial?.data ?? null);
  const [errors, setErrors] = useState<FieldError[] | null>(null);
  // field key ("name", "education.0.year") -> message, to mark the fields in red
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [scrollTick, setScrollTick] = useState(0);
  // the validated profile shown on the Preview step (set when entering it)
  const [previewData, setPreviewData] = useState<ResumeData | null>(null);

  // upload screen
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // extraction result shown on Review
  const [extraction, setExtraction] = useState<ExtractResult | null>(null);
  const [edited, setEdited] = useState(false);

  // saving to My Profiles (only through Submit on the Preview step)
  const [savedProfileId, setSavedProfileId] = useState<string | null>(initial?.profileId ?? null);
  // the user's primary profile, kept up to date after Submit
  const [primaryId, setPrimaryId] = useState<string | null>(primaryProfileId);
  const [lastVersionId, setLastVersionId] = useState<string | null>(initial?.versionId ?? null);
  const [savedInfo, setSavedInfo] = useState<{ no: number; label: string } | null>(
    initial ? { no: initial.versionNo, label: initial.label } : null,
  );
  const [dirty, setDirty] = useState(false);
  const [downloaded, setDownloaded] = useState(false); // PDF downloaded and not edited since

  // draft recovery (sessionStorage only; see lib/draft.ts)
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null); // found on load, waiting for Restore/Discard
  const [draftChecked, setDraftChecked] = useState(!session); // true once storage was looked at (nothing to look at without a session)
  const [restored, setRestored] = useState<{ reviewFlags: ReviewFlag[]; analysis: ResumeAnalysis | null; promptPlan: string[] } | null>(null);
  // "Discard your unsaved draft?" asked before a new upload / blank form while the restore prompt is showing
  const [discardAsk, setDiscardAsk] = useState<{ kind: "blank" } | { kind: "upload"; file: File } | null>(null);
  const draftRef = useRef<Draft | null>(null); // the latest draft, so it can be written at once on a 401 or page hide
  // review flags / analysis / prompt plan of whatever is in the form: a fresh extraction, a restored draft, or a saved version
  const flagsNow: ReviewFlag[] = extraction?.reviewFlags ?? restored?.reviewFlags ?? initial?.reviewFlags ?? [];

  // Warn before leaving (refresh, close, in-app links) while the work is unsaved and not yet downloaded.
  const unsaved = hasUnsavedWork({ hasProfile: data !== null, saved: lastVersionId !== null, dirty, downloaded });
  const leaveGuard = useUnsavedChangesWarning(unsaved);
  // Browser Back from Review (or Upload / Submit) returns to the Start page instead of leaving the app,
  // asking first when there is unsaved work.
  const stepBack = useStepHistory({
    enabled: initial == null,
    step,
    askBeforeLeaving: unsaved && step > 0,
    goStart: () => {
      setStep(0);
      setErrors(null);
    },
  });

  // Offer a draft left behind by an ended session (same user, same template, still fresh).
  useEffect(() => {
    if (!session) return;
    const found = readDraft(getSessionStorage(), { userId: session.userId, template: templateId });
    if (found) setPendingDraft(found);
    setDraftChecked(true); // batched with the line above, so the effect below never sees "checked" without the draft
  }, [session, templateId]);

  // Keep the draft current while there is unsaved work; remove it once saved or downloaded.
  // Paused while a found draft waits for Restore/Discard, so it is not overwritten before the user decides.
  const keepDraft = shouldKeepDraft({ hasProfile: data !== null, saved: lastVersionId !== null, dirty, downloaded, source, edited });
  useEffect(() => {
    const storage = getSessionStorage();
    if (!session || !storage || !draftChecked || data === null || source === null || pendingDraft !== null) {
      draftRef.current = null;
      return;
    }
    if (!keepDraft) {
      draftRef.current = null;
      clearDraft(storage, templateId);
      return;
    }
    const draft: Draft = {
      v: 1,
      userId: session.userId,
      template: templateId,
      source,
      data,
      reviewFlags: flagsNow,
      analysis: extraction?.analysis ?? restored?.analysis ?? null,
      promptPlan: extraction?.promptPlan ?? restored?.promptPlan ?? [],
      profileId: savedProfileId,
      versionId: lastVersionId,
      versionNo: savedInfo?.no ?? null,
      label: savedInfo?.label ?? "",
      savedAt: Date.now(),
    };
    draftRef.current = draft;
    const id = window.setTimeout(() => writeDraft(storage, draft), 300); // debounce typing
    return () => window.clearTimeout(id);
  }, [session, draftChecked, data, source, pendingDraft, keepDraft, templateId, flagsNow, extraction, restored, savedProfileId, lastVersionId, savedInfo]);

  // Write the latest draft immediately when the page is hidden or closed (the debounce may not have fired).
  useEffect(() => {
    const flush = () => {
      const storage = getSessionStorage();
      if (storage && draftRef.current) writeDraft(storage, draftRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const fromScratch = source === "scratch";
  const uploading = uploadStatus !== "idle";

  /** Moves to a step. Never lands on an empty screen: Review needs data and the Upload step is
   *  skipped for the blank-form journey. */
  const goTo = (requested: number) => {
    if (uploading) return;
    let target = requested;
    if (target >= STEP_REVIEW && !data) target = 0;
    if (target === STEP_UPLOAD && source === "scratch") target = 0;
    if (target === STEP_PREVIEW) {
      enterPreview();
      return;
    }
    setStep(target);
    setErrors(null);
  };

  /** Starting a blank form or an upload while the restore prompt is showing would silently bury the draft, so ask first. */
  const startBlankForm = () => {
    if (uploading) return;
    if (pendingDraft) {
      setDiscardAsk({ kind: "blank" });
      return;
    }
    runBlankForm();
  };

  const runBlankForm = () => {
    setData(blankResume(templateId));
    setSource("scratch");
    setExtraction(null);
    setSavedProfileId(null);
    setLastVersionId(null);
    setSavedInfo(null);
    setDirty(false);
    setDownloaded(false);
    setRestored(null);
    setEdited(false);
    setStep(STEP_REVIEW);
    setErrors(null);
  };

  const handleFile = async (file: File) => {
    if (uploading) return;
    if (pendingDraft) {
      setDiscardAsk({ kind: "upload", file });
      return;
    }
    await runUpload(file);
  };

  const runUpload = async (file: File) => {
    if ((source === "upload" || source === "saved") && edited && !window.confirm("Uploading a new file will replace the edits you've made. Continue?")) {
      return;
    }
    setUploadError(null);
    setFileName(file.name);
    setUploadStatus("reading");
    // step the progress view forward while the server works (the last timer is cleared in `finally`)
    stageTimer.current = setTimeout(() => {
      setUploadStatus("structuring");
      stageTimer.current = setTimeout(() => setUploadStatus("finishing"), 8000);
    }, 4000);
    try {
      const result = await uploadResume(file, templateId);
      setData(result.data);
      setSource("upload");
      setExtraction(result);
      setSavedProfileId(null);
      setLastVersionId(null);
      setSavedInfo(null);
        setDirty(false);
      setDownloaded(false);
      setRestored(null);
      setEdited(false);
      setStep(STEP_REVIEW);
      setErrors(null);
    } catch (e) {
      setUploadError(e instanceof UploadError ? e.message : "Something went wrong. Please try again.");
    } finally {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      setUploadStatus("idle");
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  /**
   * Checks a profile against the rules that apply to every profile (required fields, placeholder "N/A" values) and
   * returns the validated data, or the list of problems plus a field-key -> message map to highlight them.
   * In the internal blank-form route the experience summary is a bare number of years; it is expanded to the full
   * "<N>+ Years of Industry Experience" string first (the upload route already supplies that string).
   */
  const checkProfile = (d: ResumeData): { data: ResumeData | null; list: FieldError[]; byPath: Record<string, string> } => {
    const effective: ResumeData =
      fromScratch && templateId === "internal"
        ? { ...(d as InternalResume), experienceSummary: formatYearsExperience((d as InternalResume).experienceSummary) }
        : d;
    const result = schemaFor(templateId).safeParse(effective);
    if (!result.success) {
      const fe = pathIssuesToErrors(result.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })));
      return {
        data: null,
        list: fe.list.map((p) => ({ path: p.label, message: p.message })),
        byPath: fe.byPath,
      };
    }
    const na = findNAIssues(templateId, result.data);
    if (na.length > 0) {
      const byPath: Record<string, string> = {};
      for (const n of na) if (n.key) byPath[n.key] = 'Replace the placeholder "N/A" with the real value.';
      return { data: null, list: na, byPath };
    }
    return { data: result.data as ResumeData, list: [], byPath: {} };
  };

  /**
   * Re-validates the form right before Preview and Save: covers the uploaded-profile path and the blank-form path,
   * plus any edits made in the edit step; the "N/A" check only runs here. Shows the problems in the form and
   * returns null, or returns the validated data.
   */
  const validateForExport = (): ResumeData | null => {
    if (!data) return null;
    const r = checkProfile(data);
    if (r.data) {
      setErrors(null);
      setFieldErrors({});
      return r.data;
    }
    setErrors(r.list);
    setFieldErrors(r.byPath);
    setScrollTick((t) => t + 1);
    return null;
  };

  /**
   * Moves to the Preview step. The profile is validated first (required fields, "N/A" placeholders); if anything is wrong
   * the user stays on (or returns to) Edit details with the problems marked, and nothing is generated.
   */
  const enterPreview = () => {
    const valid = validateForExport();
    if (!valid) {
      setStep(STEP_REVIEW);
      return;
    }
    setPreviewData(valid);
    setStep(STEP_PREVIEW);
    setErrors(null);
  };

  // After a failed check, bring the first marked field into view (its section opens itself first).
  useEffect(() => {
    if (scrollTick === 0) return;
    const t = setTimeout(() => {
      document.querySelector<HTMLElement>('[data-invalid="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(t);
  }, [scrollTick]);

  const handleFormChange = (d: ResumeData) => {
    setData(d);
    setEdited(true);
    setDirty(true);
    setDownloaded(false);
    if (errors) {
      const r = checkProfile(d);
      setErrors(r.data ? null : r.list);
      setFieldErrors(r.data ? {} : r.byPath);
    }
  };

  /** The sign-in ended: keep the work in this tab (never sent anywhere) so it can be restored after signing in again. */
  const endSession = () => {
    const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const storage = getSessionStorage();
    if (storage && draftRef.current) writeDraft(storage, draftRef.current);
    window.location.assign(`${BASE}/login?error=session&next=${encodeURIComponent(window.location.pathname)}`);
  };

  /**
   * Saves the current form as a new immutable version in My Profiles (internal profiles only). Validation is the
   * caller's job. Returns the saved version, or the message to show. Updates the saved-version state on success.
   */
  const persist = async (makePrimary = false): Promise<{ ok: true; profileId: string; versionNo: number; isPrimary: boolean } | { ok: false; message: string }> => {
    const fail = (message: string) => ({ ok: false as const, message });
    if (!data || templateId !== "internal") return fail("This profile cannot be saved.");
    const effective: ResumeData = fromScratch
      ? { ...(data as InternalResume), experienceSummary: formatYearsExperience((data as InternalResume).experienceSummary) }
      : data;
    const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    try {
      const res = await fetch(`${BASE}/api/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: templateId,
          kind: "base",
          label: "", // versions are labelled automatically by the server: Base, v2, v3, ...
          profileId: savedProfileId,
          parentVersionId: null,
          source: savedProfileId || source === "saved" ? "edit" : source === "scratch" ? "scratch" : "upload",
          data: effective,
          reviewFlags: flagsNow,
          analysis: extraction?.analysis ?? restored?.analysis ?? null,
          promptPlan: extraction?.promptPlan ?? restored?.promptPlan ?? [],
          makePrimary,
        }),
      });
      if (res.status === 401) {
        endSession();
        return fail("Your session has ended. Please sign in again; your work is kept in this tab.");
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "We could not save your profile. Please try again.");
      setSavedProfileId(json.profileId);
      setLastVersionId(json.versionId);
      setSavedInfo({ no: json.versionNo, label: labelForVersion(json.versionNo) });
      setDirty(false);
      if (fromScratch) {
        // the saved summary is the full "<N>+ Years..." string, so the form leaves bare-number mode
        setData(effective);
        setSource("saved");
      }
      if (json.isPrimary) setPrimaryId(json.profileId);
      return { ok: true, profileId: json.profileId, versionNo: json.versionNo, isPrimary: !!json.isPrimary };
    } catch (e) {
      return fail(e instanceof Error ? e.message : "We could not save your profile. Please try again.");
    }
  };

  /**
   * "Submit" on Preview (internal only): saves the version to My Profiles and stays on Preview, which then shows the
   * success message. When this exact content is already saved (nothing edited since), that version is reused instead
   * of creating an identical new one. Throws with a message to show on Preview if saving fails.
   */
  const submitProfile = async (makePrimary: boolean): Promise<SubmittedVersion> => {
    if (savedInfo && savedProfileId && lastVersionId && !dirty) {
      // nothing to save again; "Mark as primary profile" alone is one call
      if (makePrimary && primaryId !== savedProfileId) {
        const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        const res = await fetch(`${BASE}/api/profiles/${savedProfileId}/primary`, { method: "POST" });
        if (res.status === 401) {
          endSession();
          throw new Error("Your session has ended. Please sign in again; your work is kept in this tab.");
        }
        if (!res.ok) throw new Error("Your profile is saved, but we could not mark it as primary. Please try again.");
        setPrimaryId(savedProfileId);
      }
      return { profileId: savedProfileId, versionNo: savedInfo.no, isPrimary: (makePrimary || primaryId === savedProfileId) };
    }
    const result = await persist(makePrimary);
    if (!result.ok) throw new Error(result.message);
    return { profileId: result.profileId, versionNo: result.versionNo, isPrimary: result.isPrimary };
  };

  /** How "Mark as primary profile" is offered on Preview & Submit (internal only). */
  const primaryChoice = (): PrimaryChoice | null => {
    if (templateId !== "internal") return null;
    if (primaryId === null) return "first";
    if (savedProfileId && primaryId === savedProfileId) return "already";
    return "choose";
  };

  /** What Submit will do, shown above the Preview buttons. */
  const submitNote = (): string | null => {
    if (templateId !== "internal") return null;
    if (savedInfo && lastVersionId && !dirty) {
      return `This profile is already saved in My Profiles as v${savedInfo.no}${savedInfo.label ? ` (${savedInfo.label})` : ""}. Submit uses that version.`;
    }
    return "Submit saves this profile to My Profiles as a new version.";
  };

  /** Puts the form back exactly as the draft had it. */
  const handleRestoreDraft = () => {
    const d = pendingDraft;
    if (!d) return;
    setData(d.data);
    setSource(d.source);
    setStep(STEP_REVIEW);
    setExtraction(null);
    setRestored({ reviewFlags: d.reviewFlags, analysis: d.analysis, promptPlan: d.promptPlan });
    setSavedProfileId(d.profileId);
    setLastVersionId(d.versionId);
    setSavedInfo(d.versionNo !== null ? { no: d.versionNo, label: d.label } : null);
    setErrors(null);
    setEdited(true);
    setDirty(true);
    setDownloaded(false);
    setPendingDraft(null); // the effect above now keeps the restored work as a draft until it is saved
  };

  /** "Yes" on the discard question: delete the draft, then do what the user asked for. */
  const handleConfirmDiscard = () => {
    const ask = discardAsk;
    if (!ask) return;
    clearDraft(getSessionStorage(), templateId);
    setPendingDraft(null);
    setDiscardAsk(null);
    if (ask.kind === "blank") runBlankForm();
    else void runUpload(ask.file);
  };

  /** Deletes the draft without restoring it. */
  const handleDiscardDraft = () => {
    clearDraft(getSessionStorage(), templateId);
    setPendingDraft(null);
  };

  /** Wording of the "Leave without saving?" dialogs: external profiles are never saved, so only a download keeps them. */
  const leaveMessage = (consequence: string): string =>
    templateId === "internal"
      ? `Your profile has changes that are not saved and have not been downloaded. ${consequence}`
      : `Your profile has not been downloaded, and external profiles are not saved. ${consequence}`;

  const flags = flagsNow;

  return (
    <div className="w-full text-ink">
      {/* hero — only on the start page; title and subtext are per-audience. The subtext stays on one line on wide
          screens (font scales with the viewport) and wraps normally on narrow ones. */}
      {step === 0 && (
        <section className="relative overflow-hidden bg-cream">
          {/* soft brand glow behind the title */}
          <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-brand-100/70 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-peach/60 blur-3xl" aria-hidden />
          <div className="relative mx-auto max-w-[110rem] px-4 pb-6 pt-7 text-center">
            <h1 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl lg:text-5xl">Profile Generator</h1>
            <p className="mx-auto mt-3 text-sm text-ink-light sm:text-base xl:whitespace-nowrap xl:text-[clamp(12px,0.9vw,16px)]">
              {HERO_SUBTEXT[templateId]}
            </p>
          </div>
        </section>
      )}

      <main className="mx-auto max-w-6xl px-4 pb-10 pt-5">
        {leaveGuard.pendingHref && (
          <ConfirmDialog
            title="Leave without saving?"
            message={leaveMessage("If you leave now, they will be lost.")}
            confirmLabel="Leave anyway"
            cancelLabel="Stay"
            onConfirm={leaveGuard.leave}
            onCancel={leaveGuard.stay}
          />
        )}
        {stepBack.pendingBack && (
          <ConfirmDialog
            title="Leave without saving?"
            message={leaveMessage("If you go back to the start page now, they will be lost.")}
            confirmLabel="Leave anyway"
            cancelLabel="Stay"
            onConfirm={stepBack.leave}
            onCancel={stepBack.stay}
          />
        )}
        {discardAsk && (
          <ConfirmDialog
            title="Discard your unsaved draft?"
            message="You have unsaved changes from an earlier session. Starting something new will delete them for good."
            confirmLabel="Yes, discard"
            cancelLabel="No, keep it"
            onConfirm={handleConfirmDiscard}
            onCancel={() => setDiscardAsk(null)}
          />
        )}
        {pendingDraft && <DraftRestoreBanner savedAt={pendingDraft.savedAt} onRestore={handleRestoreDraft} onDiscard={handleDiscardDraft} />}
        {session && data && (
          <SessionExpiryBanner remainingMs={session.remainingMs} canSave={unsaved} saves={templateId === "internal"} />
        )}
        <div className="mb-6">
          <Stepper
            current={step}
            onNavigate={goTo}
            labels={STEP_LABELS[templateId]}
            skipped={fromScratch ? [STEP_UPLOAD] : []}
          />
        </div>

        {/* ---------- STEP 0: start experience ---------- */}
        {step === 0 && (
          <div className="animate-fade-up space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="mb-2 font-semibold text-ink-dark">{start.boxA.title}</h3>
                <p className="mb-5 flex-1 text-sm text-ink-light">{start.boxA.body}</p>
                <button
                  type="button"
                  onClick={() => setStep(STEP_UPLOAD)}
                  className="self-start rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
                >
                  {start.boxA.cta}
                </button>
              </div>
              <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="mb-2 font-semibold text-ink-dark">{start.boxB.title}</h3>
                <p className="mb-5 flex-1 text-sm text-ink-light">{start.boxB.body}</p>
                <button
                  type="button"
                  onClick={startBlankForm}
                  className="self-start rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
                >
                  {start.boxB.cta}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- STEP 1: upload profile ---------- */}
        {step === STEP_UPLOAD && (
          <div className="animate-fade-up space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 font-semibold text-ink-dark">{start.uploadTitle}</h2>
              <p className="mb-4 text-sm text-ink-light">{start.uploadBody}</p>

              {source === "upload" && data && !uploading && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-cream p-3 text-sm">
                  <span className="text-ink">
                    Your uploaded profile{fileName ? ` (${fileName})` : ""} is ready to review.
                  </span>
                  <button
                    type="button"
                    onClick={() => goTo(STEP_REVIEW)}
                    className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
                  >
                    Continue to review →
                  </button>
                </div>
              )}

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                  dragging ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-white"
                }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={uploading}
                  className="sr-only"
                  aria-label="Choose a PDF or DOCX file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleFile(file);
                  }}
                />
                {uploading ? (
                  <UploadProgress stage={uploadStatus as "reading" | "structuring" | "finishing"} fileName={fileName} />
                ) : (
                  <>
                    <p className="text-sm text-ink">Drag and drop your file here, or</p>
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInput.current?.click()}
                      className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50"
                    >
                      Choose a file
                    </button>
                    <p className="text-xs text-ink-light">PDF or DOCX, up to 10 MB</p>
                  </>
                )}
              </div>


              {uploadError && !uploading && (
                <div role="alert" className="mt-2 space-y-3 rounded-md border border-brand-200 bg-brand-50 p-3">
                  <p className="text-sm text-brand-700">{uploadError}</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadError(null);
                        fileInput.current?.click();
                      }}
                      className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={startBlankForm}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
                    >
                      Fill in the form manually instead
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => goTo(0)}
              disabled={uploading}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-40"
            >
              ← Back
            </button>
          </div>
        )}

        {/* ---------- STEP 2: edit details ---------- */}
        {step === STEP_REVIEW && data && (
          <div className="animate-fade-up space-y-5">
            {source === "upload" && extraction && <ExtractionSummary fileName={fileName} />}

            {templateId === "external" ? (
              <ExternalForm data={data as ExternalResume} onChange={handleFormChange} fieldErrors={fieldErrors} />
            ) : (
              <InternalForm data={data as InternalResume} fromScratch={fromScratch} onChange={handleFormChange} fieldErrors={fieldErrors} />
            )}

            {errors && (
              <div className="rounded-md border border-brand-200 bg-brand-50 p-3">
                <p className="mb-2 text-sm font-semibold text-brand-700">
                  Please fix {errors.length} {errors.length === 1 ? "issue" : "issues"} before continuing:
                </p>
                <ul className="space-y-1 text-sm text-brand-700">
                  {errors.map((err, i) => (
                    <li key={i}>
                      <code className="rounded bg-brand-100 px-1 py-0.5 text-xs">{err.path}</code> — {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goTo(fromScratch ? 0 : STEP_UPLOAD)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={enterPreview}
                className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
              >
                {templateId === "internal" ? "Preview & Submit →" : "Preview →"}
              </button>
            </div>
          </div>
        )}

        {/* ---------- STEP 3: preview ---------- */}
        {step === STEP_PREVIEW && previewData && (
          <div className="animate-fade-up">
            <PreviewStep
              template={templateId}
              data={previewData}
              fileName={pdfFileName(previewData)}
              onBack={() => goTo(STEP_REVIEW)}
              onDownloaded={() => setDownloaded(true)}
              onSubmit={templateId === "internal" ? submitProfile : undefined}
              primaryChoice={primaryChoice()}
              note={submitNote()}
              onSessionEnded={endSession}
            />
          </div>
        )}
      </main>
    </div>
  );
}
