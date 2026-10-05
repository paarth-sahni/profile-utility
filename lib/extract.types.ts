/**
 * Purpose: shared types, error codes and zod schemas for the resume-extraction pipeline
 * (server route, pipeline, prompts) and its browser client.
 */
import { z } from "zod";
import type { ResumeData } from "./schemas";

/** Friendly, stable error codes returned by /api/extract. */
export type ExtractErrorCode =
  | "UNSUPPORTED_FILE"
  | "TOO_LARGE"
  | "UNREADABLE"
  | "LLM_FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED";

/** Error thrown anywhere in the pipeline; the route maps `code` to an HTTP status. */
export class ExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

/** A value the model had to infer or estimate; `path` is a dot path such as "projects.0.duration". */
export const reviewFlagSchema = z.object({ path: z.string(), reason: z.string() });
export type ReviewFlag = z.infer<typeof reviewFlagSchema>;

/** Pass-1 output: a description of the document used to adapt the extraction prompt. */
export const resumeAnalysisSchema = z.object({
  documentType: z.enum(["infobeans_internal_profile", "infobeans_external_profile", "standard_resume", "linkedin_export", "other"]),
  seniority: z.enum(["fresher", "junior", "mid", "senior", "leadership"]),
  roleFamily: z.enum([
    "software_engineering",
    "frontend",
    "backend",
    "mobile",
    "qa_testing",
    "data_ai",
    "devops_cloud",
    "platform_servicenow",
    "platform_salesforce",
    "platform_other",
    "design_ux",
    "project_program_management",
    "business_analysis",
    "delivery_leadership",
    "other",
  ]),
  projectsLayout: z.enum(["separate_section", "embedded_in_jobs", "none"]),
  presentSections: z.array(
    z.enum([
      "summary",
      "education",
      "skills",
      "tools",
      "certifications",
      "projects",
      "work_experience",
      "domains",
      "languages",
      "managerial_experience",
      "skill_ratings",
    ]),
  ),
  density: z.enum(["sparse", "normal", "very_long"]),
  hasMetrics: z.boolean(),
  earliestProfessionalStart: z.string(),
  notes: z.array(z.string()),
});
export type ResumeAnalysis = z.infer<typeof resumeAnalysisSchema>;

/** A validation problem the user still has to fix on the Review screen. */
export interface ExtractIssue {
  path: string;
  message: string;
}

/** Successful /api/extract response body. */
export interface ExtractResult {
  data: ResumeData;
  reviewFlags: ReviewFlag[];
  analysis: ResumeAnalysis;
  /** Names of the prompt modules that were applied (dev visibility). */
  promptPlan: string[];
  issues: ExtractIssue[];
}

/** Error /api/extract response body. */
export interface ExtractErrorBody {
  error: { code: ExtractErrorCode; message: string };
}

/** Message shown to the user for each error code. */
export const EXTRACT_ERROR_MESSAGES: Record<ExtractErrorCode, string> = {
  UNSUPPORTED_FILE: "Please upload a PDF or DOCX file.",
  TOO_LARGE: "That file is too large. Please upload a smaller PDF or DOCX.",
  UNREADABLE: "This file looks like a scanned image. Please upload a DOCX or a text-based PDF.",
  LLM_FAILED: "We couldn't read this resume automatically. Please try again, or fill in the form manually.",
  TIMEOUT: "This is taking too long. Please try again, or fill in the form manually.",
  RATE_LIMITED: "The service is busy, try again in a minute.",
};
