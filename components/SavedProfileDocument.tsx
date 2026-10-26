"use client";

/**
 * Purpose: shows a saved profile on My Profiles and on the manager's profile page as the real InfoBeans document: the
 * very PDF that Preview & Submit shows and Download PDF saves (made by POST /api/pdf from the Word template). When the
 * document cannot be made (the version is missing required details, the PDF service is unavailable, the session
 * ended), a short note says why and the plain card view of the profile is shown instead, so the page is never empty.
 */
import PdfPreview from "@/components/PdfPreview";
import ProfilePreview from "@/components/ProfilePreview";
import { usePreviewPdf } from "@/components/usePreviewPdf";
import type { ResumeData, TemplateId } from "@/lib/schemas";

/** Why the document is missing, in plain words (the server's own wording is used for an incomplete profile). */
function explain(httpStatus: number, message: string): string {
  if (httpStatus === 401) return "Your session has ended. Please sign in again to see the document.";
  if (httpStatus === 422) return "This version is missing required details, so the InfoBeans document cannot be shown yet. Open it in the editor to complete it.";
  if (httpStatus === 429) return "Too many documents were built in a short time. Please wait a moment and try again.";
  return message || "The InfoBeans document could not be created right now. Please try again.";
}

export default function SavedProfileDocument({ template, data }: { template: TemplateId; data: ResumeData }) {
  const { pdf, retry } = usePreviewPdf(template, data);

  if (pdf.status === "loading") {
    return (
      <div className="border border-gray-200 bg-white shadow-sm" data-saved-document="loading">
        <p role="status" className="px-4 py-10 text-center text-sm text-ink-light">
          Building the document…
        </p>
      </div>
    );
  }

  if (pdf.status === "ready") {
    return (
      <div data-saved-document="ready">
        <PdfPreview blob={pdf.blob} />
      </div>
    );
  }

  return (
    <div data-saved-document="fallback">
      <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 border border-brand-200 bg-brand-50 p-3 text-sm text-brand-700">
        <span className="flex-1">{explain(pdf.httpStatus, pdf.message)}</span>
        {pdf.httpStatus !== 422 && pdf.httpStatus !== 401 && (
          <button type="button" onClick={retry} className="border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
            Try again
          </button>
        )}
      </div>
      <ProfilePreview template={template} data={data} />
    </div>
  );
}
