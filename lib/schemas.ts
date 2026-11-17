import { z } from "zod";
import { RATING_MESSAGE, isValidRating } from "./rating";

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

/** True when a name has at least one letter or digit, so "--", "..." or "/" do not pass as a name. */
export const isMeaningfulName = (value: string): boolean => isRealText(value) && /[\p{L}\p{N}]/u.test(value);

/** An optional list (certifications, tools, ...): may be empty, and blank / "N/A" items are allowed and ignored. */
const optionalList = () => z.array(z.string());

/** An optional header line: blank is fine; when filled it is capped at `max` words. */
const optionalMaxWords = (label: string, max: number) =>
  z.string().refine((v) => wordCount(v) <= max, `${label} must be at most ${max} words`);

/** True when any of the given values (text or list of text) has real content. */
const anyReal = (...values: (string | string[])[]): boolean =>
  values.some((v) => (Array.isArray(v) ? v.some(isRealText) : isRealText(v)));

/*
 * REQUIRED in every profile: name, job title, experience summary, overview, education (exactly one entry), at least one skill.
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
    if (anyReal(p.duration, p.client, p.teamSize, p.role, p.description, p.responsibilities) && !isMeaningfulName(p.client)) {
      ctx.addIssue({
        code: "custom",
        path: ["client"],
        message: isRealText(p.client) ? "Enter a valid project name" : "client is required",
      });
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
    if (anyReal(x.company, x.position, x.duration, x.highlights) && !isMeaningfulName(x.company)) {
      ctx.addIssue({
        code: "custom",
        path: ["company"],
        message: isRealText(x.company) ? "Enter a valid company name" : "company is required",
      });
    }
  });

/** Limits that keep a custom section's heading and label lines on one line of the page. */
export const CUSTOM_TITLE_MAX = 60;
export const CUSTOM_LABEL_MAX = 40;
export const CUSTOM_VALUE_MAX = 200;

export const customFieldSchema = z.object({
  label: z.string().max(CUSTOM_LABEL_MAX, `Label must be at most ${CUSTOM_LABEL_MAX} characters`),
  value: z.string().max(CUSTOM_VALUE_MAX, `Value must be at most ${CUSTOM_VALUE_MAX} characters`),
});

/**
 * A section the user adds to an external profile: a title, any number of "label: value" fields and a description.
 * A section with anything in it needs a title; a field needs BOTH a label and a value (a bare value would look vague, and a
 * label alone prints nothing useful); a titled section needs at least one field or a description. An empty row is ignored.
 */
export const customSectionSchema = z
  .object({
    title: z.string().max(CUSTOM_TITLE_MAX, `Title must be at most ${CUSTOM_TITLE_MAX} characters`),
    fields: z.array(customFieldSchema),
    description: looseText(),
  })
  .superRefine((s, ctx) => {
    const rows = s.fields.map((f) => [isRealText(f.label), isRealText(f.value)] as const);
    s.fields.forEach((_, i) => {
      const [hasLabel, hasValue] = rows[i];
      if (hasLabel === hasValue) return;
      ctx.addIssue({ code: "custom", path: ["fields", i, hasLabel ? "value" : "label"], message: "Enter both a label and a value" });
    });
    const hasField = rows.some(([l, v]) => l && v);
    if (isRealText(s.title) || isRealText(s.description) || rows.some(([l, v]) => l || v)) {
      if (!isMeaningfulName(s.title)) {
        ctx.addIssue({ code: "custom", path: ["title"], message: isRealText(s.title) ? "Enter a valid section title" : "title is required" });
      } else if (!hasField && !isRealText(s.description)) {
        ctx.addIssue({ code: "custom", path: ["description"], message: "Add a field or a description" });
      }
    }
  });

export const externalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: nonEmpty("experienceSummary"),
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
  /** The resume's own achievements / awards section, one entry per item (printed under "Achievements"). */
  achievements: optionalList().default([]),
  /** Sections the user added by hand (never produced by the extraction). */
  customSections: z.array(customSectionSchema).default([]),
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
      !isMeaningfulName(p.title)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: isRealText(p.title) ? "Enter a valid project name" : "title is required",
      });
    }
  });

export const internalSkillSchema = z.object({
  name: nonEmpty("skill name"),
  rating: nonEmpty("rating").refine((v) => v === "" || isValidRating(v), RATING_MESSAGE),
});

export const internalResumeSchema = z.object({
  name: nonEmpty("name"),
  jobTitle: nonEmpty("jobTitle"),
  experienceSummary: nonEmpty("experienceSummary"),
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
  /** Dot path of the field ("projects.0.title"), used to highlight it on the Review screen. */
  key?: string;
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
  label: "Label",
  value: "Value",
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
  achievements: "Achievement",
  customSections: "Custom section",
  fields: "Field",
};

// Sections that always contain exactly one entry, so numbering it ("Education 1") would be noise.
const SINGULAR_SECTIONS = new Set(["education"]);

/** The label for one path key ("rating" -> "Rating", "skills" -> "Skill"); unknown keys are returned as they are. */
export const labelForSegment = (key: string): string => FIELD_LABELS[key] ?? SECTION_LABELS[key] ?? key;

/** True for sections that always hold exactly one entry (education), where numbering would be noise. */
export const isSingularSection = (key: string): boolean => SINGULAR_SECTIONS.has(key);

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
const OPTIONAL_TOP_LEVEL = new Set(["specialization", "certifications", "tools", "domains", "languages", "managerialExperience", "achievements", "customSections"]);
/** The one field of a project / experience entry that must be real when the entry is used. */
const ENTRY_NAME_KEYS = new Set(["title", "client", "company"]);

/** Optional places where a leftover "N/A" is fine: the optional top-level fields, and everything inside a project
 *  or experience entry except its name (the document simply leaves the field or section out). Required fields
 *  (name, job title, experience summary, overview, education, skills) and entry names are still checked. */
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
          key: path.join("."),
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
      achievements: [""],
      customSections: [], // added by the user with "Add custom section"
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
