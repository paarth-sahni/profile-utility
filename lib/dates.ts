/**
 * Purpose: one date format in every profile: "MMM YYYY" ("Feb 2020"), ranges "Feb 2020 – Jun 2020", and "Present" /
 * "Current" kept for an ongoing period. Resumes write dates every way ("June-2020", "06/2020", "2020-06", "Jan'19");
 * normalizeDuration() rewrites what it can read without guessing and reports the rest, which the extraction backstop
 * flags for the person (lib/backstops.ts). Pure, no dependencies.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAME = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const ORDINAL = "\\d{1,2}(?:st|nd|rd|th)?";

/** One date, every form we accept. Each alternative has its own named groups (read in parseDate). */
const DATE = [
  `(?:${ORDINAL}\\s+)?(?<m1>${MONTH_NAME})\\.?(?:\\s+${ORDINAL})?[\\s,\\-/]*(?<y1>\\d{4})`, // June 2020, June-2020, Jun. 2020, 5 June 2020, June 5, 2020
  `(?<m2>${MONTH_NAME})\\.?\\s*['’‘]\\s*(?<y2>\\d{2})`, // Jan'19, Jan ’19
  `(?<n3>\\d{1,2})[/\\-.](?<y3>\\d{4})`, // 06/2020, 6-2020, 06.2020
  `(?<y4>\\d{4})[/\\-.](?<n4>\\d{1,2})(?:[/\\-.]\\d{1,2})?`, // 2020-06, 2020/06, 2020-06-15
  `(?<a5>\\d{1,2})[/\\-.](?<b5>\\d{1,2})[/\\-.](?<y5>\\d{4})`, // 15/06/2020 (day and month told apart only when one is above 12)
].join("|");

/** An ongoing end: kept as "Present" or "Current". */
const ONGOING = "present|current|currently|till\\s+date|till\\s+now|to\\s+date|until\\s+now|now|ongoing|today";
const SEPARATOR = "\\s*(?:[-‐‑‒–—―~]|\\bto\\b|\\btill\\b|\\buntil\\b|\\bthrough\\b)\\s*";

const SINGLE = new RegExp(`^(?:${DATE})$`, "i");
// the same date pattern without group names (a name may appear only once in a regex); each side is re-read by parseDate
const ANY_DATE = DATE.replace(/\?<\w+>/g, "");
const RANGE = new RegExp(`^(?<from>${ANY_DATE})${SEPARATOR}(?<to>${ANY_DATE}|${ONGOING})$`, "i");
const ONGOING_ONLY = new RegExp(`^(?:${ONGOING})$`, "i");

const year = (y: string): number | null => {
  const n = Number(y);
  return n >= 1950 && n <= 2100 ? n : null;
};

/** "MMM YYYY" for one date, or null when it cannot be read without guessing. */
export function parseDate(text: string): string | null {
  const m = SINGLE.exec(text.trim().replace(/\s+/g, " "));
  if (!m?.groups) return null;
  const g = m.groups;
  let month: number | null = null;
  let y: number | null = null;
  if (g.m1 || g.m2) {
    const name = (g.m1 ?? g.m2).slice(0, 3).toLowerCase();
    month = MONTHS.findIndex((x) => x.toLowerCase() === name) + 1;
    if (g.y1) y = year(g.y1);
    else {
      // a two-digit year after an apostrophe: '19 is 2019, '98 is 1998
      const two = Number(g.y2);
      y = two <= (new Date().getFullYear() % 100) + 1 ? 2000 + two : 1900 + two;
    }
  } else if (g.y3) {
    month = Number(g.n3);
    y = year(g.y3);
  } else if (g.y4) {
    month = Number(g.n4);
    y = year(g.y4);
  } else if (g.y5) {
    const a = Number(g.a5);
    const b = Number(g.b5);
    if (a > 12 && b <= 12) month = b; // 15/06/2020: day first
    else if (b > 12 && a <= 12) month = a; // 06/15/2020: month first
    else if (a === b) month = a;
    else return null; // 03/04/2020: March or April? not guessed
    y = year(g.y5);
  }
  if (!month || month < 1 || month > 12 || !y) return null;
  return `${MONTHS[month - 1]} ${y}`;
}

/** "Present" / "Current" as written (title case); every other ongoing word ("till date", "now") becomes "Present". */
function ongoing(text: string): string {
  const t = text.trim().toLowerCase();
  if (t === "current" || t === "currently") return "Current";
  return "Present";
}

export interface NormalizedDuration {
  /** The normalised text, or the input unchanged when it could not be read. */
  value: string;
  /** False when the input has a date that could not be read without guessing (flag it for the person). */
  ok: boolean;
}

/**
 * Normalises a duration: one date ("Feb 2020") or a range ("Feb 2020 – Jun 2020", "Feb 2020 – Present"). Empty input
 * stays empty and is ok. Anything it cannot read (a year without a month, "Q3 2020", "03/04/2020") is returned
 * unchanged with ok = false; nothing is guessed.
 */
export function normalizeDuration(input: string): NormalizedDuration {
  // "till date" / "to date": the word before "date" is the range separator too, so it is rewritten first
  const text = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*(?:[-‐‑‒–—―~]\s*)?\b(?:till|to|until)\s+(?:date|now)$/i, " - present");
  if (!text) return { value: "", ok: true };
  const single = parseDate(text);
  if (single) return { value: single, ok: true };
  const range = RANGE.exec(text);
  if (range?.groups) {
    const from = parseDate(range.groups.from);
    const toText = range.groups.to;
    const to = ONGOING_ONLY.test(toText.trim()) ? ongoing(toText) : parseDate(toText);
    if (from && to) return { value: `${from} – ${to}`, ok: true };
  }
  return { value: input.trim(), ok: false };
}
