"use client";

/**
 * Purpose: one editable piece of text on the Preview & Submit step, styled like the PDF text around it. A real <input> (short
 * values shown inline: a tool, the dates, a rating, the year, the team size) or an auto-growing <textarea> (everything that
 * can wrap), so it is plain text by nature: pasted formatting never arrives, and `cleanText` removes control and zero-width
 * characters and, except in the overview and the description, line breaks (Enter does nothing there). A rating accepts only
 * what lib/rating.ts allows; the dates are tidied with lib/dates.ts when the field is left, and a date that cannot be read
 * without guessing stays as typed with a hint. The accessible name is the field's label ("Project 2, Role"); a problem
 * sets aria-invalid and is read through aria-describedby. `data-edit-path` lets the step move focus to a field.
 */
import { useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { MarkedText, type Range } from "@/components/fields";
import { normalizeDuration } from "@/lib/dates";
import { cleanText, type PreviewField } from "@/lib/previewEdit";
import { acceptRatingInput } from "@/lib/rating";

const DATE_HINT = "We could not read this date. Write it like “Feb 2020 – Jun 2021” or “Feb 2020 – Present”.";

export default function PlainTextField({
  field,
  value,
  onChange,
  error,
  highlights,
  inline = false,
  className = "",
}: {
  field: PreviewField;
  value: string;
  onChange: (value: string) => void;
  /** A problem with this field (required, "N/A", an empty item, a registered client name). */
  error?: string;
  /** Parts of the text that name a registered client; shown marked under the field. */
  highlights?: Range[];
  /** A short value inside a line of text: an <input> as wide as its text. */
  inline?: boolean;
  /** The text style (font, size, colour) of the PDF text it stands for. */
  className?: string;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [unreadableDate, setUnreadableDate] = useState(false);
  const multiline = field.kind === "multiline";

  // a textarea grows with its text (one line when empty), so the view keeps the shape of the PDF; again whenever its width
  // changes (a narrower window wraps the text onto more lines)
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);

  const change = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const raw = e.target.value;
    if (field.kind === "rating") onChange(acceptRatingInput(value, raw.trim()));
    else onChange(cleanText(raw, multiline));
    if (field.kind === "date") setUnreadableDate(false);
  };

  const tidyDate = () => {
    if (field.kind !== "date") return;
    const { value: tidy, ok } = normalizeDuration(value);
    setUnreadableDate(!ok);
    if (ok && tidy !== value) onChange(tidy);
  };

  const hint = field.kind === "date" && unreadableDate && !error ? DATE_HINT : null;
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  // a dashed line shows where text can be edited; a problem gets a red frame, visible even when the field is empty
  const look = `text-inherit outline-offset-2 transition hover:bg-sky-50 focus:bg-sky-50 ${
    error ? "min-h-[1.6em] border border-brand-500 bg-brand-50/60" : "border-b border-dashed border-gray-300 bg-transparent"
  } ${className}`;
  const common = {
    "aria-label": field.label,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "data-edit-path": field.path,
    "data-invalid": error ? "true" : undefined,
    value,
    onChange: change,
    onBlur: tidyDate,
    spellCheck: field.kind === "text" || multiline,
  } as const;

  const notes = (
    <>
      {error && (
        <span id={`${id}-error`} className="mt-0.5 block text-xs font-medium text-brand-600">
          {error}
        </span>
      )}
      {hint && (
        <span id={`${id}-hint`} className="mt-0.5 block text-xs text-amber-700">
          {hint}
        </span>
      )}
      {highlights && highlights.length > 0 && <MarkedText text={value} ranges={highlights} />}
    </>
  );

  if (inline) {
    return (
      <span className="inline-flex max-w-full flex-col align-baseline">
        <input
          type="text"
          inputMode={field.kind === "rating" ? "decimal" : undefined}
          maxLength={field.kind === "rating" ? 3 : undefined}
          size={Math.max(value.length, field.kind === "rating" ? 2 : 3)}
          className={`min-w-[2ch] max-w-full px-0.5 [field-sizing:content] ${look}`}
          {...common}
        />
        {notes}
      </span>
    );
  }
  return (
    <span className="block">
      <textarea
        ref={area}
        rows={1}
        className={`block w-full resize-none overflow-hidden px-0.5 ${look}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) e.preventDefault(); // one line of text: Enter would add nothing
        }}
        {...common}
      />
      {notes}
    </span>
  );
}
