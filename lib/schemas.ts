import { z } from "zod";

/** Matches the placeholder the extraction LLM writes when it can't find a value: "N/A", "n/a", "NA", etc. */
const NA_PATTERN = /^n\/?a$/i;
export const isNAValue = (value: string) => NA_PATTERN.test(value.trim());

/** In the "Create a Profile from Scratch" route the experience summary is captured as a
 *  plain number of years; the profile then shows it as "<N>+ Years of Industry Experience".
 *  The LLM route already supplies the full formatted string, so it skips this. */
export const formatYearsExperience = (years: string): string => {
  const n = years.trim();
  return n ? `${n}+ Years of Industry Experience` : "";
};

// Structural check only (required-and-non-empty) — used while pasting/editing JSON, so
// the user can still reach the editable form to fix "N/A" placeholders. The "N/A" check
// itself runs separately, only right before DOCX generation (see findNAIssues below).
const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);

/** Counts space-separated words in a string (empty string => 0). */
export const wordCount = (value: string): number => {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

/** A required text field capped at `max` words (e.g. specialization: "MAX 5 WORDS"). */
const maxWords = (label: string, max: number) =>
  nonEmpty(label).refine((v) => wordCount(v) <= max, `${label} must be at most ${max} words`);

/** A field that's optional in the UI: blank is fine, and "N/A" is left as-is (the UI hints the user to fill it in or clear it). */
const looseText = () => z.string();

export const educationEntrySchema = z.object({
  year: nonEmpty("year"),
  qualification: nonEmpty("qualification"),
});

/* ---------- External template ---------- */

export const externalProjectSchema = z.object({
  duration: nonEmpty("duration"),
  client: nonEmpty("client"),
  teamSize: looseText(),
  role: nonEmpty("role"),
  description: nonEmpty("description"),
  responsibilities: z.array(nonEmpty("responsibility")).min(1, "at least one responsibility"),
});

export const externalExperienceSchema = z.object({
  company: nonEmpty("company"),
  position: nonEmpty("position"),
  duration: nonEmpty("duration"),
  highlights: z.array(nonEmpty("highlight")).min(1, "at least one highlight"),
});

export const externalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: nonEmpty("experienceSummary"),
  specialization: maxWords("specialization", 5),
  overview: nonEmpty("overview"),
  education: z
    .array(educationEntrySchema)
    .length(1, "exactly one education entry — the highest qualification only"),
  skills: z.array(nonEmpty("skill")).min(1, "at least one skill"),
  tools: z.array(nonEmpty("tool")).min(1, "at least one tool"),
  certifications: z.array(nonEmpty("certification")).min(1, "at least one certification"),
  projects: z.array(externalProjectSchema),
  experience: z.array(externalExperienceSchema).min(1, "at least one experience entry"),
});

export type ExternalResume = z.infer<typeof externalResumeSchema>;

/* ---------- Internal template ---------- */

export const internalProjectSchema = z.object({
  duration: nonEmpty("duration"),
  title: nonEmpty("title"),
  toolsAndTechnologies: z.array(nonEmpty("tool/technology")).min(1, "at least one tool/technology"),
  teamSize: looseText(),
  role: nonEmpty("role"),
  projectLink: looseText(),
  description: nonEmpty("description"),
  responsibilities: z.array(nonEmpty("responsibility")).min(1, "at least one responsibility"),
});

export const internalSkillSchema = z.object({
  name: nonEmpty("skill name"),
  rating: nonEmpty("rating"),
});

export const internalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: nonEmpty("experienceSummary"),
  specialization: maxWords("specialization", 5),
  overview: nonEmpty("overview"),
  education: z
    .array(educationEntrySchema)
    .length(1, "exactly one education entry — the highest qualification only"),
  projects: z.array(internalProjectSchema),
  skills: z.array(internalSkillSchema).min(1, "at least one skill"),
  certifications: z.array(nonEmpty("certification")).min(1, "at least one certification"),
  tools: z.array(nonEmpty("tool")).min(1, "at least one tool"),
  managerialExperience: z.array(nonEmpty("managerial experience item")),
  domains: z.array(nonEmpty("domain")).min(1, "at least one domain"),
  languages: z.array(nonEmpty("language")).min(1, "at least one language"),
});

export type InternalResume = z.infer<typeof internalResumeSchema>;

export type TemplateId = "external" | "internal";

export type ResumeData = ExternalResume | InternalResume;

export const schemaFor = (id: TemplateId) =>
  id === "external" ? externalResumeSchema : internalResumeSchema;

export interface NAIssue {
  path: string;
  message: string;
}

/** Human-readable names for schema field keys, used to turn a raw path like
 *  ["projects", 0, "duration"] into "Project 1 → Duration" for error messages. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  jobTitle: "Job Title",
  experienceSummary: "Experience Summary",
  specialization: "Specialization",
  overview: "Overview",
  year: "Year",
  qualification: "Qualification",
  client: "Client",
  teamSize: "Team Size",
  role: "Role",
  description: "Description",
  company: "Company",
  position: "Position",
  duration: "Duration",
  title: "Title",
  projectLink: "Project Link",
  rating: "Rating",
};

/** Section keys map to a singular label used for numbering each entry ("Project 1", "Skill 2", ...). */
const SECTION_LABELS: Record<string, string> = {
  education: "Education",
  skills: "Skill",
  tools: "Tool",
  certifications: "Certification",
  projects: "Project",
  experience: "Experience",
  responsibilities: "Responsibility",
  highlights: "Highlight",
  toolsAndTechnologies: "Tool/Technology",
  managerialExperience: "Managerial Experience item",
  domains: "Domain",
  languages: "Language",
};

// Sections that always contain exactly one entry, so numbering it ("Education 1") would be noise.
const SINGULAR_SECTIONS = new Set(["education"]);

/** Turns a zod/JSON path like ["projects", 0, "duration"] into "Project 1 → Duration". */
export function describeFieldPath(path: (string | number)[]): string {
  const labels: string[] = [];
  let lastKey: string | null = null;
  for (const seg of path) {
    if (typeof seg === "number") {
      if (lastKey && SINGULAR_SECTIONS.has(lastKey)) continue;
      const idx = labels.length - 1;
      if (idx >= 0) labels[idx] = `${labels[idx]} ${seg + 1}`;
      continue;
    }
    labels.push(FIELD_LABELS[seg] ?? SECTION_LABELS[seg] ?? seg);
    lastKey = seg;
  }
  return labels.join(" → ") || "This field";
}

/** Field names that are optional in the UI, so a leftover "N/A" there is fine
 *  (the field is simply left out of the final document if not filled in). */
const isOptionalNAPath = (path: (string | number)[]): boolean => {
  const key = path[path.length - 1];
  return key === "teamSize" || key === "projectLink";
};

/** Scans a resume for mandatory fields the LLM left as "N/A" (or the user typed by hand).
 *  Run this only right before generating the DOCX — not while pasting/editing JSON — so the
 *  user can still reach the editable form to fix these values. */
export function findNAIssues(templateId: TemplateId, data: ResumeData): NAIssue[] {
  const issues: NAIssue[] = [];
  const walk = (value: unknown, path: (string | number)[]) => {
    if (typeof value === "string") {
      if (isNAValue(value) && !isOptionalNAPath(path)) {
        issues.push({
          path: describeFieldPath(path),
          message: 'Still shows the placeholder "N/A" — please replace it with the real value before generating.',
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, [...path, i]));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => walk(v, [...path, k]));
    }
  };
  walk(data, []);
  return issues;
}

/** An empty resume for the "fill in a blank form" flow: every section has one
 *  editable placeholder entry so all form fields render ready to be typed into. */
export function blankResume(id: TemplateId): ResumeData {
  if (id === "external") {
    return {
      name: "",
      jobTitle: "",
      experienceSummary: "",
      specialization: "",
      overview: "",
      education: [{ year: "", qualification: "" }],
      skills: [""],
      tools: [""],
      certifications: [""],
      projects: [{ duration: "", client: "", teamSize: "", role: "", description: "", responsibilities: [""] }],
      experience: [{ company: "", position: "", duration: "", highlights: [""] }],
    };
  }
  return {
    name: "",
    jobTitle: "",
    experienceSummary: "",
    specialization: "",
    overview: "",
    education: [{ year: "", qualification: "" }],
    projects: [
      { duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""] },
    ],
    skills: [{ name: "", rating: "" }],
    certifications: [""],
    tools: [""],
    managerialExperience: [""],
    domains: [""],
    languages: [""],
  };
}
