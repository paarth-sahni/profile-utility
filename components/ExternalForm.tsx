"use client";

import { useState } from "react";
import { wordCount, type ExternalResume } from "@/lib/schemas";
import { AddButton, AreaField, Field, ItemCard, Section, StringListEditor, moveItem } from "./fields";

function RemovedSection({ title, onRestore }: { title: string; onRestore: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-3">
      <span className="text-sm text-gray-400">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        <span className="ml-2 italic">— removed from document</span>
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Restore
      </button>
    </div>
  );
}

const BLANK_PROJECT: ExternalResume["projects"][number] = {
  duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""],
};

export default function ExternalForm({
  data,
  onChange,
}: {
  data: ExternalResume;
  onChange: (data: ExternalResume) => void;
}) {
  const [projectsRemoved, setProjectsRemoved] = useState(false);

  const set = <K extends keyof ExternalResume>(key: K, value: ExternalResume[K]) =>
    onChange({ ...data, [key]: value });

  const removeProjects = () => { set("projects", []); setProjectsRemoved(true); };
  const restoreProjects = () => { set("projects", [{ ...BLANK_PROJECT }]); setProjectsRemoved(false); };

  return (
    <div className="space-y-5">
      <Section title="Profile">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
          <Field label="Experience summary" value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          <Field
            label="Specialization"
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

      <Section title="Tools">
        <StringListEditor items={data.tools} onChange={(v) => set("tools", v)} addLabel="Add tool" />
      </Section>

      <Section title="Certifications">
        <StringListEditor items={data.certifications} onChange={(v) => set("certifications", v)} addLabel="Add certification" />
      </Section>

      {projectsRemoved ? (
        <RemovedSection title="Projects" onRestore={restoreProjects} />
      ) : (
        <Section
          title="Projects"
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
                  <Field label="Duration" value={p.duration} onChange={(v) => setP({ duration: v })} />
                  <Field label="Team size" optional value={p.teamSize} onChange={(v) => setP({ teamSize: v })} />
                </div>
                <Field label="Role" value={p.role} onChange={(v) => setP({ role: v })} />
                <AreaField label="Project Description" value={p.description} onChange={(v) => setP({ description: v })} />
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
                <Field label="Role" value={e.position} onChange={(v) => setE({ position: v })} />
                <Field label="Duration" value={e.duration} onChange={(v) => setE({ duration: v })} />
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
    </div>
  );
}
