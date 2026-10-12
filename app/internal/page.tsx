import ProfileWorkflow from "@/components/ProfileWorkflow";
import { canUseGoogleDocs, getCurrentUser } from "@/lib/auth";
import { loadInitial } from "@/lib/db/initial";
import { getSessionInfo } from "@/lib/sessionInfo";

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const [initial, session, user] = await Promise.all([loadInitial("internal", version), getSessionInfo(), getCurrentUser()]);
  return <ProfileWorkflow key={initial?.versionId ?? "new"} audience="internal" initial={initial} session={session} canGoogleDocs={canUseGoogleDocs(user?.role)} />;
}
