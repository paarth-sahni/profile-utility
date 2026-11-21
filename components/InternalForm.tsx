"use client";

import { useState } from "react";
import { cleanList, hasContent } from "@/lib/previewModel";
import { formatYearsExperience, wordCount, type InternalResume } from "@/lib/schemas";
import { hasErrorUnder } from "@/lib/fieldErrors";
import { itemTitle } from "@/lib/collapsibleList";
import { Accordion, AddButton, AreaField, CollapsibleItemCard, Field, ListExpandControls, RemovedSection, Section, StringListEditor, TagInput, moveItem, type Range } from "./fields";
import SkillsTable from "./SkillsTable";
import { useCollapsibleList } from "./useCollapsibleList";

const BLANK_PROJECT: InternalResume["projects"][number] = {
  duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""],
};

export default function InternalForm({
  data,
  onChange,
  fromScratch = false,
  expandTick = 0,
  fieldErrors,
  highlights,
}: {
  data: InternalResume;
  onChange: (data: InternalResume) => void;
  /** Bumped by the parent to open every section (e.g. when generating fails). */
  expandTick?: number;
  /** Problems with required fields, keyed by field path ("name", "education.0.year", ...). Shown in red. */
  fieldErrors?: Record<string, string>;
  /** Parts of a field's text that name a registered client, keyed by field path. Shown marked under the field. */
  highlights?: Record<string, Range[]>;
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
  // client-name check: the message and the flagged text ranges for a field, and the same per bullet / chip
  const hl = highlights ?? {};
  const mk = (path: string) => ({ error: fe[path], highlights: hl[path] });
  const listMarks = (base: string) => (i: number) => mk(`${base}.${i}`);
  const tagError = (base: string) => (i: number) => fe[`${base}.${i}`];
  // a project needs attention when any field in it has a problem (a required field, or a registered client name)
  const problemUnder = (prefix: string) => hasErrorUnder(fe, prefix) || Object.entries(hl).some(([k, r]) => r.length > 0 && (k === prefix || k.startsWith(`${prefix}.`)));
  const projectNeeds = data.projects.map((_, i) => problemUnder(`projects.${i}`));
  const projectCards = useCollapsibleList(data.projects.length, projectNeeds);

  return (
    <Accordion expandTick={expandTick}>
      <Section title="Profile" defaultOpen invalid={hasErrorUnder(fe, "name", "jobTitle", "experienceSummary", "overview", "specialization")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" {...mk("name")} value={data.name} onChange={(v) => set("name", v)} />
          <Field label="Job title" {...mk("jobTitle")} value={data.jobTitle} onChange={(v) => set("jobTitle", v)} />
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
            <Field label="Experience summary" {...mk("experienceSummary")} value={data.experienceSummary} onChange={(v) => set("experienceSummary", v)} />
          )}
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
            const setP = (patch: Partial<InternalResume["projects"][number]>) =>
              set("projects", data.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <CollapsibleItemCard
                key={i}
                title={itemTitle("Project", i, p.title, p.duration)}
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
                  <Field label="Project Name" {...mk(`projects.${i}.title`)} value={p.title} onChange={(v) => setP({ title: v })} />
                  <Field label="Duration" optional {...mk(`projects.${i}.duration`)} value={p.duration} onChange={(v) => setP({ duration: v })} />
                  <Field label="Team size" optional {...mk(`projects.${i}.teamSize`)} value={p.teamSize} onChange={(v) => setP({ teamSize: v })} />
                  <Field label="Role" optional {...mk(`projects.${i}.role`)} value={p.role} onChange={(v) => setP({ role: v })} />
                </div>
                <Field
                  label="Project link (URL or NDA)"
                  {...mk(`projects.${i}.projectLink`)}
                  optional
                  value={p.projectLink}
                  onChange={(v) => setP({ projectLink: v })}
                />
                <TagInput
                  label="Tools & technologies"
                  items={p.toolsAndTechnologies}
                  itemError={tagError(`projects.${i}.toolsAndTechnologies`)}
                  onChange={(v) => setP({ toolsAndTechnologies: v })}
                  placeholder="e.g. Java, Spring Boot, AWS (S3, EC2)"
                />
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

      <Section title="Skills (with rating out of 5)" invalid={hasErrorUnder(fe, "skills")}>
        {fe["skills"] && <p className="text-xs font-medium text-brand-600">{fe["skills"]}</p>}
        <SkillsTable skills={data.skills} onChange={(v) => set("skills", v)} marks={mk} />
      </Section>

      <Section title="Certifications" invalid={hasErrorUnder(fe, "certifications")} empty={cleanList(data.certifications).length === 0}>
        <TagInput items={data.certifications} itemError={tagError("certifications")} onChange={(v) => set("certifications", v)} placeholder="e.g. PSM I, AWS Cloud Practitioner" />
      </Section>

      <Section title="Tools" invalid={hasErrorUnder(fe, "tools")} empty={cleanList(data.tools).length === 0}>
        <TagInput items={data.tools} itemError={tagError("tools")} onChange={(v) => set("tools", v)} placeholder="e.g. Git, Jira, Docker" />
      </Section>

      {managerialRemoved ? (
        <RemovedSection title="Managerial Experience" onRestore={restoreManagerial} />
      ) : (
        <Section title="Managerial Experience" invalid={hasErrorUnder(fe, "managerialExperience")} empty={cleanList(data.managerialExperience).length === 0} onRemove={removeManagerial}>
          <TagInput items={data.managerialExperience} itemError={tagError("managerialExperience")} onChange={(v) => set("managerialExperience", v)} placeholder="e.g. Project Management, Team Building" />
        </Section>
      )}

      <Section title="Domains" invalid={hasErrorUnder(fe, "domains")} empty={cleanList(data.domains).length === 0}>
        <TagInput items={data.domains} itemError={tagError("domains")} onChange={(v) => set("domains", v)} placeholder="e.g. Retail, Fintech" />
      </Section>

      <Section title="Languages" invalid={hasErrorUnder(fe, "languages")} empty={cleanList(data.languages).length === 0}>
        <TagInput items={data.languages} itemError={tagError("languages")} onChange={(v) => set("languages", v)} placeholder="e.g. English, Hindi" />
      </Section>
    </Accordion>
  );
}
