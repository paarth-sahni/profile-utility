/**
 * Purpose: turns a validated profile into the data the Word templates are filled with. It also decides what is LEFT
 * OUT: every optional section / field with nothing real in it (blank or "N/A") gets its `hasX` flag set to false, and the
 * templates wrap that section's heading, content and spacer in {#hasX}...{/hasX} so the whole block disappears.
 * Blank / "N/A" list items and completely empty project / experience entries are dropped here, so the document never
 * shows an empty bullet or an empty block. Pure (no browser or DOM imports), so it is unit-tested
 * (lib/docxData.test.ts) and used by test-render.mjs against the real templates.
 *
 * Flags (see scripts/patch-optional-sections.py for where each wraps):
 *   both   hasExperienceSummary, hasSpecialization, hasTools, hasCertifications, hasProjects
 *   internal  hasDomains, hasLanguages, hasManagerialExperience; per project: hasDuration, hasTech, hasTeamSize,
 *             hasRole, hasProjectLink, hasDescription
 *   external  hasExperience, hasProjectsOrExperience; per project: hasDuration, hasTeamSize, hasRole, hasDescription,
 *             hasResponsibilities; per employer: hasPosition, hasDuration, hasHighlights
 * Required content (name, job title, overview, education, skills) has no flag.
 */
import { isNAValue, type ExternalResume, type InternalResume, type ResumeData, type TemplateId } from "./schemas";

/** True for a value with real content: not blank and not an "N/A"-style placeholder. */
const real = (value: string | undefined | null): boolean => !!value && value.trim() !== "" && !isNAValue(value);

/** The value, or "" when it is blank / "N/A" (so a template never prints a placeholder). */
const text = (value: string | undefined | null): string => (real(value) ? (value as string) : "");

/** The list without blank / "N/A" items. */
const clean = (items: readonly string[] | undefined | null): string[] => (items ?? []).filter(real);

/** True when any of the values (text or list) has real content. */
const anyReal = (...values: (string | readonly string[] | undefined | null)[]): boolean =>
  values.some((v) => (Array.isArray(v) ? clean(v).length > 0 : real(v as string | undefined | null)));

/** Maps the profile onto the tag names inside the .docx templates. */
export function prepareData(id: TemplateId, data: ResumeData): Record<string, unknown> {
  return id === "external" ? prepareExternal(data as ExternalResume) : prepareInternal(data as InternalResume);
}

function prepareExternal(d: ExternalResume): Record<string, unknown> {
  const projects = d.projects
    .filter((p) => anyReal(p.duration, p.client, p.teamSize, p.role, p.description, p.responsibilities))
    .map((p, i) => ({
      number: i + 1,
      client: p.client,
      duration: text(p.duration),
      hasDuration: real(p.duration),
      teamSize: text(p.teamSize),
      hasTeamSize: real(p.teamSize),
      role: text(p.role),
      hasRole: real(p.role),
      description: text(p.description),
      hasDescription: real(p.description),
      responsibilities: clean(p.responsibilities),
      hasResponsibilities: clean(p.responsibilities).length > 0,
    }));
  const experience = d.experience
    .filter((x) => anyReal(x.company, x.position, x.duration, x.highlights))
    .map((x) => ({
      company: x.company,
      position: text(x.position),
      hasPosition: real(x.position),
      duration: text(x.duration),
      hasDuration: real(x.duration),
      highlights: clean(x.highlights),
      hasHighlights: clean(x.highlights).length > 0,
    }));
  const tools = clean(d.tools);
  const certifications = clean(d.certifications);
  return {
    name: d.name,
    jobTitle: d.jobTitle,
    experienceSummary: text(d.experienceSummary),
    hasExperienceSummary: real(d.experienceSummary),
    specialization: text(d.specialization),
    hasSpecialization: real(d.specialization),
    overview: d.overview,
    education: d.education,
    skills: clean(d.skills).join(", "),
    tools: tools.join(", "),
    hasTools: tools.length > 0,
    certifications: certifications.join(", "),
    hasCertifications: certifications.length > 0,
    projects,
    hasProjects: projects.length > 0,
    experience,
    hasExperience: experience.length > 0,
    hasProjectsOrExperience: projects.length > 0 || experience.length > 0,
  };
}

function prepareInternal(d: InternalResume): Record<string, unknown> {
  const projects = d.projects
    .filter((p) => anyReal(p.duration, p.title, p.toolsAndTechnologies, p.teamSize, p.role, p.projectLink, p.description, p.responsibilities))
    .map((p, i) => ({
      number: i + 1,
      title: p.title,
      duration: text(p.duration),
      hasDuration: real(p.duration),
      toolsAndTechnologies: clean(p.toolsAndTechnologies).join(", "),
      hasTech: clean(p.toolsAndTechnologies).length > 0,
      teamSize: text(p.teamSize),
      hasTeamSize: real(p.teamSize),
      role: text(p.role),
      hasRole: real(p.role),
      projectLink: text(p.projectLink),
      hasProjectLink: real(p.projectLink),
      description: text(p.description),
      hasDescription: real(p.description),
      responsibilities: clean(p.responsibilities),
    }));
  const certifications = clean(d.certifications);
  const tools = clean(d.tools);
  const managerial = clean(d.managerialExperience);
  const domains = clean(d.domains);
  const languages = clean(d.languages);
  return {
    name: d.name,
    jobTitle: d.jobTitle,
    experienceSummary: text(d.experienceSummary),
    hasExperienceSummary: real(d.experienceSummary),
    specialization: text(d.specialization),
    hasSpecialization: real(d.specialization),
    overview: d.overview,
    education: d.education,
    projects,
    hasProjects: projects.length > 0,
    skills: d.skills.filter((s) => real(s.name)),
    certifications,
    hasCertifications: certifications.length > 0,
    tools: tools.join(", "),
    hasTools: tools.length > 0,
    managerialExperience: managerial,
    hasManagerialExperience: managerial.length > 0,
    domains,
    hasDomains: domains.length > 0,
    languages,
    hasLanguages: languages.length > 0,
  };
}
