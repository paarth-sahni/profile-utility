import ProfileWorkflow from "@/components/ProfileWorkflow";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { loadInitial } from "@/lib/db/initial";
import { getMyPrimaryProfileId } from "@/lib/db/profiles";
import { getSessionInfo } from "@/lib/sessionInfo";

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const [initial, session, user] = await Promise.all([loadInitial("internal", version), getSessionInfo(), getCurrentUser()]);
  const primaryProfileId = user ? await getMyPrimaryProfileId().catch(() => null) : null;
  return (
    <ProfileWorkflow
      key={initial?.versionId ?? "new"}
      audience="internal"
      initial={initial}
      session={session}
      canGoogleDocs={canUseGoogleDocs(user?.role)}
      primaryProfileId={primaryProfileId}
    />
  );
}
