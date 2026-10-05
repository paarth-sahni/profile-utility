/**
 * Purpose: the extraction pipeline — upload bytes in, pre-filled profile out.
 *   read text → pass 1 analyse → build adaptive prompt → pass 2 extract → validate/repair → normalise.
 * Plain function shared by the /api/extract route (and later the eval script). Server-only.
 * Never logs resume text or extracted data.
 */
import { z } from "zod";
import {
  ExtractError,
  resumeAnalysisSchema,
  reviewFlagSchema,
  type ExtractIssue,
  type ExtractResult,
  type ResumeAnalysis,
  type ReviewFlag,
} from "./extract.types";
import { extractResumeText } from "./extractText";
import { applyBackstops, reconcileFlagPaths } from "./backstops";
import { completeJson } from "./llm";
import { normalizeToShape } from "./normalize";
import { ANALYZE_PROMPT, RESUME_AS_DATA_RULE, buildExtractionPrompt, describePromptPlan } from "./prompts";
import { describeFieldPath, schemaFor, type TemplateId } from "./schemas";
import { getServerConfig } from "./serverConfig";

const TOTAL_TIMEOUT_MS = 60_000;

const wrapResume = (text: string) => `<resume>\n${text}\n</resume>`;

/** Parses model output as a JSON object; returns null if it isn't valid JSON. */
function parseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Splits model output into the profile data and its review flags. */
function splitFlags(parsed: unknown): { data: unknown; flags: ReviewFlag[] } {
  if (!isRecord(parsed)) return { data: parsed, flags: [] };
  const { reviewFlags, ...data } = parsed;
  const flags = z.array(reviewFlagSchema).safeParse(reviewFlags);
  return { data, flags: flags.success ? flags.data : [] };
}

/**
 * Issues about *missing* content (empty required text/lists). These are expected now that the
 * model is told never to invent values, so they are shown to the user rather than repaired.
 */
const isMissingContent = (issue: z.core.$ZodIssue): boolean =>
  issue.code === "too_small" || (issue.code === "custom" && /is required$/.test(issue.message)) || /is required$/.test(issue.message);

function toIssues(issues: z.core.$ZodIssue[]): ExtractIssue[] {
  return issues.map((i) => ({
    path: i.path.length ? describeFieldPath(i.path as (string | number)[]) : "Document",
    message: i.message,
  }));
}

/** Runs the full pipeline for one uploaded file. */
export async function extractProfile(buffer: Buffer, templateId: TemplateId): Promise<ExtractResult> {
  const cfg = getServerConfig();
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // 1. Read the file into plain text.
  const { text, notes } = await extractResumeText(buffer);
  const user = wrapResume(text);

  // 2. Pass 1: analyse the document.
  const analysisRaw = await completeJson({
    model: cfg.modelAnalyze,
    system: ANALYZE_PROMPT,
    user,
    schema: resumeAnalysisSchema,
    schemaName: "resume_analysis",
    reasoningEffort: "low",
    maxTokens: 3000,
    signal,
  });
  const analysisParsed = resumeAnalysisSchema.safeParse(parseJson(analysisRaw));
  if (!analysisParsed.success) {
    console.error("[extract] analysis response failed validation");
    throw new ExtractError("LLM_FAILED", "The analysis step failed.");
  }
  const analysis: ResumeAnalysis = analysisParsed.data;

  // 3. Build the adaptive prompt.
  const system = buildExtractionPrompt(templateId, analysis, today);
  const promptPlan = describePromptPlan(analysis);

  // 4. Pass 2: extract (retry once with the fallback model if the output isn't JSON).
  const profileSchema = schemaFor(templateId);
  const extractSchema = profileSchema.extend({ reviewFlags: z.array(reviewFlagSchema) });
  const call = (model: string, userMessage: string, systemPrompt: string) =>
    completeJson({ model, system: systemPrompt, user: userMessage, schema: extractSchema, schemaName: "profile", temperature: 0, signal });

  let parsed = parseJson(await call(cfg.modelExtract, user, system));
  if (parsed === null) {
    console.warn("[extract] extraction output was not JSON; retrying with fallback model");
    parsed = parseJson(await call(cfg.modelFallback, user, system));
  }
  if (parsed === null) throw new ExtractError("LLM_FAILED", "The model did not return JSON.");

  let { data, flags } = splitFlags(parsed);
  let check = profileSchema.safeParse(data);

  // 5. One repair call, only for structural problems (wrong types, word limits, extra education
  //    entries). Missing content is NOT repaired — repairing would push the model to invent facts.
  if (!check.success) {
    const structural = check.error.issues.filter((i) => !isMissingContent(i));
    if (structural.length > 0) {
      const problems = toIssues(structural)
        .map((i) => `- ${i.path}: ${i.message}`)
        .join("\n");
      const repairUser = `${user}\n\nYour previous JSON had these problems:\n${problems}\n\nPrevious JSON:\n${JSON.stringify(parsed)}\n\nReturn corrected JSON. Fix only the listed problems. Do not invent facts to fill empty fields — leave them empty.`;
      const repaired = parseJson(await call(cfg.modelExtract, repairUser, `${system}\n\n${RESUME_AS_DATA_RULE}`));
      if (repaired !== null) {
        const split = splitFlags(repaired);
        data = split.data;
        flags = split.flags.length > 0 ? split.flags : flags;
        check = profileSchema.safeParse(data);
      }
    }
  }

  // 6. Code backstops (the prompt alone isn't reliable): fill empty responsibilities from the role,
  //    flag pronoun-style overviews and banned words that aren't in the source. Runs before
  //    normalisation so the issues below reflect the fixes.
  const backstopped = applyBackstops(templateId, data, flags, text);

  // 7. Always return something the Review form can render, plus whatever is still invalid.
  const normalized = normalizeToShape(templateId, backstopped.data);
  const finalCheck = profileSchema.safeParse(normalized);
  const issues = finalCheck.success ? [] : toIssues(finalCheck.error.issues);
  // every flag must point at a field that exists in the output
  const reviewFlags: ReviewFlag[] = [
    ...notes.map((reason) => ({ path: "", reason })),
    ...reconcileFlagPaths(normalized, backstopped.flags),
  ];

  return { data: normalized, reviewFlags, analysis, promptPlan, issues };
}
