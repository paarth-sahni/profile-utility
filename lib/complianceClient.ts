/**
 * Purpose: browser side of the client-name check. Asks POST /api/compliance/check whether the profile names a registered
 * client, company or project, and turns the answer into what the forms show (a message per field and the text to mark).
 * The server holds the list: the browser only ever learns about text the user typed. This is advice while editing; the real
 * gate is on /api/pdf and /api/profiles. Pure helpers are unit-tested (lib/complianceClient.test.ts).
 */
import { COMPLIANCE_MESSAGE, type ViolationDto } from "./compliance/check";
import type { ResumeData, TemplateId } from "./schemas";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type ComplianceMatch = Pick<ViolationDto, "path" | "start" | "end" | "matchedText">;
export type Range = { start: number; end: number };

export type ComplianceResult =
  | { status: "ok"; enforced: boolean; matches: ComplianceMatch[] }
  | { status: "unavailable" } // the server could not check (registry not loaded)
  | { status: "unauthenticated" }
  | { status: "failed" }; // network or unexpected error: not treated as a pass or a block by the editor (the server gate decides)

export async function checkComplianceRemote(template: TemplateId, data: ResumeData, signal?: AbortSignal): Promise<ComplianceResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, data }),
      signal,
    });
  } catch {
    return { status: "failed" };
  }
  if (res.status === 401) return { status: "unauthenticated" };
  if (res.status === 503) return { status: "unavailable" };
  if (!res.ok) return { status: "failed" };
  try {
    const json = (await res.json()) as { enforced?: unknown; violations?: unknown };
    const matches = Array.isArray(json.violations) ? (json.violations as ComplianceMatch[]) : [];
    return { status: "ok", enforced: json.enforced === true, matches };
  } catch {
    return { status: "failed" };
  }
}

/** One message per field path, for the red field marks. */
export function messagesByPath(matches: readonly { path: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of matches) out[m.path] = COMPLIANCE_MESSAGE;
  return out;
}

/** The text ranges to mark per field path. */
export function rangesByPath(matches: readonly { path: string; start: number; end: number }[]): Record<string, Range[]> {
  const out: Record<string, Range[]> = {};
  for (const m of matches) (out[m.path] ??= []).push({ start: m.start, end: m.end });
  return out;
}

/** A readable list entry for the "please fix" box: "Projects → ... — Registered name “X” found." */
export function describeMatch(m: ComplianceMatch, label: string): { path: string; message: string } {
  return { path: label, message: `The name “${m.matchedText}” is a registered client, company or project name. Remove or rephrase it.` };
}
