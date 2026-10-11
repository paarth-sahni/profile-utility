/**
 * Purpose: turns `?version=<id>` on /internal or /external into the `initial` prop of ProfileWorkflow.
 * Returns null (normal upload screen) for a missing id, another user's id, or the wrong template.
 */
import "server-only";
import type { SavedInitial } from "@/components/ProfileWorkflow";
import type { TemplateId } from "@/lib/schemas";
import { getVersion } from "./profiles";

export async function loadInitial(template: TemplateId, versionId: string | undefined): Promise<SavedInitial | null> {
  if (!versionId) return null;
  try {
    const v = await getVersion(versionId);
    if (!v || v.template !== template) return null;
    return {
      profileId: v.meta.profileId,
      versionId: v.meta.versionId,
      versionNo: v.meta.versionNo,
      label: v.meta.label,
      data: v.data,
      reviewFlags: v.reviewFlags,
    };
  } catch {
    return null;
  }
}
