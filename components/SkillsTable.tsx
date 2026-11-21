"use client";

/**
 * Purpose: the internal Edit page's skills as a compact table, one row per skill: Skill | Rating | move up / down | remove, with
 * "Add skill" below. The rating follows the same rule as everywhere (above 0, at most 5, one decimal: acceptRatingInput). A
 * row's problems (a required field, a registered client name) show on that row, and the cell is marked data-invalid so "go to
 * the first problem" finds it. Every input has its own name for screen readers ("Skill 3 name", "Skill 3 rating"), and every
 * button says which skill it acts on. After "Add skill" the new row's name box gets the focus.
 */
import { useEffect, useId, useRef, useState } from "react";
import { acceptRatingInput } from "@/lib/rating";
import type { InternalResume } from "@/lib/schemas";
import { AddButton, MarkedText, moveItem, type Range } from "./fields";

type Skill = InternalResume["skills"][number];
type Marks = { error?: string; highlights?: Range[] };

export default function SkillsTable({
  skills,
  onChange,
  marks,
}: {
  skills: Skill[];
  onChange: (skills: Skill[]) => void;
  /** The problem and the marked parts of a field, by path ("skills.2.name", "skills.2.rating"). */
  marks: (path: string) => Marks;
}) {
  const id = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    tableRef.current?.querySelector<HTMLInputElement>(`[data-skill-row='${focusRow}'] input`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const setAt = (i: number, patch: Partial<Skill>) => onChange(skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const box = (bad: boolean) =>
    `w-full border px-2.5 py-1.5 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus ${bad ? "border-brand-500 bg-brand-50/40" : "border-gray-300"}`;
  const btn = "p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full min-w-[22rem] border-collapse text-sm">
          <caption className="sr-only">Skills, each with a rating out of 5</caption>
          <thead>
            <tr className="text-left text-xs font-medium text-gray-600">
              <th scope="col" className="w-8 pb-1 pr-2 font-medium">
                <span className="sr-only">Number</span>
              </th>
              <th scope="col" className="pb-1 pr-2 font-medium">
                Skill
              </th>
              <th scope="col" className="w-28 pb-1 pr-2 font-medium">
                Rating <span className="font-normal text-gray-400">(out of 5)</span>
              </th>
              <th scope="col" className="w-24 pb-1 font-medium">
                <span className="sr-only">Order and remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s, i) => {
              const n = i + 1;
              const name = marks(`skills.${i}.name`);
              const rating = marks(`skills.${i}.rating`);
              const nameErr = name.error ? `${id}-name-${i}` : undefined;
              const ratingErr = rating.error ? `${id}-rating-${i}` : undefined;
              return (
                <tr key={i} data-skill-row={i} className="align-top">
                  <td className="py-1 pr-2 pt-2.5 text-xs text-gray-500">{n}</td>
                  <td className="py-1 pr-2" data-invalid={name.error ? "true" : undefined}>
                    <input
                      type="text"
                      aria-label={`Skill ${n} name`}
                      aria-invalid={name.error ? true : undefined}
                      aria-describedby={nameErr}
                      value={s.name}
                      onChange={(e) => setAt(i, { name: e.target.value })}
                      className={box(!!name.error)}
                    />
                    {name.error && (
                      <p id={nameErr} className="mt-1 text-xs font-medium text-brand-600">
                        {name.error}
                      </p>
                    )}
                    {name.highlights && name.highlights.length > 0 && <MarkedText text={s.name} ranges={name.highlights} />}
                  </td>
                  <td className="py-1 pr-2" data-invalid={rating.error ? "true" : undefined}>
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={3}
                      placeholder="e.g. 4.5"
                      aria-label={`Skill ${n} rating`}
                      aria-invalid={rating.error ? true : undefined}
                      aria-describedby={ratingErr}
                      value={s.rating}
                      onChange={(e) => setAt(i, { rating: acceptRatingInput(s.rating, e.target.value) })}
                      className={box(!!rating.error)}
                    />
                    {rating.error && (
                      <p id={ratingErr} className="mt-1 text-xs font-medium text-brand-600">
                        {rating.error}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1 pt-1.5">
                    <button type="button" className={btn} aria-label={`Move skill ${n} up`} title="Move up" disabled={i === 0} onClick={() => onChange(moveItem(skills, i, i - 1))}>
                      ↑
                    </button>
                    <button type="button" className={btn} aria-label={`Move skill ${n} down`} title="Move down" disabled={i === skills.length - 1} onClick={() => onChange(moveItem(skills, i, i + 1))}>
                      ↓
                    </button>
                    <button type="button" className={`${btn} hover:text-red-600`} aria-label={`Remove skill ${n}`} title="Remove" disabled={skills.length === 1} onClick={() => onChange(skills.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AddButton
        label="Add skill"
        onClick={() => {
          onChange([...skills, { name: "", rating: "" }]);
          setFocusRow(skills.length);
        }}
      />
    </div>
  );
}
