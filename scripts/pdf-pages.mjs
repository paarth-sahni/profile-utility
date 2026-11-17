/**
 * Purpose: the page-break rules of both templates, checked on the measured PDF (scripts/pdf-measure.mjs):
 *   - no section heading, "Project N" heading, project name or field label is the last line of its column on a page
 *     (a project starts with its heading, name and at least its first field on one page);
 *   - no bullet runs across a page break;
 *   - a project description of up to 6 lines never runs across a page break; a longer one keeps at least 2 lines on
 *     each side of it;
 *   - internal: no sidebar item runs across a page break: a skill name with its rating, a certification, the tool line,
 *     a managerial item, a domain, a language;
 *   - external: an employer's company, position and dates are never the last line of a page (they stay with the first
 *     highlight);
 *   - no page but the last is mostly empty (its text ends in the top half);
 *   - on every page after the first, the first line of each column starts at the normal top: no gap (a blank line, a
 *     heading's space before) carried over from the page before (within 1pt; the top of the line's box, from its baseline
 *     and its style).
 * Returns a list of problems (empty: all good). Used by test-render.mjs (--pdf). Run on its own (no profile data, so
 * without the checks that need it): node scripts/pdf-pages.mjs file.pdf [internal|external]
 */
import { measurePdf } from "./pdf-measure.mjs";

const SECTION_HEADINGS = {
  internal: ["Overview", "Education & Training", "Projects", "Skills", "Certifications", "Tools", "Managerial Experience", "Domain", "Languages"],
  external: ["Overview", "Education & Training", "Skills", "Tools", "Certifications", "Projects/Experience", "Experience", "Achievements"],
};
const FIELD_LABELS = { internal: ["Tools & Technologies", "Team Size", "Role", "Project Link"], external: ["Team Size", "Role"] };
const SIDEBAR_X = 400;
const squash = (t) => t.replace(/\s+/g, "");

/** Lines per page and column ({ main: [...], side: [...] }, top to bottom), the footer left out. External: one column. */
export function columnLines(pages, template = "internal") {
  return pages.map((p) => {
    const foot = p.images.find((im) => im.y > p.height / 2); // the footer logo: everything level with it or lower is footer
    const footTop = foot ? foot.y - 1 : p.height - 60;
    const cols = { main: [], side: [] };
    for (const r of [...p.runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
      if (r.baseline >= footTop) continue;
      const lines = cols[template === "internal" && r.x >= SIDEBAR_X ? "side" : "main"];
      const line = lines.find((l) => Math.abs(l.baseline - r.baseline) < 0.5);
      if (line) line.runs.push(r);
      else lines.push({ baseline: r.baseline, runs: [r] });
    }
    for (const lines of Object.values(cols)) {
      for (const l of lines) {
        l.runs.sort((a, b) => a.x - b.x);
        l.x = l.runs[0].x;
        l.text = l.runs.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
        const word = l.runs.find((r) => r.text.trim() !== "•") ?? l.runs[0];
        l.font = word.font;
        l.size = word.size;
      }
      lines.sort((a, b) => a.baseline - b.baseline);
    }
    return cols;
  });
}

// Where the first line of a column starts on a continued page (pt from the page top): the top margin (0.4in), internal plus
// the table cell's top margin (7.2pt). From a line's baseline to the top of its box, by its style (scripts/patch-templates.py):
// a bullet or sidebar item (auto 1.15 lines: the baseline at the font's ascent, 1 em), a section heading or field label (an
// exact 15pt line: 80%), body text, a project heading or an employer (an exact 17.25pt line: 80%).
const CONTINUED_TOP = { internal: 36.0, external: 28.8 };
function boxTop(l, col, labels) {
  if (l.font === "Lexend-Light" && Math.abs(l.size - 10) < 0.05) return l.baseline - 0.8 * 15;
  if (l.text.startsWith("•") || col === "side") return l.baseline - l.size;
  if (l.font === "Lexend-Regular" && labels.includes(l.text)) return l.baseline - 0.8 * 15;
  return l.baseline - 0.8 * 17.25;
}

const real = (v) => typeof v === "string" && v.trim() !== "" && !/^n\/?a$/i.test(v.trim());
const isBullet = (l) => l.text.startsWith("•");

/** The sidebar items as they are printed: "<skill> (<rating>/5)", each list item, the tools as one line. */
function sidebarItems(data) {
  const real = (v) => typeof v === "string" && v.trim() && !/^n\/?a$/i.test(v.trim());
  const list = (v) => (v ?? []).filter(real).map((t) => t.trim());
  return [
    ...(data.skills ?? []).filter((s) => real(s.name)).map((s) => `${s.name.trim()} (${s.rating}/5)`),
    ...list(data.certifications), ...list(data.managerialExperience), ...list(data.domains), ...list(data.languages),
    ...(list(data.tools).length ? [list(data.tools).join(", ")] : []),
  ].map(squash);
}

/** The lines of a description (main column, in order across pages), or null when it is not found in one run. */
function descriptionLines(lines, text) {
  const want = squash(text);
  for (let i = 0; i < lines.length; i++) {
    const first = squash(lines[i].text);
    if (!first || !want.startsWith(first)) continue;
    let got = first;
    let k = i;
    while (got.length < want.length && k + 1 < lines.length && want.startsWith(got + squash(lines[k + 1].text))) got += squash(lines[++k].text);
    if (got === want) return lines.slice(i, k + 1);
  }
  return null;
}

/** How many lines each project description takes in the PDF ({ text, lines }), for the ones found in it. */
export function descriptionLineCounts(pages, data, template = "internal") {
  const main = columnLines(pages, template).flatMap((c, page) => c.main.map((l) => ({ ...l, page })));
  return (data?.projects ?? []).filter((p) => real(p.description)).flatMap((p) => {
    const lines = descriptionLines(main, p.description);
    return lines ? [{ text: p.description, lines: lines.length }] : [];
  });
}

/**
 * Problems with the page breaks of a PDF (pages from measurePdf; data: the profile, for the descriptions, sidebar items and
 * employers; template: "internal" (two columns) or "external" (one column)).
 */
export function pageBreakProblems(pages, data, template = "internal") {
  const problems = [];
  const cols = columnLines(pages, template);
  // an external profile's custom sections print their own title as a heading
  const customTitles = template === "external" ? (data?.customSections ?? []).map((s) => (s.title ?? "").trim()).filter(Boolean) : [];
  const isHeading = (l) => (SECTION_HEADINGS[template].includes(l.text) || customTitles.includes(l.text)) && l.font === "Lexend-Light" && Math.abs(l.size - 10) < 0.05;
  const isProjectHeading = (l) => /^Project \d+\b/.test(l.text) && l.font === "Lexend-Regular";
  // an external profile's custom sections print their fields' labels like the Team Size / Role labels
  const customLabels = template === "external" ? (data?.customSections ?? []).flatMap((s) => (s.fields ?? []).map((f) => (f.label ?? "").trim())).filter(Boolean) : [];
  const labels = [...FIELD_LABELS[template], ...customLabels];
  const isLabel = (l) => labels.includes(l.text) && l.font === "Lexend-Regular";
  // an employer's header lines, in order: company, position, dates (only the ones printed)
  // (an employer with no highlight has nothing to stay with: its header is its last line, so it may end a page)
  const employers = template === "external" && data ? (data.experience ?? []).filter((x) => (x.highlights ?? []).some(real)).map((x) => [x.company, x.position, x.duration].filter(real).map(squash)).filter((h) => h.length) : [];
  /** True when the page's main column ends with the first m+1 header lines of an employer (no highlight after them). */
  const endsWithEmployer = (main) =>
    employers.some((h) => h.some((_, m) => main.length > m && h.slice(0, m + 1).every((line, j) => squash(main[main.length - 1 - m + j].text) === line)));
  const last = cols.length - 1;
  cols.forEach(({ main, side }, n) => {
    const page = `page ${n + 1}`;
    if (n < last) {
      // the last line of each column: never a heading, project heading, project name or field label
      const end = main.at(-1);
      if (end) {
        if (isHeading(end)) problems.push(`${page}: section heading "${end.text}" is the last line of the page`);
        if (isProjectHeading(end)) problems.push(`${page}: project heading "${end.text}" is the last line of the page`);
        if (main.length > 1 && isProjectHeading(main.at(-2))) problems.push(`${page}: project name "${end.text}" (after "${main.at(-2).text}") is the last line of the page`);
        if (isLabel(end)) problems.push(`${page}: field label "${end.text}" is the last line of the page`);
        if (endsWithEmployer(main)) problems.push(`${page}: employer line "${end.text}" is the last line of the page (it stays with the first highlight)`);
      }
      const sideEnd = side.at(-1);
      if (sideEnd && isHeading(sideEnd)) problems.push(`${page}: sidebar heading "${sideEnd.text}" is the last line of the page`);
      // mostly empty: both columns end in the top half of the body
      const top = Math.min(...cols.flatMap((c) => [...c.main, ...c.side].map((l) => l.baseline)));
      const bottom = Math.max(...cols.flatMap((c) => [...c.main, ...c.side].map((l) => l.baseline)));
      const lowest = Math.max(...[...main, ...side].map((l) => l.baseline));
      if (lowest < (top + bottom) / 2) problems.push(`${page}: mostly empty (its text ends at ${lowest.toFixed(1)}pt, the page's body runs to ${bottom.toFixed(1)}pt)`);
    }
    // the first line of each column on a continued page starts at the normal top (no gap carried over)
    if (n > 0) {
      for (const [col, lines] of [["main", main], ["side", side]]) {
        if (!lines[0]) continue;
        const top = boxTop(lines[0], col, labels);
        if (Math.abs(top - CONTINUED_TOP[template]) > 1) problems.push(`${page}: the ${col === "main" ? "main column" : "sidebar"} starts at ${top.toFixed(1)}pt, not at the top (${CONTINUED_TOP[template]}pt): "${lines[0].text.slice(0, 40)}"`);
      }
    }
    // a bullet continued from the previous page: the first line sits at the bullet's text indent, without a bullet
    if (n > 0 && main[0] && !isBullet(main[0])) {
      const indent = cols.flatMap((c) => c.main.filter(isBullet).map((l) => l.runs.find((r) => r.text.trim() !== "•")?.x)).find((x) => x !== undefined);
      if (indent !== undefined && Math.abs(main[0].x - indent) < 1) problems.push(`${page}: "${main[0].text}" continues a bullet from page ${n}`);
    }
  });
  // descriptions: up to 6 lines never split; longer ones keep at least 2 lines on each side of a page break
  if (data) {
    const main = cols.flatMap((c, page) => c.main.map((l) => ({ ...l, page })));
    for (const p of data.projects ?? []) {
      if (!real(p.description)) continue;
      const lines = descriptionLines(main, p.description);
      if (!lines) {
        problems.push(`description "${p.description.slice(0, 40)}..." not found in the PDF`);
        continue;
      }
      const pagesOf = [...new Set(lines.map((l) => l.page))];
      if (pagesOf.length === 1) continue;
      const before = lines.filter((l) => l.page === pagesOf[0]).length;
      const after = lines.filter((l) => l.page === pagesOf.at(-1)).length;
      const where = `description "${p.description.slice(0, 40)}..." (${lines.length} lines)`;
      if (lines.length <= 6) problems.push(`${where} is split across pages ${pagesOf[0] + 1} and ${pagesOf.at(-1) + 1} (${before} + ${after} lines)`);
      else if (before < 2 || after < 2) problems.push(`${where} leaves ${before < 2 ? `${before} line on page ${pagesOf[0] + 1}` : `${after} line on page ${pagesOf.at(-1) + 1}`}`);
    }
  }
  // sidebar items: group the sidebar lines (all pages, in order) into the expected items; every item on one page
  if (data && template === "internal") {
    const items = sidebarItems(data);
    const lines = cols.flatMap((c, page) => c.side.map((l) => ({ ...l, page }))).filter((l) => l.text !== "A PROUD MEMBER OF" && !isHeading(l));
    for (let i = 0; i < lines.length; ) {
      let k = i;
      let text = squash(lines[i].text);
      while (!items.includes(text) && k + 1 < lines.length && items.some((it) => it.startsWith(text + squash(lines[k + 1].text)))) text += squash(lines[++k].text);
      if (!items.includes(text)) problems.push(`sidebar: "${lines[i].text}" (page ${lines[i].page + 1}) is not the start of a known item`);
      else if (lines[k].page !== lines[i].page) problems.push(`sidebar: "${lines.slice(i, k + 1).map((l) => l.text).join(" / ")}" is split across pages ${lines[i].page + 1} and ${lines[k].page + 1}`);
      i = k + 1;
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const [file, template = "internal"] = process.argv.slice(2);
  const problems = pageBreakProblems(await measurePdf(file), null, template);
  console.log(`${file}: ${problems.length ? problems.join("\n  ") : "ok"}`);
}
