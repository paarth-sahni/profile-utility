/**
 * Purpose: display-only helpers for the Preview step. docx-preview draws a floating (anchored) picture inline, so the
 * InfoBeans logo, which the templates anchor at the top right of the header block, would appear under the name. These
 * helpers read the anchor positions from the DOCX's word/document.xml and place the rendered pictures there. They only
 * touch the browser's copy of the rendered pages; the DOCX itself (and the file that is downloaded) is never changed.
 * `parseAnchors` is pure and unit-tested (lib/docxAnchors.test.ts); `applyAnchors` needs the DOM.
 */

/** Where one picture of the document body is anchored (EMU = 1/9525 px), or null when it is a plain inline picture. */
export interface PictureAnchor {
  /** Offset from the left edge of the column (the containing table cell or text column). */
  leftEmu: number;
  /** Offset from the top of the paragraph that holds the picture. */
  topEmu: number;
}

const EMU_PER_PX = 9525;

/**
 * One entry per picture in `word/document.xml`, in document order: its anchor when it floats at an offset measured from
 * the column (horizontally) and the paragraph (vertically), otherwise null. Other anchoring (page, margin, alignment) is
 * left to docx-preview.
 */
export function parseAnchors(documentXml: string): (PictureAnchor | null)[] {
  const out: (PictureAnchor | null)[] = [];
  for (const m of documentXml.matchAll(/<w:drawing>([\s\S]*?)<\/w:drawing>/g)) {
    const d = m[1];
    if (!/<pic:pic[\s>]/.test(d)) continue; // not a picture
    const anchored = /<wp:anchor[\s>]/.test(d) && !/<wp:simplePos[^>]*x="[1-9]/.test(d);
    const h = /<wp:positionH relativeFrom="column"[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(d);
    const v = /<wp:positionV relativeFrom="paragraph"[^>]*>\s*<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(d);
    const floating = /<wp:wrap(Square|Tight|Through|None)[\s>/]/.test(d);
    out.push(anchored && floating && h && v ? { leftEmu: Number(h[1]), topEmu: Number(v[1]) } : null);
  }
  return out;
}

/** CSS that stops the browser from splitting words with hyphens (Word and Google Docs do not hyphenate these documents). */
export const NO_HYPHENS_CSS = ".docx-wrapper, .docx-wrapper * { hyphens: manual !important; -webkit-hyphens: manual !important; }";

/**
 * Moves each anchored picture rendered under `host` to its anchored position: absolutely positioned inside its
 * paragraph (and strips the padding spaces that reserved room for it). `anchors` comes from parseAnchors, in the same order as the rendered body pictures; if the counts differ
 * nothing is moved (the preview then simply shows docx-preview's own placement).
 */
export function applyAnchors(host: HTMLElement, anchors: (PictureAnchor | null)[]): void {
  const imgs = [...host.querySelectorAll<HTMLImageElement>("section.docx > article img")];
  if (imgs.length !== anchors.length) return;
  imgs.forEach((img, i) => {
    const a = anchors[i];
    const drawing = img.parentElement;
    const paragraph = img.closest("p");
    if (!a || !drawing || !paragraph) return;
    // The template pads the name line with spaces to make room for the floating logo. Now the logo is out of the line,
    // so that padding would only force the name onto a second, stretched (justified) line: drop runs of 3+ trailing spaces.
    const texts = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let n = texts.nextNode(); n; n = texts.nextNode()) n.nodeValue = (n.nodeValue ?? "").replace(/ {3,}$/, "");
    paragraph.style.position = "relative";
    drawing.style.position = "absolute";
    drawing.style.left = `${a.leftEmu / EMU_PER_PX}px`;
    drawing.style.top = `${a.topEmu / EMU_PER_PX}px`;
  });
}
