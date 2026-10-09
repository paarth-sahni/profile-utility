import type { ReactNode } from "react";
import type { ExternalResume, InternalResume, ResumeData, TemplateId } from "@/lib/schemas";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-light">{title}</h3>
      {children}
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-ink-light">—</p>;
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

/** Read-only view of a saved profile version (no editing; use "Open in Review" to change it). */
export default function ProfilePreview({ template, data }: { template: TemplateId; data: ResumeData }) {
  const d = data as InternalResume & ExternalResume;
  const projects = d.projects as { duration: string; role: string; teamSize: string; description: string; responsibilities: string[]; title?: string; client?: string; toolsAndTechnologies?: string[] }[];
  return (
    <article className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-2xl font-semibold text-ink-dark">{d.name || "Untitled profile"}</h2>
        <p className="text-sm text-ink-light">
          {[d.jobTitle, d.experienceSummary, d.specialization].filter(Boolean).join(" · ")}
        </p>
      </header>

      {d.overview && (
        <Section title="Overview">
          <p className="whitespace-pre-wrap text-sm text-ink">{d.overview}</p>
        </Section>
      )}

      {d.education?.some((e) => e.year || e.qualification) && (
        <Section title="Education">
          {d.education.map((e, i) => (
            <p key={i} className="text-sm text-ink">
              {[e.qualification, e.year].filter(Boolean).join(" — ")}
            </p>
          ))}
        </Section>
      )}

      {template === "internal" ? (
        <Section title="Skills">
          {d.skills.length ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {(d.skills as unknown as { name: string; rating: string }[]).map((s, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-hairline py-1">
                  <span>{s.name}</span>
                  <span className="text-ink-light">{s.rating}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-light">—</p>
          )}
        </Section>
      ) : (
        <Section title="Skills">
          <Chips items={d.skills as unknown as string[]} />
        </Section>
      )}

      <Section title="Tools">
        <Chips items={d.tools} />
      </Section>
      <Section title="Certifications">
        <Chips items={d.certifications} />
      </Section>

      {template === "internal" && (
        <>
          <Section title="Domains">
            <Chips items={d.domains} />
          </Section>
          <Section title="Languages">
            <Chips items={d.languages} />
          </Section>
          {d.managerialExperience?.length > 0 && (
            <Section title="Managerial experience">
              <Bullets items={d.managerialExperience} />
            </Section>
          )}
        </>
      )}

      {projects.length > 0 && (
        <Section title="Projects">
          <div className="space-y-4">
            {projects.map((p, i) => (
              <div key={i} className="rounded-lg border border-hairline p-4">
                <p className="font-medium text-ink-dark">{p.title ?? p.client ?? "Project"}</p>
                <p className="text-xs text-ink-light">
                  {[p.duration, p.role, p.teamSize && `Team: ${p.teamSize}`].filter(Boolean).join(" · ")}
                </p>
                {p.toolsAndTechnologies && p.toolsAndTechnologies.length > 0 && (
                  <div className="mt-2">
                    <Chips items={p.toolsAndTechnologies} />
                  </div>
                )}
                {p.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{p.description}</p>}
                {p.responsibilities.length > 0 && (
                  <div className="mt-2">
                    <Bullets items={p.responsibilities} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {template === "external" && d.experience?.length > 0 && (
        <Section title="Experience">
          <div className="space-y-4">
            {d.experience.map((x, i) => (
              <div key={i} className="rounded-lg border border-hairline p-4">
                <p className="font-medium text-ink-dark">{x.company}</p>
                <p className="text-xs text-ink-light">{[x.position, x.duration].filter(Boolean).join(" · ")}</p>
                <div className="mt-2">
                  <Bullets items={x.highlights} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </article>
  );
}
