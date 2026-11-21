"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { CUSTOM_LABEL_MAX, CUSTOM_TITLE_MAX, CUSTOM_VALUE_MAX, wordCount, type ExternalResume } from "@/lib/schemas";
import { hasErrorUnder } from "@/lib/fieldErrors";
import { itemTitle } from "@/lib/collapsibleList";
import { Accordion, AddButton, AreaField, CollapsibleItemCard, Field, FieldPairsEditor, ListExpandControls, RemovedSection, Section, StringListEditor, TagInput, moveItem, type Range } from "./fields";
import { useCollapsibleList } from "./useCollapsibleList";

type CustomSection = ExternalResume["customSections"][number];

const BLANK_PROJECT: ExternalResume["projects"][number] = {
  duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""],
};

export default function ExternalForm({
  data,
  onChange,
  expandTick = 0,
  fieldErrors,
  highlights,
}: {
  data: ExternalResume;
  onChange: (data: ExternalResume) => void;
  /** Bumped by the parent to open every section (e.g. when generating fails). */
  expandTick?: number;
  /** Problems with required fields, keyed by field path ("name", "education.0.year", ...). Shown in red. */
  fieldErrors?: Record<string, string>;
  /** Parts of a field's text that name a registered client, keyed by field path. Shown marked under the field. */
  highlights?: Record<string, Range[]>;
}) {
  const [projectsRemoved, setProjectsRemoved] = useState(false);
  // the custom section just added opens by itself, so the title can be typed straight away
  const [openCustom, setOpenCustom] = useState<number | null>(null);
  // a profile from before these sections existed has neither key until it is saved again
  const achievements = data.achievements ?? [];
  const customSections = data.customSections ?? [];

  const set = <K extends keyof ExternalResume>(key: K, value: ExternalResume[K]) =>
    onChange({ ...data, [key]: value });

  const removeProjects = () => { set("projects", []); setProjectsRemoved(true); };
  const restoreProjects = () => { set("projects", [{ ...BLANK_PROJECT }]); setProjectsRemoved(false); };

  const fe = fieldErrors ?? {};
  // client-name check: the message and the flagged text ranges for a field, and the same per bullet / chip
  const hl = highlights ?? {};
  const mk = (path: string) => ({ error: fe[path], highlights: hl[path] });
  const listMarks = (base: string) => (i: number) => mk(`${base}.${i}`);
  const tagError = (base: string) => (i: number) => fe[`${base}.${i}`];
  // a project / employer needs attention when any field in it has a problem (a required field, or a registered client name)
  const problemUnder = (prefix: string) => hasErrorUnder(fe, prefix) || Object.entries(hl).some(([k, r]) => r.length > 0 && (k === prefix || k.startsWith(`${prefix}.`)));
  const projectNeeds = data.projects.map((_, i) => problemUnder(`projects.${i}`));
  const employerNeeds = data.experience.map((_, i) => problemUnder(`experience.${i}`));
  const projectCards = useCollapsibleList(data.projects.length, projectNeeds);
  const employerCards = useCollapsibleList(data.experience.length, employerNeeds);

  return (
    <Accordion expandTick={expandTick}>
      <Section title="Profile" defaultOpen invalid={hasErrorUnder(fe, "name", "jobTitle", "experienceSummary", "overview", "specialization")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" {...mk("name")} value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" {...mk("jobTitle")} value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
          <Field label="Experience summary" {...mk("experienceSummary")} value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          <Field
            label="Specialization"
            {...mk("specialization")}
            optional
            value={data.specialization}
            onChange={(v) => set("specialization", v)}
            maxWords={5}
            hint={`Max 5 words · ${wordCount(data.specialization)} used`}
          />
        </div>
        <AreaField label="Overview" {...mk("overview")} value={data.overview} onChange={(v) => set("overview", v)} />
      </Section>

      <Section title="Education & Training" invalid={hasErrorUnder(fe, "education")}>
        <p className="text-xs text-ink-light">Highest qualification only — the profile carries a single education entry.</p>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Year" {...mk("education.0.year")} value={data.education[0].year} onChange={(v) => set("education", [{ ...data.education[0], year: v }])} />
          <Field label="Qualification" {...mk("education.0.qualification")} value={data.education[0].qualification} onChange={(v) => set("education", [{ ...data.education[0], qualification: v }])} />
        </div>
      </Section>

      <Section title="Skills" invalid={hasErrorUnder(fe, "skills")}>
        <TagInput items={data.skills} itemError={tagError("skills")} onChange={(v) => set("skills", v)} placeholder="e.g. Java, React, SQL" error={fe["skills"]} />
      </Section>

      <Section title="Tools" invalid={hasErrorUnder(fe, "tools")} empty={cleanList(data.tools).length === 0}>
        <TagInput items={data.tools} itemError={tagError("tools")} onChange={(v) => set("tools", v)} placeholder="e.g. Git, Jira, Docker" />
      </Section>

      <Section title="Certifications" invalid={hasErrorUnder(fe, "certifications")} empty={cleanList(data.certifications).length === 0}>
        <TagInput items={data.certifications} itemError={tagError("certifications")} onChange={(v) => set("certifications", v)} placeholder="e.g. PSM I, AWS Cloud Practitioner" />
      </Section>

      {projectsRemoved ? (
        <RemovedSection title="Projects" onRestore={restoreProjects} />
      ) : (
        <Section
          title="Projects"
          invalid={hasErrorUnder(fe, "projects")}
          empty={!data.projects.some((p) => hasContent(p.client, p.duration, p.role, p.description, p.teamSize, p.responsibilities))}
          onRemove={removeProjects}
          actions={
            <AddButton
              label="Add project"
              onClick={() => {
                // a new project goes first, as Project 1, open, with the focus in its first field
                set("projects", [{ ...BLANK_PROJECT }, ...data.projects]);
                projectCards.addedTop();
              }}
            />
          }
        >
          <ListExpandControls what="projects" onAll={projectCards.setAll} />
          <div ref={projectCards.listRef} className="space-y-3">
          {data.projects.map((p, i) => {
            const setP = (patch: Partial<ExternalResume["projects"][number]>) =>
              set("projects", data.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <CollapsibleItemCard
                key={i}
                title={itemTitle("Project", i, p.client, p.duration)}
                index={i}
                length={data.projects.length}
                open={projectCards.isOpen(i)}
                onToggle={() => projectCards.toggle(i)}
                needsAttention={projectNeeds[i]}
                onMove={(from, to) => {
                  set("projects", moveItem(data.projects, from, to));
                  projectCards.moved(from, to);
                }}
                onRemove={(idx) => {
                  set("projects", data.projects.filter((_, j) => j !== idx));
                  projectCards.removed(idx);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Project Name" {...mk(`projects.${i}.client`)} value={p.client} onChange={(v) => setP({ client: v })} />
                  <Field label="Duration" optional {...mk(`projects.${i}.duration`)} value={p.duration} onChange={(v) => setP({ duration: v })} />
                  <Field label="Team size" optional {...mk(`projects.${i}.teamSize`)} value={p.teamSize} onChange={(v) => setP({ teamSize: v })} />
                </div>
                <Field label="Role" optional {...mk(`projects.${i}.role`)} value={p.role} onChange={(v) => setP({ role: v })} />
                <AreaField label="Project Description" optional {...mk(`projects.${i}.description`)} value={p.description} onChange={(v) => setP({ description: v })} />
                <StringListEditor
                  label="Responsibilities (bullets)"
                  items={p.responsibilities}
                  marks={listMarks(`projects.${i}.responsibilities`)}
                  onChange={(v) => setP({ responsibilities: v })}
                  addLabel="Add responsibility"
                  multiline
                />
              </CollapsibleItemCard>
            );
          })}
          </div>
        </Section>
      )}

      <Section
        title="Experience"
        invalid={hasErrorUnder(fe, "experience")}
        empty={!data.experience.some((e) => hasContent(e.company, e.position, e.duration, e.highlights))}
        actions={
          <AddButton
            label="Add employer"
            onClick={() => {
              // a new employer goes first, open, with the focus in its first field (the same as projects)
              set("experience", [{ company: "", position: "", duration: "", highlights: [""] }, ...data.experience]);
              employerCards.addedTop();
            }}
          />
        }
      >
        <ListExpandControls what="employers" onAll={employerCards.setAll} />
        <div ref={employerCards.listRef} className="space-y-3">
        {data.experience.map((e, i) => {
          const setE = (patch: Partial<ExternalResume["experience"][number]>) =>
            set("experience", data.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <CollapsibleItemCard
              key={i}
              title={itemTitle("Employer", i, e.company, e.duration)}
              index={i}
              length={data.experience.length}
              open={employerCards.isOpen(i)}
              onToggle={() => employerCards.toggle(i)}
              needsAttention={employerNeeds[i]}
              onMove={(from, to) => {
                set("experience", moveItem(data.experience, from, to));
                employerCards.moved(from, to);
              }}
              onRemove={(idx) => {
                set("experience", data.experience.filter((_, j) => j !== idx));
                employerCards.removed(idx);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Company Name" {...mk(`experience.${i}.company`)} value={e.company} onChange={(v) => setE({ company: v })} />
                <Field label="Role" optional {...mk(`experience.${i}.position`)} value={e.position} onChange={(v) => setE({ position: v })} />
                <Field label="Duration" optional {...mk(`experience.${i}.duration`)} value={e.duration} onChange={(v) => setE({ duration: v })} />
              </div>
              <StringListEditor
                label="Responsibilities (bullets)"
                items={e.highlights}
                marks={listMarks(`experience.${i}.highlights`)}
                onChange={(v) => setE({ highlights: v })}
                addLabel="Add responsibility"
                multiline
              />
            </CollapsibleItemCard>
          );
        })}
        </div>
      </Section>

      <Section title="Achievements" invalid={hasErrorUnder(fe, "achievements")} empty={cleanList(achievements).length === 0}>
        <p className="text-xs text-ink-light">
          Awards, recognition and accomplishments, one per item. Filled in automatically when the uploaded resume has an Achievements, Awards or
          Accomplishments section; you can edit, add or remove items.
        </p>
        <StringListEditor
          items={achievements}
          marks={listMarks("achievements")}
          onChange={(v) => set("achievements", v)}
          addLabel="Add achievement"
          multiline
        />
      </Section>

      {customSections.map((s, i) => {
        const setS = (patch: Partial<CustomSection>) => set("customSections", customSections.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        const move = (to: number) => set("customSections", moveItem(customSections, i, to));
        const arrow = "p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent";
        return (
          <Section
            key={i}
            title={s.title.trim() || `Custom section ${i + 1}`}
            defaultOpen={openCustom === i}
            invalid={hasErrorUnder(fe, `customSections.${i}`)}
            empty={!hasContent(s.title, s.description) && !s.fields.some((f) => hasContent(f.label, f.value))}
            onRemove={() => {
              set("customSections", customSections.filter((_, j) => j !== i));
              setOpenCustom(null);
            }}
            actions={
              <span className="flex items-center gap-0.5">
                <button type="button" title="Move section up" className={arrow} disabled={i === 0} onClick={() => move(i - 1)}>↑</button>
                <button type="button" title="Move section down" className={arrow} disabled={i === customSections.length - 1} onClick={() => move(i + 1)}>↓</button>
              </span>
            }
          >
            <p className="text-xs text-ink-light">Printed in the document as this title, then the fields (label and value), then the description.</p>
            <Field
              label="Section title"
              {...mk(`customSections.${i}.title`)}
              value={s.title}
              onChange={(v) => setS({ title: v })}
              maxLength={CUSTOM_TITLE_MAX}
              hint={`${s.title.length} of ${CUSTOM_TITLE_MAX} characters`}
            />
            <FieldPairsEditor
              label="Fields (label and value)"
              items={s.fields}
              onChange={(v) => setS({ fields: v })}
              marks={(k) => ({ label: fe[`customSections.${i}.fields.${k}.label`], value: fe[`customSections.${i}.fields.${k}.value`] })}
              maxLabel={CUSTOM_LABEL_MAX}
              maxValue={CUSTOM_VALUE_MAX}
            />
            <AreaField label="Description" optional {...mk(`customSections.${i}.description`)} value={s.description} onChange={(v) => setS({ description: v })} />
          </Section>
        );
      })}

      <button
        type="button"
        onClick={() => {
          set("customSections", [...customSections, { title: "", fields: [], description: "" }]);
          setOpenCustom(customSections.length);
        }}
        className="w-full border border-dashed border-brand-300 px-4 py-3 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
      >
        + Add custom section
      </button>
    </Accordion>
  );
}
