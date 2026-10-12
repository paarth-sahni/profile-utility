import ProfileWorkflow from "@/components/ProfileWorkflow";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { loadInitial } from "@/lib/db/initial";
import { getSessionInfo } from "@/lib/sessionInfo";

export default async function ExternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const [initial, session, user] = await Promise.all([loadInitial("external", version), getSessionInfo(), getCurrentUser()]);
  return <ProfileWorkflow key={initial?.versionId ?? "new"} audience="external" initial={initial} session={session} canGoogleDocs={canUseGoogleDocs(user?.role)} />;
}
