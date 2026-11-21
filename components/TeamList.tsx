/**
 * Purpose: the Profile Hub team list (server component): a plain table of active employees from the Teams data, read at request
 * time (nothing stored): name, IB code, role, delivery unit, department, whether they have a primary profile here (by email),
 * and View (opens /profile/<ib_code>; disabled without a profile or an IB code). "My team" (default) is everyone under the
 * signed-in person, direct and indirect; "All team members" everyone. Filters for delivery unit and department, search by name
 * or IB code: a GET form, so the filters live in the URL. The caller has checked canSeeTeamList.
 */
import Form from "next/form";
import Link from "next/link";
import { primaryEmailsAmong } from "@/lib/db/teamProfiles";
import type { TeamAccess } from "@/lib/teamAccess";
import { filterTeam, type TeamFilters } from "@/lib/teamList";
import { teams } from "@/lib/teamsClient";

const MAX_ROWS = 500;

function Unavailable() {
  return (
    <p role="status" className="border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700" data-team-list="unavailable">
      Team list unavailable. The employee data could not be read right now; please try again in a few minutes.
    </p>
  );
}

export default async function TeamList({ user, access, filters }: { user: { id: string; email: string }; access: TeamAccess; filters: TeamFilters }) {
  const [people, units] = await Promise.all([filters.scope === "all" ? teams.all() : teams.team(user.email), teams.units()]);
  if (!people.ok || !units.ok) return <Unavailable />;
  const shown = filterTeam(people.data, filters);
  const withProfile = await primaryEmailsAmong(user, access, shown.map((e) => e.email));
  const select = "w-full border border-gray-300 bg-white px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-medium text-ink-light";

  return (
    <section aria-labelledby="team-list-heading" data-team-list="ready">
      <h2 id="team-list-heading" className="sr-only">
        Team list
      </h2>
      <Form action="/manage" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="team" />
        <fieldset className="flex items-center gap-4">
          <legend className={label}>Show</legend>
          {(["mine", "all"] as const).map((scope) => (
            <label key={scope} className="flex items-center gap-1.5 text-sm text-ink-dark">
              <input type="radio" name="scope" value={scope} defaultChecked={filters.scope === scope} />
              {scope === "mine" ? "My team" : "All team members"}
            </label>
          ))}
        </fieldset>
        <div className="min-w-[10rem]">
          <label htmlFor="team-du" className={label}>
            Delivery unit
          </label>
          <select id="team-du" name="du" defaultValue={filters.deliveryUnit} className={select}>
            <option value="">All delivery units</option>
            {units.data.deliveryUnits.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem]">
          <label htmlFor="team-dept" className={label}>
            Department
          </label>
          <select id="team-dept" name="dept" defaultValue={filters.department} className={select}>
            <option value="">All departments</option>
            {units.data.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="team-q" className={label}>
            Name or IB code
          </label>
          <input id="team-q" name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="e.g. Asha or IB1234" className="w-full border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
          Apply
        </button>
      </Form>

      <div className="mt-5" aria-live="polite">
        {shown.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-lg font-medium text-ink-dark">{people.data.length === 0 && filters.scope === "mine" ? "No one reports to you in the employee data" : "No one matches these filters"}</p>
            {filters.scope === "mine" && (
              <p className="mt-1 text-sm text-ink-light">
                <Link href="/manage?tab=team&scope=all" className="font-medium text-brand-600 hover:underline">
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
