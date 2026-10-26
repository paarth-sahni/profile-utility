"use client";

/**
 * Purpose: "Open in Google Docs" for a SAVED version (My Profiles, Manage). Server pages cannot pass the
 * validation function to a client button, so this wrapper builds it from the version's data. The Google Docs file is built
 * and uploaded in the browser, so the server cannot gate it like the PDF; instead the content is checked against the
 * client-name registry just before the upload (the server answers, the list never reaches the browser) and a profile that
 * names a registered client is not uploaded. With enforcement off the check does nothing.
 */
import OpenInGoogleDocsButton from "@/components/OpenInGoogleDocsButton";
import { checkComplianceRemote } from "@/lib/complianceClient";
import { checkReadyForDocx } from "@/lib/docxReady";
import type { ResumeData, TemplateId } from "@/lib/schemas";

export default function GoogleDocsForVersion({ template, data, accountEmail }: { template: TemplateId; data: ResumeData; accountEmail?: string | null }) {
  const name = (data as { name?: string }).name?.trim() || "Profile";
  return (
    <OpenInGoogleDocsButton
      template={template}
      title={`${name} — ${template} profile`}
      accountEmail={accountEmail}
      prepare={() => checkReadyForDocx(template, data)}
      beforeUpload={async () => {
        const r = await checkComplianceRemote(template, data);
        if (r.status === "ok" && r.enforced && r.matches.length > 0) {
          throw new Error("This profile names a registered client, company or project, so it cannot be opened in Google Docs. Edit the profile and save a new version first.");
        }
        if (r.status === "unavailable") throw new Error("The client-name check is not available right now, so the file was not created. Please try again shortly.");
        if (r.status === "unauthenticated") throw new Error("Your session has ended. Please sign in again.");
        if (r.status === "failed") throw new Error("We could not run the client-name check, so the file was not created. Please try again.");
      }}
    />
  );
}
