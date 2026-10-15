/**
 * Purpose: the list inside the Review "Please double-check" panel. Flags that say the same thing about the same kind of
 * field are shown as one line with a count ("Skills 1–12 → Rating — rating estimated from years of use (12 skills)") that
 * expands (a native <details>, keyboard accessible) to list every flag with its own full field label. A single flag is
 * shown exactly as before. Grouping rules: lib/flagGroups.ts.
 */
import type { ReviewFlag } from "@/lib/extract.types";
import { countText, groupFlags } from "@/lib/flagGroups";
import { describeFlagPath } from "@/lib/reviewFlags";

export default function FlagList({ flags }: { flags: ReviewFlag[] }) {
  const groups = groupFlags(flags);
  return (
    <ul className="space-y-1 text-sm text-amber-900">
      {groups.map((g, i) =>
        g.flags.length === 1 ? (
          <li key={i}>
            {g.label && <span className="font-medium">{g.label}</span>}
            {g.label && " — "}
            {g.reason}
          </li>
        ) : (
          <li key={i} data-flag-group>
            <details>
              <summary className="cursor-pointer">
                <span className="font-medium">{g.label}</span> — {g.reason} <span className="text-amber-700">{countText(g)}</span>
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-6">
                {g.flags.map((f, j) => (
                  <li key={j}>{f.path ? describeFlagPath(f.path) : "This resume"}</li>
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}
