/**
 * Purpose: the Profile Hub team list's filters, pure (unit-tested in lib/teamList.test.ts): scope (my team / all team
 * members), delivery unit, department, and a search by name or IB code. The employees come from the Teams data at request
 * time (lib/teamsClient.ts); nothing here is stored.
 */
import type { Employee } from "./teamsClient";

export type TeamScope = "mine" | "all";
export type TeamFilters = { scope: TeamScope; deliveryUnit: string; department: string; q: string };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 100) ?? "";

/** The filters from the page's query string (?scope=, ?du=, ?dept=, ?q=); anything unexpected becomes the default. */
export function parseTeamFilters(sp: Record<string, string | string[] | undefined>): TeamFilters {
  return { scope: one(sp.scope) === "all" ? "all" : "mine", deliveryUnit: one(sp.du), department: one(sp.dept), q: one(sp.q) };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The employees that match the delivery unit, department and search (name contains, or IB code starts with), sorted by name. */
export function filterTeam(employees: Employee[], f: Pick<TeamFilters, "deliveryUnit" | "department" | "q">): Employee[] {
  const q = norm(f.q);
  return employees
    .filter((e) => !f.deliveryUnit || e.deliveryUnit === f.deliveryUnit)
    .filter((e) => !f.department || e.department === f.department)
    .filter((e) => !q || norm(e.name).includes(q) || norm(e.ibCode).startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
