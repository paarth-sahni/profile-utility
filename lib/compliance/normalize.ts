/**
 * Purpose: the ONE way a name is turned into a matching identity, used both when the registry is built from the Google
 * Sheet and when profile text is scanned, so the two always agree. Pure (no server or browser imports).
 *
 * Rules: Unicode NFKC, lower case, accents removed, "&" read as "and", everything that is not a letter or digit is a
 * separator. A name is the list of its tokens; matching works on whole tokens only, so "Acme" never matches "Acmeville".
 * No fuzzy matching and no legal-suffix stripping here: "Acme Ltd" and "Acme Limited" stay different identities.
 */

export type Token = {
  /** Normalised token ("acme", "and"). */
  value: string;
  /** Offsets of the token in the ORIGINAL text (end exclusive), used to highlight what the user typed. */
  start: number;
  end: number;
};

const normalizeToken = (raw: string): string =>
  raw.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Splits text into normalised tokens with their positions in the original text. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+|&/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const value = m[0] === "&" ? "and" : normalizeToken(m[0]);
    if (value) tokens.push({ value, start, end: start + m[0].length });
  }
  return tokens;
}

/** The matching identity of a name: its tokens joined by single spaces ("" when there is nothing usable). */
export function normalizeName(name: string): string {
  return tokenize(name)
    .map((t) => t.value)
    .join(" ");
}

/** Normalised form of a spreadsheet header cell: lower case, letters and digits only ("New Client Name" -> "newclientname"). */
export function normalizeHeader(cell: unknown): string {
  if (typeof cell !== "string") return "";
  return normalizeToken(cell).replace(/[^\p{L}\p{N}]+/gu, "");
}
