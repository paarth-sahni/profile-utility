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
 *   internal page breaks (units that never split, see section 5 of the patcher): educationGapAfter; per project isFirst and
 *             firstX / restX for X = Tech, TeamSize, Role, ProjectLink; skillsHead / skillsRest and the same for
 *             certifications, managerial, domains, languages; per project descriptionWhole / descriptionLong with
 *             descriptionHead / Body / Tail / descriptionHasBody (a project description of more than 3 lines; a custom
 *             section's, more than 6: DESCRIPTION_MAX_WHOLE)
 *   external  hasExperience; per project: hasDuration, hasTeamSize, hasRole, hasDescription,
 *             hasResponsibilities, hasNext; per employer: hasPosition, hasDuration, hasHighlights
 *   external page breaks: per project isFirst, firstX / restX for X = TeamSize, Role and the description pieces (as
 *             internal); per employer isFirst, highlightsHead / highlightsRest
 *   gaps (both): each unit ends with the gap to what follows it, so no gap is printed at the top of a page: per project
 *             <part>Gap<Kind> (trailingGaps) and bulletUnits ({ text, last }); <section>GapAfter (laterSections); sidebar
 *             list items as { text, last } (skills { name, rating, last })
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
    .map((p, i, all) => {
      const fields = fieldFlags({ TeamSize: real(p.teamSize), Role: real(p.role) });
      const bullets = clean(p.responsibilities);
      return {
        number: i + 1,
        isFirst: i === 0, // page breaks: the "Projects/Experience" heading goes with the first project's heading
        ...fields,
        ...trailingGaps(
          [["first", true, null], ["restTeamSize", fields.restTeamSize, "Label"], ["restRole", fields.restRole, "Label"], ["description", real(p.description), "Description"], ["bullets", bullets.length > 0, "Bullets"]],
          i < all.length - 1 ? "Next" : "End",
        ),
        bulletUnits: bulletUnits(bullets),
        client: p.client,
        duration: text(p.duration),
        hasDuration: real(p.duration),
        teamSize: text(p.teamSize),
        hasTeamSize: real(p.teamSize),
        role: text(p.role),
        hasRole: real(p.role),
        description: text(p.description),
        hasDescription: real(p.description),
        ...descriptionUnits("external", p.description, DESCRIPTION_MAX_WHOLE.project),
        responsibilities: clean(p.responsibilities),
        hasResponsibilities: clean(p.responsibilities).length > 0,
        // as internal: the gap after a project only separates it from the next one (none before the Experience heading)
        hasNext: i < all.length - 1,
      };
    });
  const achievements = clean(d.achievements);
  const customSections = prepareCustomSections(d.customSections);
  // Experience is followed by Achievements and / or custom sections: then the last unit of the LAST employer ends with the gap
  const afterExperience = achievements.length > 0 || customSections.length > 0;
  const experience = d.experience
    .filter((x) => anyReal(x.company, x.position, x.duration, x.highlights))
    .map((x, i, all) => {
      const highlights = clean(x.highlights);
      const closes = afterExperience && i === all.length - 1; // this employer's last unit carries the closing gap
      return {
        isFirst: i === 0, // page breaks: the "Experience" heading goes with the first employer
        company: x.company,
        position: text(x.position),
        hasPosition: real(x.position),
        duration: text(x.duration),
        hasDuration: real(x.duration),
        highlights,
        hasHighlights: highlights.length > 0,
        // page breaks: the first highlight stays with company, position and dates; each item knows whether it ends the section
        headerCloseGap: closes && highlights.length === 0,
        highlightsHead: highlights.slice(0, 1).map((t) => ({ text: t, closeGap: closes && highlights.length === 1 })),
        highlightsRest: highlights.slice(1).map((t, k, rest) => ({ text: t, closeGap: closes && k === rest.length - 1 })),
      };
    });
  const tools = clean(d.tools);
  const certifications = clean(d.certifications);
  return {
    // page breaks: the gap before a section heading goes after the section before it, when one follows
    ...laterSections([
      ["education", true], ["skills", true], ["tools", tools.length > 0], ["certifications", certifications.length > 0],
      ["projects", projects.length > 0], ["experience", experience.length > 0], ["achievements", achievements.length > 0], ["custom", customSections.length > 0],
    ]),
    // the Achievements list: the first item goes with the heading (one unit), each further one is a unit; `last` ends the section
    ...headRestItems("achievements", achievements, (t) => ({ text: t })),
    hasAchievements: achievements.length > 0,
    customSections,
    hasCustomSections: customSections.length > 0,
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
 * The custom sections of an external profile (title, "label: value" fields, description), cleaned for the template. A field
 * needs both a label and a value; a section needs a title and at least one field or a description (anything else is left
 * out, never a lone heading). Page breaks: the title goes with the section's first field, or with the first lines of the
 * description when there are no fields; each further field is its own unit; every field knows which gap follows it
 * (gapLabel: another field, gapDescription: the description, gapSection: the next custom section), and sectionGap tells the
 * description (the last unit) whether another section follows, so no gap is ever printed at the top of a page.
 */
function prepareCustomSections(list: ExternalResume["customSections"] | undefined) {
  const sections = (list ?? [])
    .map((s) => ({
      title: text(s.title).trim(),
      rows: s.fields.filter((f) => real(f.label) && real(f.value)).map((f) => ({ label: f.label.trim(), value: f.value.trim() })),
      description: text(s.description),
    }))
    .filter((s) => s.title !== "" && (s.rows.length > 0 || real(s.description)));
  return sections.map((s, i, all) => {
    const next = i < all.length - 1;
    const hasDescription = real(s.description);
    const fields = s.rows.map((f, k) => {
      const last = k === s.rows.length - 1;
      return { ...f, gapLabel: !last, gapDescription: last && hasDescription, gapSection: last && !hasDescription && next };
    });
    return {
      title: s.title,
      hasFields: fields.length > 0,
      noFields: fields.length === 0,
      firstField: fields.slice(0, 1),
      restFields: fields.slice(1),
      hasDescription,
      description: s.description,
      ...descriptionUnits("external", s.description, DESCRIPTION_MAX_WHOLE.custom),
      sectionGap: next,
    };
  });
}

/**
 * Page breaks: the width (pt) of the column a project description is printed in (scripts/patch-templates.py: internal, the
 * main column's units, 7170 - 144 - 432 twips (its cell's margins; the right one makes the 0.4in gap to the sidebar);
 * external, the page between its 0.6in margins) and its size (Lexend Light 11pt). test-render.mjs --pdf compares the
 * estimate with the PDF.
 */
export const DESCRIPTION_COLUMN_PT: Record<TemplateId, number> = { internal: 329.7, external: 525.6 };
const DESCRIPTION_SIZE_PT = 11;

/**
 * Page breaks: the longest description that is never split. A project's description (both templates) is kept whole up to 3
 * lines, and its first lines go with the project's heading, name and fields (one unit): a longer one may continue on the next
 * page. A custom section's description (external) is kept whole up to 6 lines.
 */
export const DESCRIPTION_MAX_WHOLE = { project: 3, custom: 6 } as const;

/**
 * Page breaks: a description of up to `maxWhole` lines is never split (descriptionWhole); a longer one is printed as its first
 * 2 lines, the middle (descriptionHasBody: none for a description of 4 lines) and its last 2 lines (descriptionHead / Body /
 * Tail: the first and last in units), so a page break inside it leaves at least 2 lines on each side. LibreOffice ignores
 * widow / orphan control in table cells.
 */
function descriptionUnits(template: TemplateId, description: string | undefined, maxWhole: number): Record<string, unknown> {
  const value = text(description);
  const split = value ? splitDescription(value, DESCRIPTION_COLUMN_PT[template], DESCRIPTION_SIZE_PT, maxWhole) : { whole: true as const };
  return split.whole
    ? { descriptionWhole: real(value), descriptionLong: false }
    : { descriptionWhole: false, descriptionLong: true, descriptionHead: split.head, descriptionBody: split.body, descriptionHasBody: split.body !== "", descriptionTail: split.tail };
}

/** Internal page breaks: a list's first item goes with its section heading (one unit), the rest one unit each. */
function headRest<T>(key: string, list: T[]): Record<string, T[]> {
  return { [`${key}Head`]: list.slice(0, 1), [`${key}Rest`]: list.slice(1) };
}

/** As headRest, each item an object that knows whether it is the list's last (the section's gap goes after that one). */
function headRestItems<T>(key: string, list: T[], toItem: (item: T) => object): Record<string, object[]> {
  return headRest(key, list.map((item, i) => ({ ...toItem(item), last: i === list.length - 1 })));
}

/**
 * Page breaks: every gap belongs to the unit BEFORE it (its last lines), so a gap is only ever printed between two things on
 * the same page and never at the top of a page (LibreOffice keeps a blank line or space before at the top of a page in a
 * table cell). What a unit ends with depends on what follows it, so this decides, for each part of a project in order
 * ([key, printed, the gap that goes before it]), which gap that part ends with: `${key}Gap${Kind}` (Label: before a field;
 * Description; Bullets; Next: before the next project; End: after the last external project, before Experience).
 */
const GAP_KINDS = ["Label", "Description", "Bullets", "Next", "End"] as const;
type GapKind = (typeof GAP_KINDS)[number];
function trailingGaps(parts: [string, boolean, GapKind | null][], end: GapKind | null): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const [key] of parts) for (const kind of GAP_KINDS) flags[`${key}Gap${kind}`] = false;
  const printed = parts.filter(([, on]) => on);
  printed.forEach(([key], i) => {
    const after = i + 1 < printed.length ? printed[i + 1][2] : end;
    if (after) flags[`${key}Gap${after}`] = true;
  });
  return flags;
}

/** Page breaks: the bullets as objects, the last one marked (the project's closing gap goes after it). */
const bulletUnits = (items: string[]) => items.map((text, i) => ({ text, last: i === items.length - 1 }));

/** Page breaks: for each section in order ([key, printed]), whether another one is printed after it (its gap is then needed). */
function laterSections(sections: [string, boolean][]): Record<string, boolean> {
  return Object.fromEntries(sections.map(([key], i) => [`${key}GapAfter`, sections.slice(i + 1).some(([, on]) => on)]));
}


/**
 * Page breaks: every field is in the project's first unit with its heading, name and the start of its description; the first
 * one a project has (firstX) has the space after the name before it, the others (restX) the space between fields. `has` lists
 * the template's fields in their order (internal: Tech, TeamSize, Role, ProjectLink; external: TeamSize, Role).
 */
function fieldFlags(has: Record<string, boolean>): Record<string, boolean> {
  const fields = Object.keys(has);
  const first = fields.find((f) => has[f]);
  return Object.fromEntries(fields.flatMap((f) => [[`first${f}`, f === first], [`rest${f}`, has[f] && f !== first]]));
}

function prepareInternal(d: InternalResume): Record<string, unknown> {
  const projects = d.projects
    .filter((p) => anyReal(p.duration, p.title, p.toolsAndTechnologies, p.teamSize, p.role, p.projectLink, p.description, p.responsibilities))
    .map((p, i, all) => {
      const fields = fieldFlags({ Tech: clean(p.toolsAndTechnologies).length > 0, TeamSize: real(p.teamSize), Role: real(p.role), ProjectLink: real(p.projectLink) });
      const bullets = clean(p.responsibilities);
      return {
        isFirst: i === 0, // the "Projects" heading goes with the first project's heading
        ...fields,
        ...trailingGaps(
          [
            ["first", true, null],
            ...(["Tech", "TeamSize", "Role", "ProjectLink"].map((f) => [`rest${f}`, fields[`rest${f}`], "Label"]) as [string, boolean, GapKind][]),
            ["description", real(p.description), "Description"],
            ["bullets", bullets.length > 0, "Bullets"],
          ],
          i < all.length - 1 ? "Next" : null,
        ),
        bulletUnits: bulletUnits(bullets),
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
        ...descriptionUnits("internal", p.description, DESCRIPTION_MAX_WHOLE.project),
        responsibilities: clean(p.responsibilities),
        hasResponsibilities: clean(p.responsibilities).length > 0,
        // the blank line after a project only separates it from the next one (none after the last: no extra empty page)
        hasNext: i < all.length - 1,
      };
    });
  const certifications = clean(d.certifications);
  const tools = clean(d.tools);
  const managerial = clean(d.managerialExperience);
  const domains = clean(d.domains);
  const languages = clean(d.languages);
  return {
    // page breaks: a sidebar section's closing gap (its spacer and the next heading's space) only when another follows
    ...laterSections([["skills", true], ["certifications", certifications.length > 0], ["tools", tools.length > 0], ["managerial", managerial.length > 0], ["domains", domains.length > 0], ["languages", languages.length > 0]]),
    // main column: Education & Training ends with the space before the "Projects" heading when projects follow
    educationGapAfter: projects.length > 0,
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
    ...headRestItems("skills", d.skills.filter((s) => real(s.name)), (s) => s),
    certifications,
    ...headRestItems("certifications", certifications, (text) => ({ text })),
    hasCertifications: certifications.length > 0,
    tools: tools.join(", "),
    hasTools: tools.length > 0,
    managerialExperience: managerial,
    ...headRestItems("managerial", managerial, (text) => ({ text })),
    hasManagerialExperience: managerial.length > 0,
    domains,
    ...headRestItems("domains", domains, (text) => ({ text })),
    hasDomains: domains.length > 0,
    languages,
    ...headRestItems("languages", languages, (text) => ({ text })),
    hasLanguages: languages.length > 0,
  };
}
