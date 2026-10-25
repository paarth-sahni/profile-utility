"use client";

import { createContext, ReactNode, useContext, useId, useState } from "react";
import { acceptRatingInput } from "@/lib/rating";
import { isNAValue } from "@/lib/schemas";
import { addTags, hasOpenBracket, splitTags } from "@/lib/tags";

/** A comma or a line break ends an item in the tag input. */
const TAG_SEPARATOR = { test: (v: string) => v.includes(",") || v.includes(String.fromCharCode(10)) || v.includes(String.fromCharCode(13)) };

/** Wording shown wherever an optional section has nothing in it: the generated document leaves it out entirely. */
export const LEFT_OUT_NOTE = "— left out of the document";

/** Lets "Expand all / Collapse all" (and "expand on error") reach every Section inside an Accordion. */
const AccordionContext = createContext<{ mode: "open" | "closed"; tick: number }>({ mode: "closed", tick: 0 });

/** Wraps the form sections: adds an Expand all / Collapse all control and shares it with each Section. */
export function Accordion({ children, expandTick = 0 }: { children: ReactNode; expandTick?: number }) {
  const [signal, setSignal] = useState<{ mode: "open" | "closed"; tick: number }>({ mode: "closed", tick: 0 });
  // A parent (e.g. "can't generate yet") can ask for everything to open so the user can find the problem fields.
  const [lastExpand, setLastExpand] = useState(expandTick);
  if (expandTick !== lastExpand) {
    setLastExpand(expandTick);
    setSignal((s) => ({ mode: "open", tick: s.tick + 1 }));
  }
  const bump = (mode: "open" | "closed") => setSignal((s) => ({ mode, tick: s.tick + 1 }));
  return (
    <AccordionContext.Provider value={signal}>
      <div className="space-y-3">
        <div className="flex justify-end gap-3 text-xs font-medium">
          <button type="button" onClick={() => bump("open")} className="text-brand-600 hover:underline">
            Expand all
          </button>
          <span className="text-gray-300" aria-hidden>
            |
          </span>
          <button type="button" onClick={() => bump("closed")} className="text-brand-600 hover:underline">
            Collapse all
          </button>
        </div>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

/** A collapsible form section. Collapsed by default; pass `defaultOpen` for the first one. */
export function Section({
  title,
  children,
  actions,
  onRemove,
  defaultOpen = false,
  empty = false,
  invalid = false,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onRemove?: () => void;
  defaultOpen?: boolean;
  /** True when a required field inside needs attention: the section is highlighted in yellow ("needs attention"). */
  invalid?: boolean;
  /** True for an OPTIONAL section with nothing real in it: shows that it will be left out of the document. */
  empty?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const signal = useContext(AccordionContext);
  const [seenTick, setSeenTick] = useState(signal.tick);
  const [wasInvalid, setWasInvalid] = useState(invalid);
  if (invalid !== wasInvalid) {
    setWasInvalid(invalid);
    if (invalid) setOpen(true);
  }
  if (signal.tick !== seenTick) {
    setSeenTick(signal.tick);
    setOpen(signal.mode === "open");
  }
  return (
    <section className={`border shadow-sm ${invalid ? "border-amber-300 bg-warm" : "border-gray-200 bg-white"}`} data-needs-attention={invalid ? "true" : undefined}>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-ink-light transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <h3 className={`truncate text-sm font-medium uppercase tracking-wide ${invalid ? "text-ink-dark" : "text-gray-700"}`}>
            {title}
            {invalid && <span className="ml-2 text-xs font-medium normal-case tracking-normal text-amber-800">needs attention</span>}
            {empty && <span className="ml-2 text-xs font-normal normal-case tracking-normal text-gray-400">{LEFT_OUT_NOTE}</span>}
          </h3>
        </button>
        {open && (
          <div className="flex items-center gap-2">
            {actions}
            {onRemove && (
              <button
                type="button"
                title="Remove section"
                onClick={onRemove}
                className="p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      {/* kept mounted (just hidden) so nothing typed inside is ever lost */}
      <div id={bodyId} hidden={!open} className={`space-y-4 border-t px-5 pb-5 pt-4 ${invalid ? "border-amber-200" : "border-hairline"}`}>
        {children}
      </div>
    </section>
  );
}

/** A span of text to highlight (end exclusive), e.g. a registered client name found in a field. */
export type Range = { start: number; end: number };

/**
 * Shows the text of a field with the flagged parts marked, under the field. Long text is cut to a little context around each
 * flagged part. It only displays: nothing is changed or removed for the user, who edits the field themselves.
 */
export function MarkedText({ text, ranges }: { text: string; ranges: Range[] }) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const CONTEXT = 50;
  const parts: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((r, i) => {
    if (r.start < cursor || r.end > text.length) return;
    const before = text.slice(cursor, r.start);
    parts.push(
      <span key={`b${i}`}>{text.length > 240 && before.length > CONTEXT * 2 ? `${cursor === 0 ? "…" : ""}${before.slice(0, CONTEXT)} … ${before.slice(-CONTEXT)}` : before}</span>,
      <mark key={`m${i}`} className="bg-brand-100 px-0.5 font-semibold text-brand-700">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  });
  const rest = text.slice(cursor);
  parts.push(<span key="rest">{text.length > 240 && rest.length > CONTEXT ? `${rest.slice(0, CONTEXT)}…` : rest}</span>);
  return (
    <p className="mt-1 break-words border-l-2 border-brand-500 bg-brand-50/60 px-2 py-1 text-xs text-ink" data-compliance-marks="true">
      <span className="font-medium text-brand-700">Found in this text: </span>
      {parts}
    </p>
  );
}

export function Field({
  label,
  value,
  onChange,
  optional = false,
  numeric = false,
  maxWords,
  hint,
  error,
  highlights,
  rating = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Parts of the text that name a registered client; shown marked under the field. */
  highlights?: Range[];
  /** When true, shows a ✕ to clear the value so this field is left out of the final document. */
  optional?: boolean;
  /** Restrict input to digits — non-digit characters are stripped as the user types. */
  numeric?: boolean;
  /** Cap the input at this many space-separated words (extra words are dropped as you type). */
  maxWords?: number;
  /** Helper text shown under the input (e.g. a live preview of the formatted value). */
  hint?: ReactNode;
  /** A problem with this field: highlights it in red and shows the message under it. */
  error?: string;
  /** A skill rating: above 0 and at most 5, one decimal. Anything else cannot be typed. */
  rating?: boolean;
}) {
  const showNAHint = optional && isNAValue(value);
  const handleChange = (raw: string) => {
    if (rating) {
      onChange(acceptRatingInput(value, raw));
      return;
    }
    let v = numeric ? raw.replace(/[^0-9]/g, "") : raw;
    if (maxWords) {
      const words = v.split(/\s+/);
      // keep the raw text (incl. a trailing space being typed) until it exceeds the cap,
      // then snap back to just the first `maxWords` words.
      if (words.filter(Boolean).length > maxWords) v = words.filter(Boolean).slice(0, maxWords).join(" ");
    }
    onChange(v);
  };
  return (
    <label className="block" data-invalid={error ? "true" : undefined}>
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600">
        {label}
        {optional && <span className="font-normal text-gray-400">(optional)</span>}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode={rating ? "decimal" : numeric ? "numeric" : undefined}
          maxLength={rating ? 3 : undefined}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className={`w-full border py-2 pl-3 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus ${
            optional ? "pr-8" : "pr-3"
          } ${error ? "border-brand-500 bg-brand-50/40" : showNAHint ? "border-amber-400" : "border-gray-300"}`}
        />
        {optional && value.trim() !== "" && (
          <button
            type="button"
            title="Remove this field from the final document"
            onClick={() => onChange("")}
            className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-400 transition hover:text-red-500"
          >
            ✕
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-brand-600">{error}</p>}
      {highlights && highlights.length > 0 && <MarkedText text={value} ranges={highlights} />}
      {hint && !showNAHint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {showNAHint && (
        <p className="mt-1 text-xs text-amber-600">
          Not found in the resume — it will be left out of the final document automatically. Add the real value here
          if you have it.
        </p>
      )}
    </label>
  );
}

export function AreaField({
  label,
  value,
  onChange,
  rows = 4,
  optional = false,
  error,
  highlights,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Parts of the text that name a registered client; shown marked under the field. */
  highlights?: Range[];
  rows?: number;
  /** Marks the field "(optional)": when empty it is left out of the document. */
  optional?: boolean;
  /** A problem with this field: highlights it in red and shows the message under it. */
  error?: string;
}) {
  return (
    <label className="block" data-invalid={error ? "true" : undefined}>
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-gray-600">
        {label}
        {optional && <span className="font-normal text-gray-400">(optional)</span>}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border px-3 py-2 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus ${
          error ? "border-brand-500 bg-brand-50/40" : "border-gray-300"
        }`}
      />
      {error && <p className="mt-1 text-xs font-medium text-brand-600">{error}</p>}
      {highlights && highlights.length > 0 && <MarkedText text={value} ranges={highlights} />}
    </label>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border border-dashed border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
    >
      + {label}
    </button>
  );
}

/** Up / down / remove controls for an array item. */
export function ItemControls({
  index,
  length,
  onMove,
  onRemove,
}: {
  index: number;
  length: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const btn = "p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button type="button" title="Move up" className={btn} disabled={index === 0} onClick={() => onMove(index, index - 1)}>↑</button>
      <button type="button" title="Move down" className={btn} disabled={index === length - 1} onClick={() => onMove(index, index + 1)}>↓</button>
      <button type="button" title="Remove" className={`${btn} hover:text-red-600`} disabled={length === 1} onClick={() => onRemove(index)}>✕</button>
    </span>
  );
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Editable list of plain strings with add / remove / reorder. */
export function StringListEditor({
  label,
  items,
  onChange,
  addLabel = "Add item",
  multiline = false,
  marks,
}: {
  label?: string;
  items: string[];
  onChange: (items: string[]) => void;
  addLabel?: string;
  multiline?: boolean;
  /** Per-item problem and highlighted parts (e.g. a registered client name inside a bullet). */
  marks?: (index: number) => { error?: string; highlights?: Range[] };
}) {
  const update = (i: number, v: string) => onChange(items.map((s, j) => (j === i ? v : s)));
  return (
    <div>
      {label && <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>}
      <div className="space-y-2">
        {items.map((item, i) => {
          const mark = marks?.(i);
          const box = `w-full border px-3 py-1.5 text-sm text-ink focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus ${
            mark?.error ? "border-brand-500 bg-brand-50/40" : "border-gray-300"
          }`;
          return (
          <div key={i} className="flex items-start gap-2" data-invalid={mark?.error ? "true" : undefined}>
            <div className="w-full">
            {multiline ? (
              <textarea value={item} rows={2} onChange={(e) => update(i, e.target.value)} className={box} />
            ) : (
              <input type="text" value={item} onChange={(e) => update(i, e.target.value)} className={box} />
            )}
            {mark?.error && <p className="mt-1 text-xs font-medium text-brand-600">{mark.error}</p>}
            {mark?.highlights && mark.highlights.length > 0 && <MarkedText text={item} ranges={mark.highlights} />}
            </div>
            <ItemControls
              index={i}
              length={items.length}
              onMove={(from, to) => onChange(moveItem(items, from, to))}
              onRemove={(idx) => onChange(items.filter((_, j) => j !== idx))}
            />
          </div>
          );
        })}
        <AddButton label={addLabel} onClick={() => onChange([...items, ""])} />
      </div>
    </div>
  );
}

/** Card wrapper for an item of an object array (project, experience entry, ...). */
export function ItemCard({
  title,
  index,
  length,
  onMove,
  onRemove,
  children,
}: {
  title: string;
  index: number;
  length: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  children: ReactNode;
}) {
  return (
    <div className="border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">{title}</span>
        <ItemControls index={index} length={length} onMove={onMove} onRemove={onRemove} />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

/** Collapsed bar for an optional section the user removed; "Restore" brings the editor back. */
export function RemovedSection({ title, onRestore }: { title: string; onRestore: () => void }) {
  return (
    <div className="flex items-center justify-between border border-dashed border-gray-300 bg-gray-50 px-5 py-3">
      <span className="text-sm text-gray-400">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        <span className="ml-2">{LEFT_OUT_NOTE}</span>
      </span>
      <button type="button" onClick={onRestore} className="text-xs font-medium text-brand-600 hover:underline">
        Restore
      </button>
    </div>
  );
}

/**
 * Compact editor for SHORT list items (tools, domains, languages, skills): the items show as removable chips and
 * you type in one box. Enter or a comma adds what you typed; pasting "a, b, c" adds all of them; Backspace in the
 * empty box removes the last chip. The data is still a plain string[].
 */
export function TagInput({
  label,
  items,
  onChange,
  placeholder = "Type and press Enter or comma",
  error,
  itemError,
}: {
  label?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  error?: string;
  /** Problem with the item at this position of `items` (e.g. a registered client name): the chip turns red. */
  itemError?: (index: number) => string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const tags = items.map((t) => t.trim()).filter(Boolean);
  // chips skip blank items, so keep each chip's position in `items` to look its problem up
  const chipProblems = items.flatMap((t, idx) => (t.trim() && itemError?.(idx) ? [t.trim()] : []));

  const commit = (text: string) => {
    if (!splitTags(text).length) return;
    onChange(addTags(tags, text));
    setDraft("");
  };

  return (
    <div data-invalid={error || chipProblems.length > 0 ? "true" : undefined}>
      {label && <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>}
      <div
        className={`flex flex-wrap items-center gap-1.5 border bg-white px-2 py-1.5 focus-within:border-focus focus-within:ring-1 focus-within:ring-focus ${
          error || chipProblems.length > 0 ? "border-brand-500 bg-brand-50/40" : "border-gray-300"
        }`}
      >
        {tags.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs text-ink ring-1 ${
              chipProblems.includes(t) ? "bg-brand-100 font-semibold text-brand-700 ring-brand-500" : "bg-cream ring-hairline"
            }`}
          >
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(tags.filter((_, j) => j !== i))}
              className="text-gray-400 transition hover:text-brand-600"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          placeholder={tags.length ? "" : placeholder}
          aria-label={label ?? "Add item"}
          onChange={(e) => {
            const v = e.target.value;
            // a typed or pasted comma / line break finishes the item(s), unless it sits inside an open bracket
            if (TAG_SEPARATOR.test(v) && !hasOpenBracket(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft === "" && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-ink focus:outline-none"
        />
      </div>
      {error && <p className="mt-1 text-xs font-medium text-brand-600">{error}</p>}
      {!error && chipProblems.length > 0 && (
        <p className="mt-1 text-xs font-medium text-brand-600" data-compliance-marks="true">
          Registered client, company or project name found: {chipProblems.map((t) => `“${t}”`).join(", ")}. Remove or rephrase it.
        </p>
      )}
    </div>
  );
}
