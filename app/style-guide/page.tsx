import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Style Guide — Profile Generator",
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PDF_URL = `${BASE}/style-guide/Style%20Guide.pdf`;

export default function StyleGuidePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="border-l-4 border-brand-500 pl-4">
          <h1 className="text-2xl font-bold text-ink-dark">Style Guide</h1>
          <p className="text-sm text-ink-light">
            Typography styles used by the profile template. The generator automatically applies the standard
            InfoBeans profile formatting. If you make any manual edits in Google Docs or Microsoft Word, use the
            styles below to maintain a consistent look and feel.
          </p>
        </div>
        <a
          href={PDF_URL}
          download="Style Guide.pdf"
          className="shrink-0 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
        >
          Download PDF ↓
        </a>
      </div>
      <object
        data={PDF_URL}
        type="application/pdf"
        className="min-h-[80vh] w-full flex-1 rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="p-8 text-center text-sm text-gray-600">
          Your browser cannot display PDFs inline.{" "}
          <a href={PDF_URL} className="font-medium text-brand-600 underline">
            Open the Style Guide PDF
          </a>
        </div>
      </object>
    </main>
  );
}
