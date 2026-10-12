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

/** A field that's optional in the UI: blank is fine, and "N/A" is left as-is (the UI hints the user to fill it in or clear it). */
const looseText = () => z.string();

/** True for a value with real content: not blank and not an "N/A"-style placeholder. */
export const isRealText = (value: string): boolean => value.trim() !== "" && !isNAValue(value);

/** An optional list (certifications, tools, ...): may be empty, and blank / "N/A" items are allowed and ignored. */
const optionalList = () => z.array(z.string());

/** An optional header line: blank is fine; when filled it is capped at `max` words. */
const optionalMaxWords = (label: string, max: number) =>
  z.string().refine((v) => wordCount(v) <= max, `${label} must be at most ${max} words`);

/** True when any of the given values (text or list of text) has real content. */
const anyReal = (...values: (string | string[])[]): boolean =>
  values.some((v) => (Array.isArray(v) ? v.some(isRealText) : isRealText(v)));

/*
 * REQUIRED in every profile: name, job title, overview, education (exactly one entry), at least one skill.
 * Everything else is OPTIONAL and may be empty: experience summary, specialization, certifications, tools, domains,
 * languages, managerial experience, projects, and (external) experience entries. An optional section with nothing
 * real in it is left out of the generated document (heading included); see prepareData in lib/docxData.ts.
 * A project / experience entry that has any real content must at least be named (project title, client, company);
 * its other fields are optional and are left out of the document when empty. A completely empty entry is ignored.
 */

export const educationEntrySchema = z.object({
  year: nonEmpty("year"),
  qualification: nonEmpty("qualification"),
});

/* ---------- External template ---------- */

export const externalProjectSchema = z
  .object({
    duration: looseText(),
    client: looseText(),
    teamSize: looseText(),
    role: looseText(),
    description: looseText(),
    responsibilities: optionalList(),
  })
  .superRefine((p, ctx) => {
    if (anyReal(p.duration, p.client, p.teamSize, p.role, p.description, p.responsibilities) && !isRealText(p.client)) {
      ctx.addIssue({ code: "custom", path: ["client"], message: "client is required" });
    }
  });

export const externalExperienceSchema = z
  .object({
    company: looseText(),
    position: looseText(),
    duration: looseText(),
    highlights: optionalList(),
  })
  .superRefine((x, ctx) => {
    if (anyReal(x.company, x.position, x.duration, x.highlights) && !isRealText(x.company)) {
      ctx.addIssue({ code: "custom", path: ["company"], message: "company is required" });
    }
  });

export const externalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: looseText(),
  specialization: optionalMaxWords("specialization", 5),
  overview: nonEmpty("overview"),
  education: z
    .array(educationEntrySchema)
    .length(1, "exactly one education entry — the highest qualification only"),
  skills: z.array(nonEmpty("skill")).min(1, "at least one skill"),
  tools: optionalList(),
  certifications: optionalList(),
  projects: z.array(externalProjectSchema),
  experience: z.array(externalExperienceSchema),
});

export type ExternalResume = z.infer<typeof externalResumeSchema>;

/* ---------- Internal template ---------- */

export const internalProjectSchema = z
  .object({
    duration: looseText(),
    title: looseText(),
    toolsAndTechnologies: optionalList(),
    teamSize: looseText(),
    role: looseText(),
    projectLink: looseText(),
    description: looseText(),
    responsibilities: optionalList(),
  })
  .superRefine((p, ctx) => {
    if (
      anyReal(p.duration, p.title, p.toolsAndTechnologies, p.teamSize, p.role, p.projectLink, p.description, p.responsibilities) &&
      !isRealText(p.title)
    ) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "title is required" });
    }
  });

export const internalSkillSchema = z.object({
  name: nonEmpty("skill name"),
  rating: nonEmpty("rating"),
});

export const internalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: looseText(),
  specialization: optionalMaxWords("specialization", 5),
  overview: nonEmpty("overview"),
  education: z
    .array(educationEntrySchema)
    .length(1, "exactly one education entry — the highest qualification only"),
  projects: z.array(internalProjectSchema),
  skills: z.array(internalSkillSchema).min(1, "at least one skill"),
  certifications: optionalList(),
  tools: optionalList(),
  managerialExperience: optionalList(),
  domains: optionalList(),
  languages: optionalList(),
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

/** Top-level fields that are optional, so a leftover "N/A" anywhere inside them is fine. */
const OPTIONAL_TOP_LEVEL = new Set(["experienceSummary", "specialization", "certifications", "tools", "domains", "languages", "managerialExperience"]);
/** The one field of a project / experience entry that must be real when the entry is used. */
const ENTRY_NAME_KEYS = new Set(["title", "client", "company"]);

/** Optional places where a leftover "N/A" is fine: the optional top-level fields, and everything inside a project
 *  or experience entry except its name (the document simply leaves the field or section out). Required fields
 *  (name, job title, overview, education, skills) and entry names are still checked. */
const isOptionalNAPath = (path: (string | number)[]): boolean => {
  const top = path[0];
  if (typeof top === "string" && OPTIONAL_TOP_LEVEL.has(top)) return true;
  if (top === "projects" || top === "experience") {
    const key = path[path.length - 1];
    return !(typeof key === "string" && ENTRY_NAME_KEYS.has(key));
  }
  return false;
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
