import type { ReactNode } from "react";
import { cleanList, formatRating, hasContent, hasText } from "@/lib/previewModel";
import type { ExternalResume, InternalResume, ResumeData, TemplateId } from "@/lib/schemas";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline pt-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-light">{title}</h3>
      {children}
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <li key={i} className="rounded-full bg-cream px-2.5 py-1 text-xs text-ink">
          {t}
        </li>
      ))}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** Read-only view of a saved profile version (no editing; use "Open in Review" to change it). Like the Word
 *  document, it leaves out anything that is blank or "N/A", and sections with nothing to show disappear. */
export default function ProfilePreview({ template, data }: { template: TemplateId; data: ResumeData }) {
  const d = data as InternalResume & ExternalResume;
  type PreviewProject = { duration: string; role: string; teamSize: string; description: string; responsibilities: string[]; title?: string; client?: string; toolsAndTechnologies?: string[] };
  const projects = (d.projects as PreviewProject[]).filter((p) =>
    hasContent(p.title, p.client, p.duration, p.role, p.teamSize, p.description, p.toolsAndTechnologies, p.responsibilities),
  );
  const education = (d.education ?? []).filter((e) => hasText(e.year) || hasText(e.qualification));
  const internalSkills = template === "internal" ? (d.skills as unknown as { name: string; rating: string }[]).filter((s) => hasText(s.name)) : [];
  const externalSkills = template === "external" ? cleanList(d.skills as unknown as string[]) : [];
  const tools = cleanList(d.tools);
  const certifications = cleanList(d.certifications);
  const domains = template === "internal" ? cleanList(d.domains) : [];
  const languages = template === "internal" ? cleanList(d.languages) : [];
  const managerial = template === "internal" ? cleanList(d.managerialExperience) : [];
  const experience = template === "external" ? (d.experience ?? []).filter((x) => hasContent(x.company, x.position, x.duration, x.highlights)) : [];
  const headline = [d.jobTitle, d.experienceSummary, d.specialization].filter(hasText).join(" · ");

  return (
    <article className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-2xl font-medium text-ink-dark">{hasText(d.name) ? d.name : "Untitled profile"}</h2>
        {headline && <p className="text-sm text-ink-light">{headline}</p>}
      </header>

      {hasText(d.overview) && (
        <Section title="Overview">
          <p className="whitespace-pre-wrap text-sm text-ink">{d.overview}</p>
        </Section>
      )}

      {education.length > 0 && (
        <Section title="Education">
          {education.map((e, i) => (
            <p key={i} className="text-sm text-ink">
              {[e.qualification, e.year].filter(hasText).join(" — ")}
            </p>
          ))}
        </Section>
      )}

      {internalSkills.length > 0 && (
        <Section title="Skills">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {internalSkills.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-hairline py-1">
                <span>{s.name}</span>
                {formatRating(s.rating) && <span className="text-ink-light">{formatRating(s.rating)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {externalSkills.length > 0 && (
        <Section title="Skills">
          <Chips items={externalSkills} />
        </Section>
      )}

      {tools.length > 0 && (
        <Section title="Tools">
          <Chips items={tools} />
        </Section>
      )}
      {certifications.length > 0 && (
        <Section title="Certifications">
          <Chips items={certifications} />
        </Section>
      )}
      {domains.length > 0 && (
        <Section title="Domains">
          <Chips items={domains} />
        </Section>
      )}
      {languages.length > 0 && (
        <Section title="Languages">
          <Chips items={languages} />
        </Section>
      )}
      {managerial.length > 0 && (
        <Section title="Managerial experience">
          <Bullets items={managerial} />
        </Section>
      )}

      {projects.length > 0 && (
        <Section title="Projects">
          <div className="space-y-4">
            {projects.map((p, i) => {
              const tech = cleanList(p.toolsAndTechnologies);
              const duties = cleanList(p.responsibilities);
              const meta = [p.duration, p.role, hasText(p.teamSize) ? `Team: ${p.teamSize}` : ""].filter(hasText);
              return (
                <div key={i} className="rounded-lg border border-hairline p-4">
                  <p className="font-medium text-ink-dark">{hasText(p.title) ? p.title : hasText(p.client) ? p.client : "Project"}</p>
                  {meta.length > 0 && <p className="text-xs text-ink-light">{meta.join(" · ")}</p>}
                  {tech.length > 0 && (
                    <div className="mt-2">
                      <Chips items={tech} />
                    </div>
                  )}
                  {hasText(p.description) && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{p.description}</p>}
                  {duties.length > 0 && (
                    <div className="mt-2">
                      <Bullets items={duties} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {experience.length > 0 && (
        <Section title="Experience">
          <div className="space-y-4">
            {experience.map((x, i) => {
              const highlights = cleanList(x.highlights);
              const meta = [x.position, x.duration].filter(hasText);
              return (
                <div key={i} className="rounded-lg border border-hairline p-4">
                  {hasText(x.company) && <p className="font-medium text-ink-dark">{x.company}</p>}
                  {meta.length > 0 && <p className="text-xs text-ink-light">{meta.join(" · ")}</p>}
                  {highlights.length > 0 && (
                    <div className="mt-2">
                      <Bullets items={highlights} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </article>
  );
}
