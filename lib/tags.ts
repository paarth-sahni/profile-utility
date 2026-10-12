/**
 * Purpose: pure helpers behind the tag input (short lists such as tools, domains, languages).
 * Typed or pasted text is split into items on commas and line breaks, but never inside brackets, so
 * "AWS (S3, EC2), Docker" is two items, not three. Unit-tested (lib/tags.test.ts). No React or DOM.
 */

/** Splits text into trimmed, non-empty items on commas / newlines that are outside (), [] and {}. */
export function splitTags(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;
    if ((ch === "," || ch === "\n" || ch === "\r") && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Appends the items found in `text` to `existing`, skipping blanks and case-insensitive duplicates. */
export function addTags(existing: string[], text: string): string[] {
  const clean = existing.map((t) => t.trim()).filter(Boolean);
  const seen = new Set(clean.map((t) => t.toLowerCase()));
  const out = [...clean];
  for (const t of splitTags(text)) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** True while the text has more "(" / "[" / "{" than closing brackets, i.e. a comma now would be inside a bracket. */
export function hasOpenBracket(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;
  }
  return depth > 0;
}
