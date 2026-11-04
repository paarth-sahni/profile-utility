/**
 * Purpose: the page-break rules of the internal template, checked on the measured PDF (scripts/pdf-measure.mjs):
 *   - no section heading, "Project N" heading, project name or field label is the last line of its column on a page
 *     (a project starts with its heading, name and at least its first field on one page);
 *   - no bullet runs across a page break (a description may);
 *   - no sidebar item runs across a page break: a skill name with its rating, a certification, the tool line, a
 *     managerial item, a domain, a language;
 *   - no page but the last is mostly empty (both columns end in the top half).
 * Returns a list of problems (empty: all good). Used by test-render.mjs (--pdf). Run on its own (no profile data, so
 * without the sidebar item check): node scripts/pdf-pages.mjs file.pdf
 */
import { measurePdf } from "./pdf-measure.mjs";

const SECTION_HEADINGS = ["Overview", "Education & Training", "Projects", "Skills", "Certifications", "Tools", "Managerial Experience", "Domain", "Languages"];
const FIELD_LABELS = ["Tools & Technologies", "Team Size", "Role", "Project Link"];
const SIDEBAR_X = 400;
const squash = (t) => t.replace(/\s+/g, "");

/** Lines per page and column ({ main: [...], side: [...] }, top to bottom), the footer left out. */
export function columnLines(pages) {
  return pages.map((p) => {
    const foot = p.images.find((im) => im.y > p.height / 2); // the footer logo: everything level with it or lower is footer
    const footTop = foot ? foot.y - 1 : p.height - 60;
    const cols = { main: [], side: [] };
    for (const r of [...p.runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
      if (r.baseline >= footTop) continue;
      const lines = cols[r.x >= SIDEBAR_X ? "side" : "main"];
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

const isHeading = (l) => SECTION_HEADINGS.includes(l.text) && l.font === "Lexend-Light" && Math.abs(l.size - 10) < 0.05;
const isProjectHeading = (l) => /^Project \d+\b/.test(l.text) && l.font === "Lexend-Regular";
const isLabel = (l) => FIELD_LABELS.includes(l.text) && l.font === "Lexend-Regular";
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

/** Problems with the page breaks of an internal PDF (pages from measurePdf; data: the profile, for the sidebar items). */
export function pageBreakProblems(pages, data) {
  const problems = [];
  const cols = columnLines(pages);
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
      }
      const sideEnd = side.at(-1);
      if (sideEnd && isHeading(sideEnd)) problems.push(`${page}: sidebar heading "${sideEnd.text}" is the last line of the page`);
      // mostly empty: both columns end in the top half of the body
      const top = Math.min(...cols.flatMap((c) => [...c.main, ...c.side].map((l) => l.baseline)));
      const bottom = Math.max(...cols.flatMap((c) => [...c.main, ...c.side].map((l) => l.baseline)));
      const lowest = Math.max(...[...main, ...side].map((l) => l.baseline));
      if (lowest < (top + bottom) / 2) problems.push(`${page}: mostly empty (its text ends at ${lowest.toFixed(1)}pt, the page's body runs to ${bottom.toFixed(1)}pt)`);
    }
    // a bullet continued from the previous page: the first line sits at the bullet's text indent, without a bullet
    if (n > 0 && main[0] && !isBullet(main[0])) {
      const indent = cols.flatMap((c) => c.main.filter(isBullet).map((l) => l.runs.find((r) => r.text.trim() !== "•")?.x)).find((x) => x !== undefined);
      if (indent !== undefined && Math.abs(main[0].x - indent) < 1) problems.push(`${page}: "${main[0].text}" continues a bullet from page ${n}`);
    }
  });
  // sidebar items: group the sidebar lines (all pages, in order) into the expected items; every item on one page
  if (data) {
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
  for (const file of process.argv.slice(2)) {
    const problems = pageBreakProblems(await measurePdf(file));
    console.log(`${file}: ${problems.length ? problems.join("\n  ") : "ok"}`);
  }
}
