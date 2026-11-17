/**
 * Purpose: finds the achievements-type section of an uploaded resume IN CODE, so the model is never the only line of defence.
 * The resume text reaches the pipeline as plain lines (lib/extractText.ts: one line per heading, bullet or table cell; Word list
 * items start with "- "). This module (1) recognises the heading by its wording (Achievements, Key Accomplishments, Awards and
 * Recognition, Honours, Accolades, and the weaker Highlights / Activities headings), (2) cuts the section out up to the next
 * section heading, and (3) splits it into items (bullets, numbered lines, plain lines, wrapped lines joined). The result is
 * given to the model as the exact block to copy, and compared with the model's answer afterwards (lib/backstops.ts).
 * Pure (no server imports), so it is unit-tested with synthetic resumes (lib/achievements.test.ts).
 */

/** A heading that is surely an achievements section (1), or only possibly one (2: Highlights, Activities). */
export type AchievementTier = 1 | 2;

export interface AchievementSection {
  /** The heading exactly as the resume writes it (decoration and a trailing colon removed). */
  heading: string;
  tier: AchievementTier;
  items: string[];
  /** True when the section's items carry bullet or number markers (so each item is certain, not guessed from line breaks). */
  bulleted: boolean;
}

/** Most items one section may give (a runaway block is a detection mistake, not a real list). */
export const MAX_ACHIEVEMENT_LINES = 60;

const clean = (s: string): string => s.replace(/[ ​‌‍﻿]/g, " ").replace(/[ \t]+/g, " ").trim();

const CORE = new Set(["achievement", "achievements", "accomplishment", "accomplishments", "award", "awards", "honour", "honours", "honor", "honors", "recognition", "recognitions", "accolade", "accolades"]);
const MODIFIERS = new Set(["key", "major", "notable", "professional", "career", "top", "selected", "significant", "other", "additional", "academic", "special", "personal", "work", "related", "my", "and", "of", "received", "won", "the"]);
const HIGHLIGHT_WORDS = new Set(["highlight", "highlights"]);
const WEAK_WORDS = new Set(["activities", "activity", "extracurricular", "extra-curricular", "extra", "curricular"]);
/** A heading containing one of these is some other section, even if it also says "awards". */
const OTHER = new Set(["certification", "certifications", "certificate", "certificates", "publication", "publications", "patent", "patents", "training", "trainings", "course", "courses", "project", "projects", "responsibilities", "responsibility", "experience", "education", "skills", "summary", "profile", "languages"]);

/** Section names that end an achievements section (compared whole, lower case, without a colon). */
const KNOWN_SECTIONS = new Set([
  "experience", "work experience", "professional experience", "employment", "employment history", "work history", "career history", "career summary",
  "professional summary", "summary", "profile", "professional profile", "objective", "career objective", "education", "academics", "academic",
  "academic qualifications", "educational qualifications", "educational qualification", "qualifications", "qualification", "skills", "technical skills",
  "key skills", "core competencies", "competencies", "technologies", "tools", "tools and technologies", "projects", "project", "project details", "project experience",
  "certifications", "certification", "certificates", "courses", "training", "trainings", "languages", "language", "languages known", "interests", "hobbies",
  "hobbies and interests", "references", "publications", "patents", "volunteer", "volunteering", "volunteer experience", "personal details",
  "personal information", "personal profile", "declaration", "contact", "contact details", "links", "strengths", "responsibilities",
  "roles and responsibilities", "overview", "about me", "about", "domain", "domains", "areas of expertise", "expertise", "specialization",
  "key responsibilities", "technical expertise", "technical proficiency", "internships", "internship", "extracurricular activities",
]);

const BULLET = /^\s*(?:[•●▪■◦‣⁃∙·➢►✓✔★*]|[-–—](?=\s)|o(?=\s)|\(?\d{1,2}[.)](?=\s))\s*/u;
/** "Page 2", "2 of 5" and a bare 1-3 digit number on a line of its own (a page number, never part of an item). */
const PAGE_NOISE = /^(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+\s*(of|\/)\s*\d+|\d{1,3})$/i;

/** The words of a heading line, lower case, "&" as "and", decoration and a trailing colon removed; null when it is not heading-shaped. */
function headingWords(line: string): { text: string; words: string[] } | null {
  let t = clean(line);
  // a line that starts with a bullet symbol is an item, never a heading ("5. Awards" numbering is allowed)
  if (!t || /^[•●▪■◦‣⁃∙·➢►*]/.test(t) || /^[-–—]\s/.test(t) || /^o\s/.test(t)) return null;
  t = t.replace(/^\d{1,2}[.)]\s+(?=[A-Za-z])/, ""); // "5. Awards"
  t = t.replace(/[_=*#~|—–-]{2,}/g, " "); // "=== AWARDS ==="
  t = clean(t).replace(/^[:;\s]+|[:;\s]+$/g, "");
  if (!t || t.length > 50 || /[.!?]$/.test(t)) return null; // a sentence is not a heading
  const words = t.toLowerCase().replace(/&/g, " and ").split(/[\s/]+/).map((w) => w.replace(/^[,()]+|[,()]+$/g, "")).filter(Boolean);
  if (words.length === 0 || words.length > 7) return null;
  return { text: t, words };
}

/** A heading must read as a heading: every word capitalised (or ALL CAPS), not the middle of a sentence. */
function capitalised(text: string): boolean {
  const small = new Set(["and", "of", "the", "&", "or", "for", "in", "to"]);
  return text.split(/\s+/).every((w) => small.has(w.toLowerCase()) || /^[^a-z]/.test(w.replace(/^[(,]+/, "")));
}

/** Is this line the heading of an achievements-type section? Which tier, and the heading as written. */
export function classifyHeading(line: string): { tier: AchievementTier; heading: string } | null {
  const h = headingWords(line);
  if (!h || !capitalised(h.text)) return null;
  const { words } = h;
  if (words.some((w) => OTHER.has(w))) return null;
  const core = words.some((w) => CORE.has(w));
  const highlight = words.some((w) => HIGHLIGHT_WORDS.has(w));
  const weak = words.some((w) => WEAK_WORDS.has(w));
  if (core && words.every((w) => CORE.has(w) || MODIFIERS.has(w) || WEAK_WORDS.has(w) || w === ",")) return { tier: weak ? 2 : 1, heading: h.text };
  if (highlight && !core && words.every((w) => HIGHLIGHT_WORDS.has(w) || MODIFIERS.has(w))) return { tier: 2, heading: h.text };
  return null;
}

/** Does this line start another section (so an achievements section ends before it)? */
function isSectionHeading(line: string): boolean {
  const h = headingWords(line);
  if (!h) return false;
  return KNOWN_SECTIONS.has(h.words.join(" ").replace(/,/g, ""));
}

const isBulleted = (line: string): boolean => BULLET.test(line) && clean(line.replace(BULLET, "")) !== "";
const stripBullet = (line: string): string => clean(line.replace(BULLET, ""));

/** Splits the lines of one section into items. Bulleted: one item per bullet, wrapped lines joined. Plain: one per line. */
export function splitItems(lines: string[]): { items: string[]; bulleted: boolean } {
  const body = lines.map(clean).filter((l) => l !== "" && !PAGE_NOISE.test(l));
  const bulleted = body.filter(isBulleted).length >= 2 || (body.length > 0 && body.every(isBulleted));
  const items: string[] = [];
  if (bulleted) {
    for (const line of body) {
      if (isBulleted(line)) items.push(stripBullet(line));
      else if (items.length > 0) items[items.length - 1] = clean(`${items[items.length - 1]} ${line}`); // a wrapped line
      else if (!line.endsWith(":")) items.push(line); // before the first bullet; an intro ending in ":" is not an item
    }
  } else {
    for (const line of body) {
      const prev = items[items.length - 1];
      const continues = prev !== undefined && (/^[a-z(]/.test(line) || /[,\-–(&]$/.test(prev) || /\b(and|or|of|for|to|the|at|in|by|with)$/i.test(prev));
      if (continues) items[items.length - 1] = clean(`${prev} ${line}`);
      else items.push(line);
    }
  }
  return { items: items.filter((i) => i.length >= 3 && !/^[\d\s.,/-]+$/.test(i)), bulleted };
}

/**
 * Every achievements-type section of the resume, in order. A section runs from its heading to the next known section
 * heading, the next achievements-type heading, a "---" column marker or the end. Dedicated sections only: achievements
 * written inside a job's own bullets are not taken.
 */
export function findAchievementSections(text: string): AchievementSection[] {
  const lines = text.split(/\r?\n/);
  const out: AchievementSection[] = [];
  for (let i = 0; i < lines.length; i++) {
    const found = classifyHeading(lines[i]);
    if (!found) continue;
    const block: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = clean(lines[j]);
      if (t === "") continue;
      if (/^-{3,}/.test(t) || isSectionHeading(t) || classifyHeading(t)) break;
      block.push(t);
      if (block.length >= MAX_ACHIEVEMENT_LINES) break;
    }
    const { items, bulleted } = splitItems(block);
    if (items.length > 0) out.push({ heading: found.heading, tier: found.tier, items, bulleted });
    i = j - 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- comparing items

/** Lower case, letters and digits only, single spaces: two spellings of the same line compare equal. */
export const itemKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const wordSet = (key: string): Set<string> => new Set(key.split(" ").filter((w) => w.length > 1));

/** How alike two lines are, 0 to 1: the share of their words they have in common. */
export function itemSimilarity(a: string, b: string): number {
  const sa = wordSet(itemKey(a));
  const sb = wordSet(itemKey(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  return shared / (sa.size + sb.size - shared);
}

const numbersOf = (key: string): string[] => [...new Set(key.match(/\d+/g) ?? [])].sort();

/**
 * Are these two lines the same achievement (same text, one inside the other, or nearly the same words)? Numbers decide:
 * the same award in 2021 and in 2022 are two achievements, however alike the words are.
 */
export function sameItem(a: string, b: string): boolean {
  const ka = itemKey(a);
  const kb = itemKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const na = numbersOf(ka);
  const nb = numbersOf(kb);
  if (na.length > 0 && nb.length > 0 && na.join(" ") !== nb.join(" ")) return false;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short.length >= 12 && long.includes(short) && short.length / long.length >= 0.6) return true;
  return itemSimilarity(a, b) >= 0.75;
}

/** Is the item (loosely) in the source text: as a phrase, or nearly all of its words on one line? */
export function itemInSource(item: string, sourceText: string): boolean {
  const key = itemKey(item);
  if (!key) return true;
  if (itemKey(sourceText).includes(key)) return true;
  return sourceText.split(/\r?\n/).some((line) => sameItem(item, line));
}

/** The block handed to the model: each section's exact heading and its items, one per line. */
export function describeAchievementSections(sections: AchievementSection[]): string {
  return sections.map((s) => `Section headed "${s.heading}" (${s.items.length} items):\n${s.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
}
