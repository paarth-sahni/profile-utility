"use client";

/**
 * Purpose: the "we're working on it" view shown inside the upload box while a resume is being read. The wait is
 * often 10-30 seconds, so it shows a moving bar, the current step and what to expect, instead of a dimmed box.
 */
export type UploadStage = "reading" | "structuring" | "finishing";

const STEPS: { stage: UploadStage; label: string }[] = [
  { stage: "reading", label: "Reading your resume" },
  { stage: "structuring", label: "Finding your details" },
  { stage: "finishing", label: "Building your profile" },
];

export default function UploadProgress({ stage, fileName }: { stage: UploadStage; fileName: string | null }) {
  const current = STEPS.findIndex((s) => s.stage === stage);
  return (
    <div role="status" aria-live="polite" className="flex w-full max-w-md flex-col items-center gap-5 py-2">
      <div className="flex items-center gap-3">
        <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-500" aria-hidden />
        <p className="text-base font-medium text-ink-dark">{STEPS[Math.max(0, current)].label}…</p>
      </div>

      {fileName && (
        <p className="max-w-full truncate rounded-full bg-cream px-3 py-1 text-xs text-ink-light ring-1 ring-hairline" title={fileName}>
          {fileName}
        </p>
      )}

      {/* indeterminate bar: it moves so the page never looks frozen */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100" aria-hidden>
        <div className="upload-bar h-full w-1/3 rounded-full bg-brand-500" />
      </div>

      <ol className="flex w-full items-start justify-between gap-2 text-xs">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.stage} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${
                  done ? "bg-brand-500 text-white" : active ? "bg-brand-50 text-brand-600 ring-2 ring-brand-500" : "bg-gray-100 text-gray-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={active ? "font-medium text-ink" : done ? "text-ink-light" : "text-gray-400"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-ink-light">This usually takes 10–30 seconds. Please keep this page open.</p>
    </div>
  );
}
