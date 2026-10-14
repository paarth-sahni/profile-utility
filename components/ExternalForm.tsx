"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { wordCount, type ExternalResume } from "@/lib/schemas";
import { hasErrorUnder } from "@/lib/fieldErrors";
import { Accordion, AddButton, AreaField, Field, ItemCard, RemovedSection, Section, StringListEditor, TagInput, moveItem } from "./fields";

const BLANK_PROJECT: ExternalResume["projects"][number] = {
  duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""],
};

export default function ExternalForm({
  data,
  onChange,
  expandTick = 0,
  fieldErrors,
}: {
  data: ExternalResume;
  onChange: (data: ExternalResume) => void;
  /** Bumped by the parent to open every section (e.g. when generating fails). */
  expandTick?: number;
  /** Problems with required fields, keyed by field path ("name", "education.0.year", ...). Shown in red. */
  fieldErrors?: Record<string, string>;
}) {
  const [projectsRemoved, setProjectsRemoved] = useState(false);

  const set = <K extends keyof ExternalResume>(key: K, value: ExternalResume[K]) =>
    onChange({ ...data, [key]: value });

  const removeProjects = () => { set("projects", []); setProjectsRemoved(true); };
  const restoreProjects = () => { set("projects", [{ ...BLANK_PROJECT }]); setProjectsRemoved(false); };

  const fe = fieldErrors ?? {};

  return (
    <Accordion expandTick={expandTick}>
      <Section title="Profile" defaultOpen invalid={hasErrorUnder(fe, "name", "jobTitle", "experienceSummary", "overview")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fe["name"]} value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" error={fe["jobTitle"]} value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
          <Field label="Experience summary" error={fe["experienceSummary"]} value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          <Field
            label="Specialization"
            optional
            value={data.specialization}
            onChange={(v) => set("specialization", v)}
            maxWords={5}
            hint={`Max 5 words · ${wordCount(data.specialization)} used`}
          />
        </div>
        <AreaField label="Overview" error={fe["overview"]} value={data.overview} onChange={(v) => set("overview", v)} />
      </Section>

      <Section title="Education & Training" invalid={hasErrorUnder(fe, "education")}>
        <p className="text-xs text-ink-light">Highest qualification only — the profile carries a single education entry.</p>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Year" error={fe["education.0.year"]} value={data.education[0].year} onChange={(v) => set("education", [{ ...data.education[0], year: v }])} />
          <Field label="Qualification" error={fe["education.0.qualification"]} value={data.education[0].qualification} onChange={(v) => set("education", [{ ...data.education[0], qualification: v }])} />
        </div>
      </Section>

      <Section title="Skills" invalid={hasErrorUnder(fe, "skills")}>
        <TagInput items={data.skills} onChange={(v) => set("skills", v)} placeholder="e.g. Java, React, SQL" error={fe["skills"]} />
      </Section>

      <Section title="Tools" empty={cleanList(data.tools).length === 0}>
        <TagInput items={data.tools} onChange={(v) => set("tools", v)} placeholder="e.g. Git, Jira, Docker" />
      </Section>

      <Section title="Certifications" empty={cleanList(data.certifications).length === 0}>
        <TagInput items={data.certifications} onChange={(v) => set("certifications", v)} placeholder="e.g. PSM I, AWS Cloud Practitioner" />
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
                  <Field label="Project Name" error={fe[`projects.${i}.client`]} value={p.client} onChange={(v) => setP({ client: v })} />
                  <Field label="Duration" optional value={p.duration} onChange={(v) => setP({ duration: v })} />
                  <Field label="Team size" optional value={p.teamSize} onChange={(v) => setP({ teamSize: v })} />
                </div>
                <Field label="Role" optional value={p.role} onChange={(v) => setP({ role: v })} />
                <AreaField label="Project Description" optional value={p.description} onChange={(v) => setP({ description: v })} />
                <StringListEditor
                  label="Responsibilities (bullets)"
                  items={p.responsibilities}
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
                <Field label="Company Name" error={fe[`experience.${i}.company`]} value={e.company} onChange={(v) => setE({ company: v })} />
                <Field label="Role" optional value={e.position} onChange={(v) => setE({ position: v })} />
                <Field label="Duration" optional value={e.duration} onChange={(v) => setE({ duration: v })} />
              </div>
              <StringListEditor
                label="Responsibilities (bullets)"
                items={e.highlights}
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
