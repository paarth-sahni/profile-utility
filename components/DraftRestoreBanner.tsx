"use client";

/**
 * Purpose: offers the user their unsaved work back ("Restore your unsaved changes?") after a session ended or a
 * save failed with 401. The draft lives only in this tab's sessionStorage and never leaves the browser; the
 * text says so. Restore puts the form back, Discard deletes the draft. InfoBeans callout styling.
 */
interface DraftRestoreBannerProps {
  /** Epoch ms when the draft was written. */
  savedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}

export default function DraftRestoreBanner({ savedAt, onRestore, onDiscard }: DraftRestoreBannerProps) {
  const time = new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <section
      aria-labelledby="draft-restore-title"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-200 bg-warm px-4 py-3 text-sm text-ink"
    >
      <div>
        <h2 id="draft-restore-title" className="font-medium text-ink-dark">
          Restore your unsaved changes?
        </h2>
        <p className="mt-0.5 text-ink-light">
          We kept a copy of your work from {time}. It is stored only in this browser tab and is never sent anywhere.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-gray-50"
        >
          Discard
        </button>
      </div>
    </section>
  );
}
