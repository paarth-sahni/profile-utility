/**
 * Purpose: turns a validated profile into the data the Word templates are filled with. It also decides what is LEFT
 * OUT: every optional section / field with nothing real in it (blank or "N/A") gets its `hasX` flag set to false, and the
 * templates wrap that section's heading, content and spacer in {#hasX}...{/hasX} so the whole block disappears.
 * Blank / "N/A" list items and completely empty project / experience entries are dropped here, so the document never
 * shows an empty bullet or an empty block. Pure (no browser or DOM imports), so it is unit-tested
 * (lib/docxData.test.ts) and used by test-render.mjs against the real templates.
 *
 * Flags (see scripts/patch-templates.py for where each wraps):
 *   both   hasExperienceSummary, hasSpecialization, hasTools, hasCertifications, hasProjects
 *   internal  hasDomains, hasLanguages, hasManagerialExperience; per project: hasDuration, hasTech, hasTeamSize,
 *             hasRole, hasProjectLink, hasDescription, hasResponsibilities, hasNext
 *   internal page breaks (units that never split, see section 5 of the patcher): per project isFirst and
 *             firstX / restX for X = Tech, TeamSize, Role, ProjectLink; skillsHead / skillsRest and the same for
 *             certifications, managerial, domains, languages
 *   external  hasExperience; per project: hasDuration, hasTeamSize, hasRole, hasDescription,
 *             hasResponsibilities, hasNext; per employer: hasPosition, hasDuration, hasHighlights
 * Required content (name, job title, overview, education, skills) has no flag.
 */
import { isNAValue, type ExternalResume, type InternalResume, type ResumeData, type TemplateId } from "./schemas";
import { splitDescription } from "./textMetrics";

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
    .map((p, i, all) => ({
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
      // as internal: the gap after a project only separates it from the next one (none before the Experience heading)
      hasNext: i < all.length - 1,
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
  };
}

/**
 * Page breaks: the width (pt) of the column a project description is printed in (scripts/patch-templates.py: internal, the
 * main column's units, 7170 - 2 x 144 twips; external, the page between its 0.6in margins) and its size (Lexend Light 11pt).
 */
const DESCRIPTION_COLUMN_PT: Record<TemplateId, number> = { internal: 344.1, external: 525.6 };
const DESCRIPTION_SIZE_PT = 11;

/**
 * Page breaks: a description of up to 6 lines is one unit that never splits (descriptionWhole); a longer one is printed as
 * its first 2 lines, the middle and its last 2 lines (descriptionHead / Body / Tail: the first and last are units), so a
 * page break inside it leaves at least 2 lines on each side. LibreOffice ignores widow / orphan control in table cells.
 */
function descriptionUnits(template: TemplateId, description: string | undefined): Record<string, unknown> {
  const value = text(description);
  const split = value ? splitDescription(value, DESCRIPTION_COLUMN_PT[template], DESCRIPTION_SIZE_PT) : { whole: true as const };
  return split.whole
    ? { descriptionWhole: real(value), descriptionLong: false }
    : { descriptionWhole: false, descriptionLong: true, descriptionHead: split.head, descriptionBody: split.body, descriptionTail: split.tail };
}

/** Internal page breaks: a list's first item goes with its section heading (one unit), the rest one unit each. */
function headRest<T>(key: string, list: T[]): Record<string, T[]> {
  return { [`${key}Head`]: list.slice(0, 1), [`${key}Rest`]: list.slice(1) };
}

const PROJECT_FIELDS = ["Tech", "TeamSize", "Role", "ProjectLink"] as const;

/** Internal page breaks: the first field a project has goes with its heading and name (firstX), the others follow (restX). */
function fieldFlags(has: Record<(typeof PROJECT_FIELDS)[number], boolean>): Record<string, boolean> {
  const first = PROJECT_FIELDS.find((f) => has[f]);
  return Object.fromEntries(PROJECT_FIELDS.flatMap((f) => [[`first${f}`, f === first], [`rest${f}`, has[f] && f !== first]]));
}

function prepareInternal(d: InternalResume): Record<string, unknown> {
  const projects = d.projects
    .filter((p) => anyReal(p.duration, p.title, p.toolsAndTechnologies, p.teamSize, p.role, p.projectLink, p.description, p.responsibilities))
    .map((p, i, all) => ({
      isFirst: i === 0, // the "Projects" heading goes with the first project's heading
      ...fieldFlags({ Tech: clean(p.toolsAndTechnologies).length > 0, TeamSize: real(p.teamSize), Role: real(p.role), ProjectLink: real(p.projectLink) }),
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
      ...descriptionUnits("internal", p.description),
      responsibilities: clean(p.responsibilities),
      hasResponsibilities: clean(p.responsibilities).length > 0,
      // the blank line after a project only separates it from the next one (none after the last: no extra empty page)
      hasNext: i < all.length - 1,
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
    ...headRest("skills", d.skills.filter((s) => real(s.name))),
    certifications,
    ...headRest("certifications", certifications),
    hasCertifications: certifications.length > 0,
    tools: tools.join(", "),
    hasTools: tools.length > 0,
    managerialExperience: managerial,
    ...headRest("managerial", managerial),
    hasManagerialExperience: managerial.length > 0,
    domains,
    ...headRest("domains", domains),
    hasDomains: domains.length > 0,
    languages,
    ...headRest("languages", languages),
    hasLanguages: languages.length > 0,
  };
}
