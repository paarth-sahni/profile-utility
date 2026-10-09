import ProfileWorkflow from "@/components/ProfileWorkflow";
import { loadInitial } from "@/lib/db/initial";

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const initial = await loadInitial("internal", version);
  return <ProfileWorkflow key={initial?.versionId ?? "new"} audience="internal" initial={initial} />;
}
