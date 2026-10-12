"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { wordCount, type ExternalResume } from "@/lib/schemas";
import { Accordion, AddButton, AreaField, Field, ItemCard, RemovedSection, Section, StringListEditor, moveItem } from "./fields";

const BLANK_PROJECT: ExternalResume["projects"][number] = {
  duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""],
};

export default function ExternalForm({
  data,
  onChange,
  expandTick = 0,
}: {
  data: ExternalResume;
  onChange: (data: ExternalResume) => void;
  /** Bumped by the parent to open every section (e.g. when generating fails). */
  expandTick?: number;
}) {
  const [projectsRemoved, setProjectsRemoved] = useState(false);

  const set = <K extends keyof ExternalResume>(key: K, value: ExternalResume[K]) =>
    onChange({ ...data, [key]: value });

  const removeProjects = () => { set("projects", []); setProjectsRemoved(true); };
  const restoreProjects = () => { set("projects", [{ ...BLANK_PROJECT }]); setProjectsRemoved(false); };

  return (
    <Accordion expandTick={expandTick}>
      <Section title="Profile" defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
          <Field label="Experience summary" optional value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          <Field
            label="Specialization"
            optional
            value={data.specialization}
            onChange={(v) => set("specialization", v)}
            maxWords={5}
            hint={`Max 5 words · ${wordCount(data.specialization)} used`}
          />
        </div>
        <AreaField label="Overview" value={data.overview} onChange={(v) => set("overview", v)} />
      </Section>

      <Section title="Education & Training">
        <p className="text-xs text-ink-light">Highest qualification only — the profile carries a single education entry.</p>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Year" value={data.education[0].year} onChange={(v) => set("education", [{ ...data.education[0], year: v }])} />
          <Field label="Qualification" value={data.education[0].qualification} onChange={(v) => set("education", [{ ...data.education[0], qualification: v }])} />
        </div>
      </Section>

      <Section title="Skills">
        <StringListEditor items={data.skills} onChange={(v) => set("skills", v)} addLabel="Add skill" />
      </Section>

      <Section title="Tools" empty={cleanList(data.tools).length === 0}>
        <StringListEditor items={data.tools} onChange={(v) => set("tools", v)} addLabel="Add tool" />
      </Section>

      <Section title="Certifications" empty={cleanList(data.certifications).length === 0}>
        <StringListEditor items={data.certifications} onChange={(v) => set("certifications", v)} addLabel="Add certification" />
      </Section>

      {projectsRemoved ? (
        <RemovedSection title="Projects" onRestore={restoreProjects} />
      ) : (
        <Section
          title="Projects"
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
                  <Field label="Project Name" value={p.client} onChange={(v) => setP({ client: v })} />
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
                <Field label="Company Name" value={e.company} onChange={(v) => setE({ company: v })} />
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
