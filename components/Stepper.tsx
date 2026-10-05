"use client";

const DEFAULT_STEPS = ["Start", "Upload resume", "Review & Generate"];

export default function Stepper({
  current,
  onNavigate,
  labels = DEFAULT_STEPS,
  skipped = [],
}: {
  current: number;
  onNavigate: (step: number) => void;
  labels?: string[];
  /** Steps that don't apply to this journey (e.g. Upload when starting from scratch); not clickable. */
  skipped?: number[];
}) {
  return (
    <ol className="flex items-center justify-center gap-2 sm:gap-4">
      {labels.map((label, i) => {
        const isSkipped = skipped.includes(i);
        const done = i < current && !isSkipped;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-4">
            {i > 0 && <span className={`h-px w-6 sm:w-12 ${done || active ? "bg-brand-400" : "bg-gray-300"}`} />}
            <button
              type="button"
              disabled={!done}
              onClick={() => onNavigate(i)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-brand-500 text-white shadow-sm"
                  : done
                    ? "bg-brand-50 text-brand-700 hover:bg-brand-100 cursor-pointer"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? "bg-white text-brand-500" : done ? "bg-brand-500 text-white" : "bg-gray-300 text-white"
                }`}
              >
                {done ? "✓" : isSkipped ? "–" : i + 1}
              </span>
              <span className="hidden sm:inline font-medium">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
