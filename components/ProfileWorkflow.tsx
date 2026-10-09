"use client";

import { useRef, useState, type DragEvent } from "react";
import Stepper from "@/components/Stepper";
import ExternalForm from "@/components/ExternalForm";
import InternalForm from "@/components/InternalForm";
import { generateDocx } from "@/lib/generate";
import { INTERNAL_FORM_URL } from "@/lib/constants";
import { UploadError, uploadResume } from "@/lib/extractClient";
import { describeFlagPath } from "@/lib/reviewFlags";
import type { ExtractIssue, ExtractResult } from "@/lib/extract.types";
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

type UploadStatus = "idle" | "reading" | "structuring";

const STEP_UPLOAD = 1;
const STEP_REVIEW = 2;
const STEP_SUBMIT = 3;

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
  external: ["Start", "Upload resume", "Review & Generate"],
  internal: ["Start", "Upload resume", "Review & Generate", "Submit"],
};

const STATUS_TEXT: Record<Exclude<UploadStatus, "idle">, string> = {
  reading: "Reading your resume…",
  structuring: "Structuring your profile…",
};

const toFieldErrors = (issues: ExtractIssue[]): FieldError[] => issues.map((i) => ({ path: i.path, message: i.message }));

export default function ProfileWorkflow({ audience, initial }: { audience: Audience; initial?: SavedInitial | null }) {
  const templateId = audience; // the route fixes the template
  const start = START[templateId];

  const [step, setStep] = useState(initial ? STEP_REVIEW : 0);
  const [source, setSource] = useState<Source | null>(initial ? "saved" : null);
  const [data, setData] = useState<ResumeData | null>(initial?.data ?? null);
  const [errors, setErrors] = useState<FieldError[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  // upload screen
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // extraction result shown on Review
  const [extraction, setExtraction] = useState<ExtractResult | null>(null);
  const [flagsDismissed, setFlagsDismissed] = useState(false);
  const [edited, setEdited] = useState(false);

  // saving to My Profiles
  const [savedProfileId, setSavedProfileId] = useState<string | null>(initial?.profileId ?? null);
  const [lastVersionId, setLastVersionId] = useState<string | null>(initial?.versionId ?? null);
  const [savedInfo, setSavedInfo] = useState<{ no: number; label: string } | null>(
    initial ? { no: initial.versionNo, label: initial.label } : null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState(initial ? "" : "Base");
  const [roleSpecific, setRoleSpecific] = useState(false);

  const fromScratch = source === "scratch";
  const uploading = uploadStatus !== "idle";

  /** Moves to a step. Never lands on an empty screen: Review needs data and the Upload step is
   *  skipped for the blank-form journey. */
  const goTo = (requested: number) => {
    if (uploading) return;
    let target = requested;
    if (target >= STEP_REVIEW && !data) target = 0;
    if (target === STEP_UPLOAD && source === "scratch") target = 0;
    if (target === STEP_SUBMIT && templateId !== "internal") target = STEP_REVIEW;
    setStep(target);
    setGenerateError(null);
    setGenerated(null);
    setErrors(null);
  };

  const startBlankForm = () => {
    if (uploading) return;
    setData(blankResume(templateId));
    setSource("scratch");
    setExtraction(null);
    setSavedProfileId(null);
    setLastVersionId(null);
    setSavedInfo(null);
    setSaveLabel("Base");
    setRoleSpecific(false);
    setDirty(false);
    setEdited(false);
    setStep(STEP_REVIEW);
    setGenerateError(null);
    setGenerated(null);
    setErrors(null);
  };

  const handleFile = async (file: File) => {
    if (uploading) return;
    if ((source === "upload" || source === "saved") && edited && !window.confirm("Uploading a new file will replace the edits you've made. Continue?")) {
      return;
    }
    setUploadError(null);
    setFileName(file.name);
    setUploadStatus("reading");
    stageTimer.current = setTimeout(() => setUploadStatus("structuring"), 4000);
    try {
      const result = await uploadResume(file, templateId);
      setData(result.data);
      setSource("upload");
      setExtraction(result);
      setSavedProfileId(null);
      setLastVersionId(null);
      setSavedInfo(null);
      setSaveLabel("Base");
      setRoleSpecific(false);
      setDirty(false);
      setFlagsDismissed(false);
      setEdited(false);
      setStep(STEP_REVIEW);
      setGenerateError(null);
      setGenerated(null);
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

  const handleGenerate = async () => {
    if (!data) return;

    // In the internal blank-form route the experience summary is captured as a bare number
    // of years; expand it to the full "<N>+ Years of Industry Experience" string used in the
    // document (the upload route already supplies that string, so it is left untouched).
    const effective: ResumeData =
      fromScratch && templateId === "internal"
        ? { ...(data as InternalResume), experienceSummary: formatYearsExperience((data as InternalResume).experienceSummary) }
        : data;

    // Re-validate right before generating — covers the uploaded-profile path and the blank-form
    // path, plus any edits made in the review step. The "N/A" check only runs here.
    const result = schemaFor(templateId).safeParse(effective);
    if (!result.success) {
      setErrors(
        result.error.issues.map((issue) => ({
          path: issue.path.length ? describeFieldPath(issue.path as (string | number)[]) : "(root)",
          message: issue.message,
        })),
      );
      setGenerateError(null);
      setGenerated(null);
      return;
    }
    const naIssues = findNAIssues(templateId, result.data);
    if (naIssues.length > 0) {
      setErrors(naIssues);
      setGenerateError(null);
      setGenerated(null);
      return;
    }
    setErrors(null);

    setGenerating(true);
    setGenerateError(null);
    setGenerated(null);
    try {
      const candidate = (data as { name?: string }).name?.trim().replace(/\s+/g, "_") || "resume";
      await generateDocx(templateId, result.data, `${candidate}_${templateId}_profile.docx`);
      setGenerated("DOCX downloaded — check your downloads.");
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleFormChange = (d: ResumeData) => {
    setData(d);
    setEdited(true);
    setDirty(true);
    if (errors) setErrors(null);
  };

  /** Saves the current form as a new immutable version in My Profiles (drafts with blanks are allowed). */
  const handleSave = async () => {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    const effective: ResumeData =
      fromScratch && templateId === "internal"
        ? { ...(data as InternalResume), experienceSummary: formatYearsExperience((data as InternalResume).experienceSummary) }
        : data;
    const kind = roleSpecific && lastVersionId ? "role_specific" : "base";
    const label = saveLabel.trim() || (kind === "role_specific" ? "Role-specific" : "Base");
    const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    try {
      const res = await fetch(`${BASE}/api/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: templateId,
          kind,
          label,
          profileId: savedProfileId,
          parentVersionId: kind === "role_specific" ? lastVersionId : null,
          source: savedProfileId || source === "saved" ? "edit" : source === "scratch" ? "scratch" : "upload",
          data: effective,
          reviewFlags: extraction?.reviewFlags ?? initial?.reviewFlags ?? [],
          analysis: extraction?.analysis ?? null,
          promptPlan: extraction?.promptPlan ?? [],
        }),
      });
      if (res.status === 401) {
        window.location.assign(`${BASE}/login?error=session&next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "We could not save your profile. Please try again.");
      setSavedProfileId(json.profileId);
      setLastVersionId(json.versionId);
      setSavedInfo({ no: json.versionNo, label });
      setDirty(false);
      setRoleSpecific(false);
      setSaveLabel("");
      if (fromScratch && templateId === "internal") {
        // the saved summary is the full "<N>+ Years..." string, so the form leaves bare-number mode
        setData(effective);
        setSource("saved");
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "We could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const flags = extraction?.reviewFlags ?? initial?.reviewFlags ?? [];
  const issues = extraction?.issues ?? [];
  const showFlagsPanel = (source === "upload" || source === "saved") && !flagsDismissed && (flags.length > 0 || issues.length > 0);

  return (
    <div className="w-full text-ink">
      {/* hero — same heading for both routes, subtext is per-audience */}
      <section className="bg-cream">
        <div className="mx-auto max-w-6xl px-4 py-12 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-ink-dark sm:text-4xl">InfoBeans Profile Generator</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-ink-light sm:text-base">{HERO_SUBTEXT[templateId]}</p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-10">
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

        {/* ---------- STEP 1: upload resume ---------- */}
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
                } ${uploading ? "opacity-60" : ""}`}
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
              </div>

              <div aria-live="polite" className="mt-4 min-h-6 text-sm text-ink-light">
                {uploading && (
                  <span>
                    {fileName ? `${fileName} — ` : ""}
                    {STATUS_TEXT[uploadStatus as Exclude<UploadStatus, "idle">]}
                  </span>
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

        {/* ---------- STEP 2: review & generate ---------- */}
        {step === STEP_REVIEW && data && (
          <div className="animate-fade-up space-y-5">
            {source === "upload" && extraction && (
              <details className="rounded-md border border-gray-200 bg-white px-4 py-2 text-xs text-ink-light">
                <summary className="cursor-pointer hover:text-ink">How this profile was read</summary>
                <dl className="mt-2 space-y-1">
                  <div>
                    <dt className="inline font-medium text-ink">Document: </dt>
                    <dd className="inline">{extraction.analysis.documentType.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">Seniority: </dt>
                    <dd className="inline">{extraction.analysis.seniority}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink">Prompt modules: </dt>
                    <dd className="inline">{extraction.promptPlan.join(", ") || "none"}</dd>
                  </div>
                </dl>
              </details>
            )}

            {showFlagsPanel && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-amber-800">Please double-check</p>
                  <button
                    type="button"
                    onClick={() => setFlagsDismissed(true)}
                    aria-label="Dismiss"
                    className="rounded px-1 text-sm text-amber-700 hover:bg-amber-100"
                  >
                    ✕
                  </button>
                </div>
                {flags.length > 0 && (
                  <ul className="space-y-1 text-sm text-amber-900">
                    {flags.map((f, i) => (
                      <li key={i}>
                        {f.path && <span className="font-medium">{describeFlagPath(f.path)}</span>}
                        {f.path && " — "}
                        {f.reason}
                      </li>
                    ))}
                  </ul>
                )}
                {issues.length > 0 && (
                  <>
                    <p className="mb-1 mt-3 text-sm font-semibold text-amber-800">Still needed before you can generate</p>
                    <ul className="space-y-1 text-sm text-amber-900">
                      {toFieldErrors(issues).map((f, i) => (
                        <li key={i}>
                          <span className="font-medium">{f.path}</span> — {f.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {templateId === "external" ? (
              <ExternalForm data={data as ExternalResume} onChange={handleFormChange} />
            ) : (
              <InternalForm data={data as InternalResume} fromScratch={fromScratch} onChange={handleFormChange} />
            )}

            {errors && (
              <div className="rounded-md border border-brand-200 bg-brand-50 p-3">
                <p className="mb-2 text-sm font-semibold text-brand-700">
                  Can&apos;t generate yet — {errors.length} {errors.length === 1 ? "issue" : "issues"} to fix:
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
            {generateError && (
              <div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {generateError}
              </div>
            )}
            {generated && !generateError && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{generated}</div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor="save-label" className="mb-1 block text-xs font-medium text-ink-light">
                    Version label
                  </label>
                  <input
                    id="save-label"
                    type="text"
                    maxLength={60}
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    placeholder={roleSpecific ? "e.g. Java Backend" : "e.g. Base"}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50"
                >
                  {saving ? "Saving..." : savedProfileId ? "Save new version" : "Save to My Profiles"}
                </button>
              </div>
              {lastVersionId && (
                <label className="mt-3 flex items-center gap-2 text-sm text-ink-light">
                  <input type="checkbox" checked={roleSpecific} onChange={(e) => setRoleSpecific(e.target.checked)} />
                  Save as a role-specific version of v{savedInfo?.no}
                </label>
              )}
              <p className="mt-3 text-xs text-ink-light" aria-live="polite">
                {saveError ? (
                  <span className="text-brand-700">{saveError}</span>
                ) : savedInfo && !dirty ? (
                  <>
                    Saved &middot; v{savedInfo.no}
                    {savedInfo.label ? ` \u00b7 ${savedInfo.label}` : ""} &middot;{" "}
                    <a href={`/profiles/${savedProfileId}`} className="font-medium text-brand-600 hover:underline">
                      View in My Profiles
                    </a>
                  </>
                ) : savedInfo ? (
                  `You have unsaved changes since v${savedInfo.no}.`
                ) : (
                  "Not saved yet. Saving keeps this profile private to you and lets you reopen it later."
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goTo(fromScratch ? 0 : STEP_UPLOAD)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-50"
                >
                  {generating ? "Generating…" : "DOCX ↓"}
                </button>
                {templateId === "internal" && generated && !generateError && (
                  <button
                    type="button"
                    onClick={() => goTo(STEP_SUBMIT)}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
                  >
                    Continue to Submit →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- STEP 3: submit (internal only) ---------- */}
        {step === STEP_SUBMIT && templateId === "internal" && (
          <div className="animate-fade-up space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 font-semibold text-ink-dark">Submit your profile</h2>
              <p className="mb-4 text-sm text-ink-light">
                Once you&apos;ve downloaded your profile, upload the generated DOCX file through the Google Form
                below to complete your profile submission.
              </p>
              <a
                href={INTERNAL_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
              >
                Open submission form →
              </a>
            </div>
            <button
              type="button"
              onClick={() => goTo(STEP_REVIEW)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
            >
              ← Back
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
