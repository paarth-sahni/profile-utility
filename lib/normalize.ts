/**
 * Purpose: coerce a partial / loosely-typed extraction result into a complete resume object
 * so the Review forms never crash. Missing keys come from blankResume(); numbers become strings;
 * education always keeps exactly one editable entry (the forms read education[0]).
 */
import { normalizeRating } from "./rating";
import { blankResume, type InternalResume, type ResumeData, type TemplateId } from "./schemas";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Shapes `raw` like `template`: strings stay strings, scalars are stringified, arrays map per item. */
function coerce(template: unknown, raw: unknown): unknown {
  if (Array.isArray(template)) {
    if (!Array.isArray(raw)) return structuredClone(template);
    return raw.map((item) => coerce(template[0], item));
  }
  if (isRecord(template)) {
    const src = isRecord(raw) ? raw : {};
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, coerce(v, src[k])]));
  }
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

/** Returns a complete, form-safe resume of the given template from untrusted `raw` data. */
export function normalizeToShape(templateId: TemplateId, raw: unknown): ResumeData {
  const blank = blankResume(templateId);
  // coerce() preserves the blank template's shape, so the result is a ResumeData of that template.
  const result = coerce(blank, raw) as ResumeData;
  if (result.education.length === 0) result.education = structuredClone(blank.education);
  // a skill rating is above 0 and at most 5 with one decimal; anything else is left blank for the person to enter
  if (templateId === "internal") for (const skill of (result as InternalResume).skills) skill.rating = normalizeRating(skill.rating);
  return result;
}
