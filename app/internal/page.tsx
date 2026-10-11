import ProfileWorkflow from "@/components/ProfileWorkflow";
import { loadInitial } from "@/lib/db/initial";
import { getSessionInfo } from "@/lib/sessionInfo";

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const [initial, session] = await Promise.all([loadInitial("internal", version), getSessionInfo()]);
  return <ProfileWorkflow key={initial?.versionId ?? "new"} audience="internal" initial={initial} session={session} />;
}
