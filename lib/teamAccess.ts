/**
 * Purpose: who may see the team list and whose /profile/<ib_code> they may open. Decided on the server for every request;
 * nothing from the browser is trusted.
 *   - staff: app role manager or admin. Team list, and any active employee's primary profile.
 *   - lead: anyone with at least one reportee in the Teams data (lib/teamsClient.ts hasReportees), even with app role
 *     team_member (or checker). The same as staff.
 *   - member: everyone else. No team list; only their own profile link.
 * When the Teams data is unavailable nobody is a lead: a team member keeps only their own access; managers and admins keep
 * theirs. Pure decisions here (unit-tested in lib/teamAccess.test.ts); accessFor() asks the Teams data. Server-only.
 */
import "server-only";
import type { TeamsClient, TeamsResult } from "./teamsClient";

export type AccessLevel = "staff" | "lead" | "member";
export type TeamAccess = { level: AccessLevel; teamsAvailable: boolean };

export const isStaffRole = (role: string): boolean => role === "manager" || role === "admin";

/** The access of a user with this app role, given whether the Teams data says people report to them. */
export function decideAccess(role: string, reportees: TeamsResult<boolean>): TeamAccess {
  const staff = isStaffRole(role);
  if (!reportees.ok) return { level: staff ? "staff" : "member", teamsAvailable: false };
  return { level: staff ? "staff" : reportees.data ? "lead" : "member", teamsAvailable: true };
}

/** The team list (Profile Hub): staff and leads. */
export const canSeeTeamList = (access: TeamAccess): boolean => access.level !== "member";

/** Whether the user may open the profile of the employee with `targetEmail`: their own, or anyone's for staff and leads. */
export function canOpenProfileOf(access: TeamAccess, userEmail: string, targetEmail: string): boolean {
  return access.level !== "member" || userEmail.trim().toLowerCase() === targetEmail.trim().toLowerCase();
}

/** The signed-in user's access, from their app role and the Teams data (cached there for 10 minutes). */
export async function accessFor(user: { email: string; role: string }, teams: Pick<TeamsClient, "hasReportees">): Promise<TeamAccess> {
  return decideAccess(user.role, await teams.hasReportees(user.email));
}
