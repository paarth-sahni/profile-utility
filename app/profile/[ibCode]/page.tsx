/**
 * Purpose: /profile/<ib_code>: the link the Teams app uses. Resolves the IB code to an employee through the live Teams data
 * (lib/teamsClient.ts) and shows that person's PRIMARY profile, read-only, with Download PDF. Sign-in required (proxy.ts sends
 * a signed-out visitor to /login and back here). Who may open whose profile is decided on the server (lib/teamAccess.ts): your
 * own always; anyone's for managers, admins and leads. To a team member, someone else's link and an unknown code look the
 * same ("not available"), so codes cannot be probed. "No profile yet" when the person has no primary profile.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import { PrimaryBadge } from "@/components/MarkPrimaryButton";
import PageHero from "@/components/PageHero";
import SavedProfileDocument from "@/components/SavedProfileDocument";
import { getCurrentUser } from "@/lib/auth";
import { primaryProfileOf } from "@/lib/db/teamProfiles";
import { profileDisplayName } from "@/lib/docxReady";
import { accessFor, canOpenProfileOf } from "@/lib/teamAccess";
import { teams } from "@/lib/teamsClient";

export const metadata: Metadata = { title: "Profile (read-only) — Profile Generator" };
export const dynamic = "force-dynamic";

const IB_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-medium text-ink-dark">{title}</h1>
      <p className="mt-2 text-sm text-ink-light">{text}</p>
      <Link href="/profiles" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
        Go to My Profiles
      </Link>
    </main>
  );
}

const NOT_AVAILABLE = <Message title="This profile isn't available to you" text="Check the link, or ask your manager. You can always open your own profile." />;

export default async function ProfileLinkPage({ params }: { params: Promise<{ ibCode: string }> }) {
  const { ibCode } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/profile/${ibCode}`)}`);
  if (!IB_CODE.test(ibCode)) return NOT_AVAILABLE;

  const [access, found] = await Promise.all([accessFor(user, teams), teams.byIbCode(ibCode)]);
  if (!found.ok) return <Message title="Employee data is unavailable" text="We could not look up this IB code right now. Please try again in a few minutes." />;
  const employee = found.data;
  // a team member gets the same answer for an unknown code and for someone else's: codes cannot be probed
  if (!employee) return access.level === "member" ? NOT_AVAILABLE : <Message title="No such employee" text={`No active employee has the IB code ${ibCode.toUpperCase()}.`} />;
  if (!canOpenProfileOf(access, user.email, employee.email)) return NOT_AVAILABLE;

  const result = await primaryProfileOf(user, access, employee.email);
  const facts = [employee.ibCode, employee.role, employee.deliveryUnit, employee.department].filter(Boolean).join(" · ");

  if (result.status !== "ok") {
    return (
      <div className="w-full text-ink">
        <PageHero title={employee.name} subtitle={facts} compact />
        <main className="mx-auto w-full max-w-3xl px-4 py-12 text-center" data-profile-link-state={result.status}>
          <h2 className="text-xl font-medium text-ink-dark">{result.status === "none" ? "No profile yet" : "This profile could not be loaded"}</h2>
          <p className="mt-2 text-sm text-ink-light">
            {result.status === "none" ? `${employee.name} has no primary profile yet.` : "Please try again in a few minutes."}
          </p>
        </main>
      </div>
    );
  }

  const shown = result.version;
  const data = shown.data as { name?: string; jobTitle?: string };
  return (
    <div className="w-full text-ink">
      <PageHero title={profileDisplayName(data.name ?? employee.name, data.jobTitle ?? "")} subtitle={`${employee.name}${facts ? ` · ${facts}` : ""} · primary profile · read-only`} compact />
      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5" data-profile-link-state="ok">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <PrimaryBadge />
        </div>
        {/* Read-only: the export is made from the version shown; nothing is changed or saved. */}
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <DownloadPdfButton template={shown.template} data={shown.data} versionId={shown.meta.versionId} />
        </div>
        <SavedProfileDocument template={shown.template} data={shown.data} />
      </main>
    </div>
  );
}
