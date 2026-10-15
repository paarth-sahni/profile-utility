"use client";

/**
 * Purpose: "Open in Google Docs" for a SAVED version (My Profiles, Manage). Server pages cannot pass the
 * validation function to a client button, so this wrapper builds it from the version's data.
 */
import OpenInGoogleDocsButton from "@/components/OpenInGoogleDocsButton";
import { checkReadyForDocx } from "@/lib/docxReady";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export default function GoogleDocsForVersion({ template, data }: { template: TemplateId; data: ResumeData }) {
  const name = (data as { name?: string }).name?.trim() || "Profile";
  return (
    <OpenInGoogleDocsButton
      template={template}
      title={`${name} — ${template} profile`}
      prepare={() => checkReadyForDocx(template, data)}
    />
  );
}
