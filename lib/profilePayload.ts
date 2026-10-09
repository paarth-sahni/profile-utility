/**
 * Purpose: validation for saving/loading profiles. A draft may still have blank fields (they are fixed
 * on the Review screen before DOCX generation), so saving uses a LENIENT structural schema: right
 * shapes and sane size limits, but no "must not be empty" rules. Pure module (no server/DB imports).
 */
import { z } from "zod";
import { reviewFlagSchema, resumeAnalysisSchema } from "./extract.types";
import type { ResumeData, TemplateId } from "./schemas";

const text = z.string().max(20_000);
const list = z.array(z.string().max(2_000)).max(200);
const education = z.array(z.object({ year: z.string().max(100), qualification: text })).max(1);

const internalLenient = z.object({
  name: text,
  jobTitle: text,
  experienceSummary: text,
  specialization: text,
  overview: text,
  education,
  projects: z
    .array(
      z.object({
        duration: text,
        title: text,
        toolsAndTechnologies: list,
        teamSize: text,
        role: text,
        projectLink: text,
        description: text,
        responsibilities: list,
      }),
    )
    .max(100),
  skills: z.array(z.object({ name: text, rating: z.string().max(50) })).max(200),
  certifications: list,
  tools: list,
  managerialExperience: list,
  domains: list,
  languages: list,
});

const externalLenient = z.object({
  name: text,
  jobTitle: text,
  experienceSummary: text,
  specialization: text,
  overview: text,
  education,
  projects: z
    .array(
      z.object({
        duration: text,
        client: text,
        teamSize: text,
        role: text,
        description: text,
        responsibilities: list,
      }),
    )
    .max(100),
  experience: z.array(z.object({ company: text, position: text, duration: text, highlights: list })).max(100),
  skills: list,
  tools: list,
  certifications: list,
});

/** Structural (not completeness) schema for a template. */
export const lenientSchemaFor = (id: TemplateId) => (id === "external" ? externalLenient : internalLenient);

const envelope = z.object({
  template: z.enum(["internal", "external"]),
  kind: z.enum(["base", "role_specific"]),
  label: z.string().trim().max(60).default(""),
  profileId: z.string().uuid().nullish(),
  parentVersionId: z.string().uuid().nullish(),
  source: z.enum(["upload", "scratch", "edit"]),
  data: z.unknown(),
  reviewFlags: z.array(reviewFlagSchema).max(200).default([]),
  analysis: resumeAnalysisSchema.nullish(),
  promptPlan: z.array(z.string().max(100)).max(50).default([]),
});

export type SavePayload = Omit<z.infer<typeof envelope>, "data"> & { data: ResumeData };

/** Parses an untrusted save request body; returns null if anything is off (no details leaked). */
export function parseSavePayload(body: unknown): SavePayload | null {
  const env = envelope.safeParse(body);
  if (!env.success) return null;
  const data = lenientSchemaFor(env.data.template).safeParse(env.data.data);
  if (!data.success) return null;
  if (env.data.kind === "role_specific" && !env.data.parentVersionId) return null;
  return { ...env.data, data: data.data as ResumeData };
}
