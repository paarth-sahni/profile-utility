import ProfileWorkflow from "@/components/ProfileWorkflow";
import { loadInitial } from "@/lib/db/initial";

export default async function ExternalPage({ searchParams }: { searchParams: Promise<{ version?: string }> }) {
  const { version } = await searchParams;
  const initial = await loadInitial("external", version);
  return <ProfileWorkflow key={initial?.versionId ?? "new"} audience="external" initial={initial} />;
}
