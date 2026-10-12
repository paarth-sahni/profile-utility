/**
 * Purpose: the single heads-up line above the Review form after a resume was read: where the profile came from and
 * a reminder to review every section. Replaces the old technical "How this profile was read" block and the amber
 * "double-check" list.
 */
export default function ExtractionSummary({ fileName }: { fileName: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-hairline bg-white px-4 py-3 text-sm text-ink shadow-sm">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] text-white" aria-hidden>
        ✓
      </span>
      <p>
        {fileName ? (
          <>
            We filled this in from <span className="font-medium break-all">{fileName}</span>.{" "}
          </>
        ) : (
          <>We filled this in from your resume. </>
        )}
        Please review every section and complete anything that is missing.
      </p>
    </div>
  );
}
