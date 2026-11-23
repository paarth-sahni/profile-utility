/**
 * Purpose: the Profile Hub team list (server component): a plain table of active employees from the Teams data, read at request
 * time (nothing stored): name, IB code, role, delivery unit, department, whether they have a primary profile here (by email),
 * and View (opens /profile/<ib_code>; disabled without a profile or an IB code). "My team" (default) is everyone under the
 * signed-in person, direct and indirect; "All team members" everyone. Filters for delivery unit and department, search by name
 * or IB code (components/TeamFilterBar.tsx): applied as soon as they change, kept in the URL. The caller has checked canSeeTeamList.
 */
import Link from "next/link";
import TeamFilterBar from "@/components/TeamFilterBar";
import { primaryEmailsAmong } from "@/lib/db/teamProfiles";
import type { TeamAccess } from "@/lib/teamAccess";
import { filterTeam, teamHref, type TeamFilters } from "@/lib/teamList";
import { teams } from "@/lib/teamsClient";

const MAX_ROWS = 500;

function Unavailable() {
  return (
    <p role="status" className="border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700" data-team-list="unavailable">
      Team list unavailable. The team member data could not be read right now; please try again in a few minutes.
    </p>
  );
}

export default async function TeamList({ user, access, filters }: { user: { id: string; email: string }; access: TeamAccess; filters: TeamFilters }) {
  const [people, units] = await Promise.all([filters.scope === "all" ? teams.all() : teams.team(user.email), teams.units()]);
  if (!people.ok || !units.ok) return <Unavailable />;
  const shown = filterTeam(people.data, filters);
  const withProfile = await primaryEmailsAmong(user, access, shown.map((e) => e.email));

  return (
    <section aria-labelledby="team-list-heading" data-team-list="ready">
      <h2 id="team-list-heading" className="sr-only">
        Team list
      </h2>
      <TeamFilterBar
        key={`${filters.scope}|${filters.deliveryUnit}|${filters.department}`}
        initial={filters}
        deliveryUnits={units.data.deliveryUnits}
        departments={units.data.departments}
      />

      <div className="mt-5" aria-live="polite">
        {shown.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-lg font-medium text-ink-dark">{people.data.length === 0 && filters.scope === "mine" ? "No team members report to you yet" : "No one matches these filters"}</p>
            {filters.scope === "mine" && (
              <p className="mt-1 text-sm text-ink-light">
                <Link href={teamHref({ ...filters, scope: "all" })} className="font-medium text-brand-600 hover:underline">
                  Show all team members
                </Link>
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-light">
              {shown.length} {shown.length === 1 ? "person" : "people"}
              {filters.scope === "mine" ? " in your team" : ""}
              {shown.length > MAX_ROWS ? ` (the first ${MAX_ROWS} are shown: narrow the filters to see the rest)` : ""}
              {withProfile === null ? " · whether each has a profile could not be checked" : ""}
            </p>
            <div className="overflow-x-auto border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{filters.scope === "mine" ? "My team" : "All team members"}</caption>
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-ink-light">
                  <tr>
                    {["Name", "IB code", "Role", "Delivery unit", "Department", "Profile", ""].map((h, i) => (
                      <th key={i} scope="col" className="px-4 py-2.5 font-medium">
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {shown.slice(0, MAX_ROWS).map((e) => {
                    const has = withProfile?.has(e.email) ?? false;
                    const canView = has && e.ibCode !== null;
                    return (
                      <tr key={e.email} data-team-row={e.ibCode ?? ""}>
                        <th scope="row" className="px-4 py-2.5 font-medium text-ink-dark">
                          {e.name}
                        </th>
                        <td className="px-4 py-2.5">{e.ibCode ?? "—"}</td>
                        <td className="px-4 py-2.5">{e.role ?? "—"}</td>
                        <td className="px-4 py-2.5">{e.deliveryUnit ?? "—"}</td>
                        <td className="px-4 py-2.5">{e.department ?? "—"}</td>
                        <td className="px-4 py-2.5">{withProfile === null ? "—" : has ? "Yes" : "No"}</td>
                        <td className="px-4 py-2.5 text-right">
                          {canView ? (
                            <Link href={`/profile/${encodeURIComponent(e.ibCode as string)}`} className="inline-block border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-50" aria-label={`View ${e.name}'s profile`}>
                              View
                            </Link>
                          ) : (
                            <button type="button" disabled className="border border-gray-200 px-3 py-1.5 text-xs font-medium text-ink-light opacity-60" aria-label={`View ${e.name}'s profile (${e.ibCode ? "no profile yet" : "no IB code"})`}>
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
