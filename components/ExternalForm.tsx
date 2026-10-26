"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { wordCount, type ExternalResume } from "@/lib/schemas";
import { hasErrorUnder } from "@/lib/fieldErrors";
import { Accordion, AddButton, AreaField, Field, ItemCard, RemovedSection, Section, StringListEditor, TagInput, moveItem, type Range } from "./fields";

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
              onClick={() => set("projects", [...data.projects, { ...BLANK_PROJECT }])}
            />
          }
        >
          {data.projects.map((p, i) => {
            const setP = (patch: Partial<ExternalResume["projects"][number]>) =>
              set("projects", data.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <ItemCard
                key={i}
                title={`Project ${i + 1}`}
                index={i}
                length={data.projects.length}
                onMove={(from, to) => set("projects", moveItem(data.projects, from, to))}
                onRemove={(idx) => set("projects", data.projects.filter((_, j) => j !== idx))}
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
              </ItemCard>
            );
          })}
        </Section>
      )}

      <Section
        title="Experience"
        invalid={hasErrorUnder(fe, "experience")}
        empty={!data.experience.some((e) => hasContent(e.company, e.position, e.duration, e.highlights))}
        actions={
          <AddButton
            label="Add employer"
            onClick={() => set("experience", [...data.experience, { company: "", position: "", duration: "", highlights: [""] }])}
          />
        }
      >
        {data.experience.map((e, i) => {
          const setE = (patch: Partial<ExternalResume["experience"][number]>) =>
            set("experience", data.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <ItemCard
              key={i}
              title={`Employer ${i + 1}`}
              index={i}
              length={data.experience.length}
              onMove={(from, to) => set("experience", moveItem(data.experience, from, to))}
              onRemove={(idx) => set("experience", data.experience.filter((_, j) => j !== idx))}
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
            </ItemCard>
          );
        })}
      </Section>
    </Accordion>
  );
}
