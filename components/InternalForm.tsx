"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { formatYearsExperience, wordCount, type InternalResume } from "@/lib/schemas";
import { hasErrorUnder } from "@/lib/fieldErrors";
import { Accordion, AddButton, AreaField, Field, ItemCard, RemovedSection, Section, StringListEditor, TagInput, moveItem } from "./fields";

const BLANK_PROJECT: InternalResume["projects"][number] = {
  duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""],
};

export default function InternalForm({
  data,
  onChange,
  fromScratch = false,
  expandTick = 0,
  fieldErrors,
}: {
  data: InternalResume;
  onChange: (data: InternalResume) => void;
  /** Bumped by the parent to open every section (e.g. when generating fails). */
  expandTick?: number;
  /** Problems with required fields, keyed by field path ("name", "education.0.year", ...). Shown in red. */
  fieldErrors?: Record<string, string>;
  /** The blank-form ("Create a Profile from Scratch") route captures the experience
   *  summary as a plain number of years; the LLM route supplies the full string. */
  fromScratch?: boolean;
}) {
  const [projectsRemoved, setProjectsRemoved] = useState(false);
  const [managerialRemoved, setManagerialRemoved] = useState(false);

  const set = <K extends keyof InternalResume>(key: K, value: InternalResume[K]) =>
    onChange({ ...data, [key]: value });

  const removeProjects = () => { set("projects", []); setProjectsRemoved(true); };
  const restoreProjects = () => { set("projects", [BLANK_PROJECT]); setProjectsRemoved(false); };
  const removeManagerial = () => { set("managerialExperience", []); setManagerialRemoved(true); };
  const restoreManagerial = () => { set("managerialExperience", [""]); setManagerialRemoved(false); };

  const fe = fieldErrors ?? {};

  return (
    <Accordion expandTick={expandTick}>
      <Section title="Profile" defaultOpen invalid={hasErrorUnder(fe, "name", "jobTitle", "experienceSummary", "overview")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fe["name"]} value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" error={fe["jobTitle"]} value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
          {fromScratch ? (
            <Field
              label="Years of Industry Experience"
              error={fe["experienceSummary"]}
              numeric
              value={data.experienceSummary}
              onChange={(v) => set("experienceSummary", v)}
              hint={
                data.experienceSummary.trim()
                  ? `Shows as "${formatYearsExperience(data.experienceSummary)}" in the profile.`
                  : "Numbers only — e.g. 4 becomes “4+ Years of Industry Experience”."
              }
            />
          ) : (
            <Field label="Experience summary" error={fe["experienceSummary"]} value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          )}
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

      {projectsRemoved ? (
        <RemovedSection title="Projects" onRestore={restoreProjects} />
      ) : (
        <Section
          title="Projects"
          invalid={hasErrorUnder(fe, "projects")}
          empty={!data.projects.some((p) => hasContent(p.title, p.duration, p.role, p.description, p.teamSize, p.toolsAndTechnologies, p.responsibilities))}
          onRemove={removeProjects}
          actions={
            <AddButton
              label="Add project"
              onClick={() => set("projects", [...data.projects, { ...BLANK_PROJECT }])}
            />
          }
        >
          {data.projects.map((p, i) => {
            const setP = (patch: Partial<InternalResume["projects"][number]>) =>
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
                  <Field label="Project Name" error={fe[`projects.${i}.title`]} value={p.title} onChange={(v) => setP({ title: v })} />
                  <Field label="Duration" optional value={p.duration} onChange={(v) => setP({ duration: v })} />
                  <Field label="Team size" optional value={p.teamSize} onChange={(v) => setP({ teamSize: v })} />
                  <Field label="Role" optional value={p.role} onChange={(v) => setP({ role: v })} />
                </div>
                <Field
                  label="Project link (URL or NDA)"
                  optional
                  value={p.projectLink}
                  onChange={(v) => setP({ projectLink: v })}
                />
                <TagInput
                  label="Tools & technologies"
                  items={p.toolsAndTechnologies}
                  onChange={(v) => setP({ toolsAndTechnologies: v })}
                  placeholder="e.g. Java, Spring Boot, AWS (S3, EC2)"
                />
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
        title="Skills (with rating out of 5)"
        invalid={hasErrorUnder(fe, "skills")}
        actions={<AddButton label="Add skill" onClick={() => set("skills", [...data.skills, { name: "", rating: "" }])} />}
      >
        {fe["skills"] && <p className="text-xs font-medium text-brand-600">{fe["skills"]}</p>}
        {data.skills.map((s, i) => (
          <ItemCard
            key={i}
            title={`Skill ${i + 1}`}
            index={i}
            length={data.skills.length}
            onMove={(from, to) => set("skills", moveItem(data.skills, from, to))}
            onRemove={(idx) => set("skills", data.skills.filter((_, j) => j !== idx))}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <Field label="Skill" error={fe[`skills.${i}.name`]} value={s.name} onChange={(v) => set("skills", data.skills.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
              <Field label="Rating out of 5 (e.g. 4)" error={fe[`skills.${i}.rating`]} value={s.rating} onChange={(v) => set("skills", data.skills.map((x, j) => (j === i ? { ...x, rating: v } : x)))} />
            </div>
          </ItemCard>
        ))}
      </Section>

      <Section title="Certifications" empty={cleanList(data.certifications).length === 0}>
        <TagInput items={data.certifications} onChange={(v) => set("certifications", v)} placeholder="e.g. PSM I, AWS Cloud Practitioner" />
      </Section>

      <Section title="Tools" empty={cleanList(data.tools).length === 0}>
        <TagInput items={data.tools} onChange={(v) => set("tools", v)} placeholder="e.g. Git, Jira, Docker" />
      </Section>

      {managerialRemoved ? (
        <RemovedSection title="Managerial Experience" onRestore={restoreManagerial} />
      ) : (
        <Section title="Managerial Experience" empty={cleanList(data.managerialExperience).length === 0} onRemove={removeManagerial}>
          <TagInput items={data.managerialExperience} onChange={(v) => set("managerialExperience", v)} placeholder="e.g. Project Management, Team Building" />
        </Section>
      )}

      <Section title="Domains" empty={cleanList(data.domains).length === 0}>
        <TagInput items={data.domains} onChange={(v) => set("domains", v)} placeholder="e.g. Retail, Fintech" />
      </Section>

      <Section title="Languages" empty={cleanList(data.languages).length === 0}>
        <TagInput items={data.languages} onChange={(v) => set("languages", v)} placeholder="e.g. English, Hindi" />
      </Section>
    </Accordion>
  );
}
