"use client";

/**
 * Purpose: the filters of the Profile Hub team list. Nothing to submit: choosing "My team" / "All team members", a delivery unit or
 * a department applies at once, and typing in the search box applies after a short pause. The filters live in the URL (?scope=,
 * ?du=, ?dept=, ?q=), so the page can be bookmarked or shared, and the list itself is still rendered on the server
 * (components/TeamList.tsx). The parent gives this component a `key` built from scope, delivery unit and department, so a change
 * made elsewhere on the page (the "Show all team members" link) resets the controls to match the URL.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { teamHref, type TeamFilters } from "@/lib/teamList";

const SEARCH_PAUSE_MS = 300;

const control = "w-full border border-gray-300 bg-white px-3 py-2 text-sm text-ink-dark focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const label = "mb-1 block text-xs font-medium text-ink-light";

export default function TeamFilterBar({ initial, deliveryUnits, departments }: { initial: TeamFilters; deliveryUnits: string[]; departments: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<TeamFilters>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const apply = (next: TeamFilters) => {
    setFilters(next);
    startTransition(() => router.replace(teamHref(next), { scroll: false }));
  };
  const change = (patch: Partial<TeamFilters>) => {
    if (timer.current) clearTimeout(timer.current);
    apply({ ...filters, ...patch });
  };
  const typeSearch = (q: string) => {
    const next = { ...filters, q };
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), SEARCH_PAUSE_MS);
  };
  const hasFilters = filters.deliveryUnit !== "" || filters.department !== "" || filters.q !== "";

  return (
    <div className={`flex flex-wrap items-end gap-x-4 gap-y-3 border border-gray-200 bg-white p-4 shadow-sm ${pending ? "opacity-70" : ""}`} data-team-filters aria-busy={pending}>
      <div role="group" aria-label="Show" className="flex">
        {(["mine", "all"] as const).map((scope) => {
          const on = filters.scope === scope;
          return (
            <button
              key={scope}
              type="button"
              aria-pressed={on}
              onClick={() => change({ scope })}
              className={`border px-4 py-2 text-sm font-medium first:border-r-0 ${on ? "border-brand-500 bg-brand-500 text-white" : "border-gray-300 bg-white text-ink hover:bg-gray-50"}`}
            >
              {scope === "mine" ? "My team" : "All team members"}
            </button>
          );
        })}
      </div>
      <div className="min-w-[11rem] flex-1 sm:flex-none">
        <label htmlFor="team-du" className={label}>
          Delivery unit
        </label>
        <select id="team-du" value={filters.deliveryUnit} onChange={(e) => change({ deliveryUnit: e.target.value })} className={control}>
          <option value="">All delivery units</option>
          {deliveryUnits.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[11rem] flex-1 sm:flex-none">
        <label htmlFor="team-dept" className={label}>
          Department
        </label>
        <select id="team-dept" value={filters.department} onChange={(e) => change({ department: e.target.value })} className={control}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[12rem] flex-1">
        <label htmlFor="team-q" className={label}>
          Name or IB code
        </label>
        <input id="team-q" type="search" maxLength={100} value={filters.q} onChange={(e) => typeSearch(e.target.value)} placeholder="e.g. Asha or IB1234" className={control} />
      </div>
      {hasFilters && (
        <button type="button" onClick={() => change({ deliveryUnit: "", department: "", q: "" })} className="pb-2 text-sm font-medium text-brand-600 hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}
