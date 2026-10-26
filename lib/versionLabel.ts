/**
 * Purpose: automatic names for saved versions. Versions are not named by the user: the first version of a profile is
 * "Base", then "v2", "v3", ... matching the version number. The server applies it when it saves
 * (lib/db/profilesCore.ts), so a version opened from My Profiles also gets the next number of its profile.
 * Pure; unit-tested (lib/versionLabel.test.ts).
 */

export const BASE_LABEL = "Base";

/** The label of version number `no` (1-based): "Base" for the first, else "v<no>". */
export function labelForVersion(no: number): string {
  return no <= 1 ? BASE_LABEL : `v${no}`;
}
