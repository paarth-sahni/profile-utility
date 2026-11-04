"use client";

/**
 * Purpose: the editable view of an internal profile on the Preview & Submit step, laid out like the PDF: the header (name,
 * job title, experience, specialization, "A PROUD MEMBER OF" and the logo), the main column (Overview, Education & Training,
 * Projects) and the sidebar (Skills, Certifications, Tools, Managerial Experience, Domain, Languages), as one continuous page.
 * Page breaks are not drawn (they would be guesses): the note says View PDF shows them.
 * Only the text under the headings can be edited (lib/previewEdit.ts decides which fields, from the profile as it was when
 * Preview opened): headings stay real headings, field labels and the header stay plain text, and nothing can be added,
 * removed or moved here. Every edit goes to `onEdit(path, value)`, which updates the same profile data as the Edit page.
 */
import type { ReactNode } from "react";
import PlainTextField from "@/components/PlainTextField";
import type { Range } from "@/components/fields";
import { getAt, type PreviewField, type PreviewLayout } from "@/lib/previewEdit";
import { hasText } from "@/lib/previewModel";
import type { InternalResume } from "@/lib/schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// the PDF's text styles (Lexend; 11pt body text, 10pt red section headings)
const BODY = "font-light text-[14.5px] leading-[1.55] text-ink";
const VALUE = "font-light text-[14.5px] leading-[1.4] text-[#231F20]";
const LABEL = "font-normal text-[14.5px] leading-[1.4] text-ink";
const HEADING = "font-light text-[13px] text-brand-500";

export default function InternalPreviewEditor({
  header,
  layout,
  data,
  onEdit,
  errors,
  highlights,
}: {
  /** The profile as Preview opened it: the read-only header comes from here. */
  header: InternalResume;
  layout: PreviewLayout;
  /** The current profile (the values of the fields). */
  data: InternalResume;
  onEdit: (path: string, value: string) => void;
  /** Field path -> the problem to show on it. */
  errors: Record<string, string>;
  /** Field path -> parts of its text that name a registered client. */
  highlights: Record<string, Range[]>;
}) {
  const edit = (f: PreviewField | null, props: { inline?: boolean; className?: string } = {}) =>
    f && (
      <PlainTextField
        key={f.path}
        field={f}
        value={getAt(data, f.path)}
        onChange={(v) => onEdit(f.path, v)}
        error={errors[f.path]}
        highlights={highlights[f.path]}
        inline={props.inline}
        className={props.className ?? VALUE}
      />
    );
  /** The items of a list printed on one line with ", " between them (tools): one field each. */
  const commaList = (fields: PreviewField[]) =>
    fields.map((f, i) => (
      <span key={f.path}>
        {edit(f, { inline: true })}
        {i < fields.length - 1 && <span className={VALUE}>, </span>}
      </span>
    ));

  return (
    <article aria-label="Your profile, as laid out in the PDF" className="border border-gray-200 bg-white px-5 py-6 shadow-sm sm:px-10 sm:py-8" data-preview-editor>
      <p className="mb-4 border-l-2 border-focus bg-sky-50 px-3 py-2 text-xs text-ink-light">
        Edit the text below. Headings, labels and the layout stay as they are; to add, remove or move items use ← Back to edit.
        <span className="font-medium text-ink"> Page breaks: View PDF.</span>
      </p>

      {/* header (read-only) */}
      <div className="flex flex-col-reverse gap-4 border-b border-[#888888] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[24px] font-medium leading-tight text-ink">{header.name}</p>
          <p className="mt-1 text-[16px] text-ink">{header.jobTitle}</p>
          {hasText(header.experienceSummary) && <p className={`mt-1 ${BODY}`}>{header.experienceSummary}</p>}
          {hasText(header.specialization) && <p className={BODY}>{header.specialization}</p>}
        </div>
        <div className="shrink-0">
          <p className="text-[10px] text-[#666666]">A PROUD MEMBER OF</p>
          <img src={`${BASE}/img/logo.png`} alt="InfoBeans" width={240} height={76} className="mt-2 h-12 w-auto" />
        </div>
      </div>

      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,2.17fr)_minmax(0,1fr)]">
        {/* main column */}
        <div className="min-w-0 space-y-7">
          <Section title="Overview">{edit(layout.overview, { className: BODY })}</Section>

          <Section title="Education & Training">
            {layout.education.map((e) => (
              <div key={e.year.path} className="space-y-1">
                {edit(e.year, { inline: true, className: BODY })}
                {edit(e.qualification, { className: BODY })}
              </div>
            ))}
          </Section>

          {layout.projects.length > 0 && (
            <Section title="Projects">
              <div className="space-y-9">
                {layout.projects.map((p) => (
                  <section key={p.number} aria-labelledby={`preview-project-${p.number}`} className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-1">
                      <h4 id={`preview-project-${p.number}`} className={`${LABEL} underline underline-offset-2`}>
                        Project {p.number}
                      </h4>
                      {p.dates && (
                        <>
                          <span className={`${LABEL} underline underline-offset-2`} aria-hidden>
                            –
                          </span>
                          {edit(p.dates, { inline: true, className: `${LABEL} underline underline-offset-2` })}
                        </>
                      )}
                    </div>
                    {edit(p.name)}
                    {p.tools.length > 0 && (
                      <Labelled label="Tools & Technologies">
                        <p className="leading-[1.8]">{commaList(p.tools)}</p>
                      </Labelled>
                    )}
                    {p.teamSize && <Labelled label="Team Size">{edit(p.teamSize, { inline: true })}</Labelled>}
                    {p.role && <Labelled label="Role">{edit(p.role)}</Labelled>}
                    {p.link && <Labelled label="Project Link">{edit(p.link)}</Labelled>}
                    {p.description && <div className="pt-2">{edit(p.description, { className: BODY })}</div>}
                    {p.bullets.length > 0 && (
                      <ul className="list-disc space-y-1.5 pl-10 pt-2 marker:text-ink">
                        {p.bullets.map((b) => (
                          <li key={b.path} className={BODY}>
                            {edit(b, { className: BODY })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* sidebar */}
        <aside aria-label="Skills and more" className="min-w-0 space-y-7">
          <Section title="Skills">
            <ul className="space-y-3">
              {layout.skills.map((s) => (
                <li key={s.name.path}>
                  {edit(s.name, { className: `${LABEL} text-ink` })}
                  <span className={VALUE}>
                    (
                    {edit(s.rating, { inline: true })}
                    /5)
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <ItemSection title="Certifications" fields={layout.certifications} render={(f) => edit(f)} />
          {layout.tools.length > 0 && (
            <Section title="Tools">
              <p className="leading-[1.8]">{commaList(layout.tools)}</p>
            </Section>
          )}
          <ItemSection title="Managerial Experience" fields={layout.managerialExperience} render={(f) => edit(f)} />
          <ItemSection title="Domain" fields={layout.domains} render={(f) => edit(f)} />
          <ItemSection title="Languages" fields={layout.languages} render={(f) => edit(f)} />
        </aside>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className={`mb-3 ${HEADING}`}>{title}</h3>
      {children}
    </section>
  );
}

/** A field label (read-only plain text, as in the PDF) with its value under it. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      {children}
    </div>
  );
}

/** A sidebar section of one-per-line items; left out when nothing in it is printed. */
function ItemSection({ title, fields, render }: { title: string; fields: PreviewField[]; render: (f: PreviewField) => ReactNode }) {
  if (fields.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {fields.map((f) => (
          <li key={f.path}>{render(f)}</li>
        ))}
      </ul>
    </Section>
  );
}
