/**
 * Purpose: coerce a partial / loosely-typed extraction result into a complete resume object
 * so the Review forms never crash. Missing keys come from blankResume(); numbers become strings;
 * education always keeps exactly one editable entry (the forms read education[0]).
 */
import { normalizeRating } from "./rating";
import { blankResume, type ExternalResume, type InternalResume, type ResumeData, type TemplateId } from "./schemas";

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

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/**
 * Custom sections are written by the person, never by the extraction. The blank has none (`[]`), so coerce() has no item
 * shape to copy: this keeps well-formed ones from a draft or pasted data (each value as text) and drops anything else.
 */
function coerceCustomSections(raw: unknown): ExternalResume["customSections"] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((s) => ({
    title: text(s.title),
    fields: Array.isArray(s.fields) ? s.fields.filter(isRecord).map((f) => ({ label: text(f.label), value: text(f.value) })) : [],
    description: text(s.description),
  }));
}

/** Returns a complete, form-safe resume of the given template from untrusted `raw` data. */
export function normalizeToShape(templateId: TemplateId, raw: unknown): ResumeData {
  const blank = blankResume(templateId);
  // coerce() preserves the blank template's shape, so the result is a ResumeData of that template.
  const result = coerce(blank, raw) as ResumeData;
  if (templateId === "external") (result as ExternalResume).customSections = coerceCustomSections(isRecord(raw) ? raw.customSections : undefined);
  if (result.education.length === 0) result.education = structuredClone(blank.education);
  // a skill rating is above 0 and at most 5 with one decimal; anything else is left blank for the person to enter
  if (templateId === "internal") for (const skill of (result as InternalResume).skills) skill.rating = normalizeRating(skill.rating);
  return result;
}
