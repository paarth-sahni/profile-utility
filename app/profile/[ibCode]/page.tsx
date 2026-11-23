/**
 * Purpose: /profile/<ib_code>: the link the Teams app uses. Resolves the IB code to an employee through the live Teams data
 * (lib/teamsClient.ts) and shows that person's PRIMARY profile, read-only, with Download PDF in the fixed action bar. Sign-in
 * required (proxy.ts sends a signed-out visitor to /login and back here). Who may open whose profile is decided on the server
 * (lib/teamAccess.ts): your own always; anyone's for managers, admins and leads. To a team member, someone else's link and an
 * unknown code look the same ("not available"), so codes cannot be probed. "No profile yet" when the person has no primary
 * profile. Laid out like every profile page (components/ProfileViewLayout.tsx).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import DownloadPdfButton from "@/components/DownloadPdfButton";
import { PrimaryBadge } from "@/components/MarkPrimaryButton";
import ProfileViewLayout from "@/components/ProfileViewLayout";
import SavedProfileDocument from "@/components/SavedProfileDocument";
import { getCurrentUser } from "@/lib/auth";
import { primaryProfileOf } from "@/lib/db/teamProfiles";
import { accessFor, canOpenProfileOf, canSeeTeamList, isStaffRole } from "@/lib/teamAccess";
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
  if (!found.ok) return <Message title="Team member data is unavailable" text="We could not look up this IB code right now. Please try again in a few minutes." />;
  const employee = found.data;
  // a team member gets the same answer for an unknown code and for someone else's: codes cannot be probed
  if (!employee) return access.level === "member" ? NOT_AVAILABLE : <Message title="No such team member" text={`No active team member has the IB code ${ibCode.toUpperCase()}.`} />;
  if (!canOpenProfileOf(access, user.email, employee.email)) return NOT_AVAILABLE;

  const result = await primaryProfileOf(user, access, employee.email);
  const facts = [employee.ibCode, employee.deliveryUnit, employee.department].filter(Boolean).join(" · ");
  // where "back" goes: the Profile Hub for those who have one, otherwise My Profiles
  const back = isStaffRole(user.role) || canSeeTeamList(access) ? { href: "/manage", label: "Profile Hub" } : { href: "/profiles", label: "My Profiles" };

  if (result.status !== "ok") {
    return (
      <ProfileViewLayout backHref={back.href} backLabel={back.label} name={employee.name} role={employee.role ?? undefined} facts={facts ? [facts] : []}>
        <div className="border border-gray-200 bg-white px-4 py-14 text-center shadow-sm" data-profile-link-state={result.status}>
          <h2 className="text-xl font-medium text-ink-dark">{result.status === "none" ? "No profile yet" : "This profile could not be loaded"}</h2>
          <p className="mt-2 text-sm text-ink-light">
            {result.status === "none" ? `${employee.name} has no primary profile yet.` : "Please try again in a few minutes."}
          </p>
        </div>
      </ProfileViewLayout>
    );
  }

  const shown = result.version;
  const data = shown.data as { name?: string; jobTitle?: string };
  return (
    <ProfileViewLayout
      backHref={back.href}
      backLabel={back.label}
      name={data.name?.trim() || employee.name}
      role={data.jobTitle?.trim() || employee.role || undefined}
      facts={[...(facts ? [facts] : []), "Primary profile · read-only"]}
      badges={<PrimaryBadge />}
      // Read-only: the export is made from the version shown; nothing is changed or saved.
      actions={<DownloadPdfButton dock template={shown.template} data={shown.data} versionId={shown.meta.versionId} />}
    >
      <div data-profile-link-state="ok">
        <SavedProfileDocument template={shown.template} data={shown.data} />
      </div>
    </ProfileViewLayout>
  );
}
