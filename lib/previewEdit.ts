/**
 * Purpose: the rules behind editing text on the Preview & Submit step (internal profiles). Pure (no React); unit-tested in
 * lib/previewEdit.test.ts.
 *   - `previewFields(baseline)`: which fields the editable view shows, in the order of the PDF, each with its data path
 *     ("projects.0.responsibilities.2"), its accessible name ("Project 1, bullet 3") and its kind. The layout comes from the
 *     profile as it was when Preview was entered (the baseline): only what the PDF prints is shown, so nothing can be added
 *     here, and a field that is cleared stays in place so it can be filled in again. Edits never add or remove items.
 *   - `getAt` / `setAt`: read and write one text value by its path in the same profile data the Edit page uses.
 *   - `cleanText`: plain text only. Control and zero-width characters go, and line breaks too except in the overview and the
 *     description (the template prints those as line breaks).
 *   - `emptyItemIssues`: a list item shown on Preview that is now empty blocks Download and Submit (removing an item is
 *     done on Edit).
 */
import { hasContent, hasText } from "./previewModel";
import type { InternalResume } from "./schemas";

/** text: one line (it may wrap); multiline: line breaks allowed; date: a project's dates; rating: a skill rating. */
export type PreviewFieldKind = "text" | "multiline" | "date" | "rating";

export interface PreviewField {
  /** Dot path into the profile data, the same keys the Edit page's error marks use. */
  path: string;
  /** The accessible name, e.g. "Project 2, Role". */
  label: string;
  kind: PreviewFieldKind;
  /** An item of a list (a bullet, a tool, a certification...): it must not be emptied here. */
  listItem: boolean;
}

export interface PreviewProject {
  /** "Project N" as printed (projects with nothing in them are not printed or counted). */
  number: number;
  dates: PreviewField | null;
  name: PreviewField | null;
  tools: PreviewField[];
  teamSize: PreviewField | null;
  role: PreviewField | null;
  link: PreviewField | null;
  description: PreviewField | null;
  bullets: PreviewField[];
}

/** What the editable view shows, section by section, in the order of the PDF. */
export interface PreviewLayout {
  overview: PreviewField;
  education: { year: PreviewField; qualification: PreviewField }[];
  projects: PreviewProject[];
  skills: { name: PreviewField; rating: PreviewField }[];
  certifications: PreviewField[];
  tools: PreviewField[];
  managerialExperience: PreviewField[];
  domains: PreviewField[];
  languages: PreviewField[];
}

export const EMPTY_ITEM_MESSAGE = "This item is empty: fill it in, or remove it on Edit";

const field = (path: string, label: string, kind: PreviewFieldKind = "text", listItem = false): PreviewField => ({ path, label, kind, listItem });

/** One field per printed item of a list (blank and "N/A" items are not printed), numbered as they appear. */
function listFields(items: readonly string[], path: string, label: (n: number) => string): PreviewField[] {
  const out: PreviewField[] = [];
  items.forEach((item, i) => {
    if (hasText(item)) out.push(field(`${path}.${i}`, label(out.length + 1), "text", true));
  });
  return out;
}

/** The fields shown for the profile as it was when Preview was entered. */
export function previewLayout(baseline: InternalResume): PreviewLayout {
  const projects: PreviewProject[] = [];
  baseline.projects.forEach((p, i) => {
    if (!hasContent(p.duration, p.title, p.toolsAndTechnologies, p.teamSize, p.role, p.projectLink, p.description, p.responsibilities)) return;
    const n = projects.length + 1;
    const at = `projects.${i}`;
    const one = (key: keyof typeof p, label: string, kind: PreviewFieldKind = "text") =>
      hasText(p[key] as string) ? field(`${at}.${key}`, `Project ${n}, ${label}`, kind) : null;
    projects.push({
      number: n,
      dates: one("duration", "dates", "date"),
      name: one("title", "name"),
      tools: listFields(p.toolsAndTechnologies, `${at}.toolsAndTechnologies`, (k) => `Project ${n}, tool ${k}`),
      teamSize: one("teamSize", "team size"),
      role: one("role", "role"),
      link: one("projectLink", "link"),
      description: one("description", "description", "multiline"),
      bullets: listFields(p.responsibilities, `${at}.responsibilities`, (k) => `Project ${n}, bullet ${k}`),
    });
  });
  const skills: PreviewLayout["skills"] = [];
  baseline.skills.forEach((s, i) => {
    if (!hasText(s.name)) return;
    const k = skills.length + 1;
    skills.push({ name: field(`skills.${i}.name`, `Skill ${k}, name`, "text", true), rating: field(`skills.${i}.rating`, `Skill ${k}, rating`, "rating") });
  });
  return {
    overview: field("overview", "Overview", "multiline"),
    education: baseline.education.map((_, i) => ({
      year: field(`education.${i}.year`, baseline.education.length > 1 ? `Education ${i + 1}, year` : "Education, year"),
      qualification: field(`education.${i}.qualification`, baseline.education.length > 1 ? `Education ${i + 1}, qualification` : "Education, qualification"),
    })),
    projects,
    skills,
    certifications: listFields(baseline.certifications, "certifications", (k) => `Certification ${k}`),
    tools: listFields(baseline.tools, "tools", (k) => `Tool ${k}`),
    managerialExperience: listFields(baseline.managerialExperience, "managerialExperience", (k) => `Managerial experience ${k}`),
    domains: listFields(baseline.domains, "domains", (k) => `Domain ${k}`),
    languages: listFields(baseline.languages, "languages", (k) => `Language ${k}`),
  };
}

/** Every field of the layout, in the order of the PDF (main column, then the sidebar). */
export function previewFields(layout: PreviewLayout): PreviewField[] {
  const some = (...f: (PreviewField | null)[]) => f.filter((x): x is PreviewField => x !== null);
  return [
    layout.overview,
    ...layout.education.flatMap((e) => [e.year, e.qualification]),
    ...layout.projects.flatMap((p) => [...some(p.dates, p.name), ...p.tools, ...some(p.teamSize, p.role, p.link, p.description), ...p.bullets]),
    ...layout.skills.flatMap((s) => [s.name, s.rating]),
    ...layout.certifications,
    ...layout.tools,
    ...layout.managerialExperience,
    ...layout.domains,
    ...layout.languages,
  ];
}

const steps = (path: string): string[] => path.split(".");

/** The text at `path` ("" when there is none). */
export function getAt(data: unknown, path: string): string {
  let at: unknown = data;
  for (const key of steps(path)) {
    if (at === null || typeof at !== "object") return "";
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === "string" ? at : "";
}

/** A copy of `data` with the text at `path` replaced; everything not on the path is shared, not copied. */
export function setAt<T>(data: T, path: string, value: string): T {
  const write = (node: unknown, keys: string[]): unknown => {
    const [key, ...rest] = keys;
    const next = rest.length === 0 ? value : write((node as Record<string, unknown> | null)?.[key], rest);
    if (Array.isArray(node)) {
      const copy = [...node];
      copy[Number(key)] = next;
      return copy;
    }
    return { ...(node as Record<string, unknown>), [key]: next };
  };
  return write(data, steps(path)) as T;
}

// C0 controls except tab and line breaks, DEL, C1 controls; zero-width spaces, joiners, word joiner, byte-order mark
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿]/g;

/** Plain text for a Preview field: no control or zero-width characters; line breaks only where `multiline` allows them. */
export function cleanText(text: string, multiline: boolean): string {
  const t = text.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/\t/g, " ");
  return multiline ? t : t.replace(/ *\n+ */g, " ");
}

/** Shown list items that are empty now: { key: path, message } for each, in the order of the PDF. */
export function emptyItemIssues(layout: PreviewLayout, data: unknown): { key: string; message: string }[] {
  return previewFields(layout)
    .filter((f) => f.listItem && getAt(data, f.path).trim() === "")
    .map((f) => ({ key: f.path, message: EMPTY_ITEM_MESSAGE }));
}

/** True when the field at `path` can be edited on Preview (a refusal about it can be fixed there, without going to Edit). */
export function editableOnPreview(layout: PreviewLayout, path: string): boolean {
  return previewFields(layout).some((f) => f.path === path);
}
