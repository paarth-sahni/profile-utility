/**
 * Purpose: fixes candidate names that arrive in ALL CAPS (common in resumes): "PAARTH SAHNI" -> "Paarth Sahni".
 * Only words written entirely in capitals are changed, so names that are already in normal case are left alone.
 * Pure; unit-tested (lib/nameCase.test.ts).
 */

/** Small name particles that stay lower-case in the middle of a name ("Ludwig van Beethoven"). */
const PARTICLES = new Set(["de", "da", "di", "du", "van", "von", "der", "bin", "al", "el", "la", "le"]);
const ROMAN = /^(II|III|IV|VI|VII|VIII|IX)$/;

const hasLower = (s: string) => /\p{Ll}/u.test(s);
const hasLetter = (s: string) => /\p{L}/u.test(s);

/** Upper-cases the first letter of each hyphen / apostrophe separated piece ("O'NEIL" -> "O'Neil"). */
function capitalisePieces(lowerWord: string): string {
  return lowerWord
    .split(/([-'’])/)
    .map((piece) => (/^[-'’]$/.test(piece) || piece === "" ? piece : piece[0].toUpperCase() + piece.slice(1)))
    .join("");
}

/** Returns the name in normal case when words are ALL CAPS; mixed-case words are never touched. */
export function toNameCase(name: string): string {
  let first = true;
  return name.replace(/\S+/gu, (word) => {
    const isFirst = first;
    first = false;
    if (!hasLetter(word) || hasLower(word)) return word; // numbers/punctuation, or already mixed case
    const letters = word.replace(/[^\p{L}]/gu, "");
    if (letters.length <= 1) return word; // single initial: "A"
    if (/^(\p{Lu}\.)+\p{Lu}?\.?$/u.test(word)) return word; // dotted initials: "A.K."
    if (ROMAN.test(letters)) return word; // "III"
    const lower = word.toLowerCase();
    if (!isFirst && PARTICLES.has(lower)) return lower;
    const cased = capitalisePieces(lower);
    return cased.replace(/^(Mc)([a-z])/, (_m, mc: string, c: string) => mc + c.toUpperCase());
  });
}
