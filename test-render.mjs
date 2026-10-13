/**
 * Purpose: renders the REAL Word templates (public/templates/{internal,external}.docx) with the REAL prepareData
 * (lib/docxData.ts) and checks the optional-section behaviour:
 *   - every optional section / field is present when filled and COMPLETELY gone (heading, content, spacer) when it is
 *     empty, blank or "N/A"; required sections never disappear;
 *   - with every optional section empty only the required content is left;
 *   - no {tag} is left over, none is split across Word runs, nothing renders as "undefined".
 * Run: npm run test:render   (it uses tsx so it can import the TypeScript module). Add --pdf to also convert full,
 * all-optional-empty, sparse and mixed renders into /tmp/render-check/ exactly as Download PDF does (lib/pdfRender.ts,
 * LibreOffice), check their text and geometry, and look at them.
 */
import fs from "node:fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { prepareData } from "./lib/docxData.ts";
import { convertDocxToPdf, withoutEmbeddedFonts } from "./lib/pdfRender.ts";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------------------------- sample profiles
// Marker words (UPPER-CASE) make each piece of content easy to find and cannot collide with a heading.
const internal = {
  name: "NAME-MARK Jane Doe",
  jobTitle: "JOBTITLE-MARK",
  experienceSummary: "EXPSUM-MARK 8+ years",
  specialization: "SPEC-MARK Cloud",
  overview: "OVERVIEW-MARK engineer.",
  education: [{ year: "2015", qualification: "EDU-MARK M.Tech" }],
  projects: [
    { duration: "Jan 2023 - Dec 2023", title: "Payments Platform", toolsAndTechnologies: ["Go", "Postgres"], teamSize: "6", role: "ROLE-MARK Lead", projectLink: "NDA", description: "DESC-MARK payments.", responsibilities: ["RESP-MARK one", "RESP-MARK two"] },
    { duration: "Feb 2022 - Nov 2022", title: "Analytics Hub", toolsAndTechnologies: ["Python"], teamSize: "3", role: "ROLE-MARK Dev", projectLink: "https://example.com", description: "DESC-MARK analytics.", responsibilities: ["RESP-MARK three"] },
  ],
  skills: [{ name: "SKILL-MARK Go", rating: "4.5" }, { name: "AWS", rating: "4" }],
  certifications: ["CERT-MARK AWS SA", "CKA"],
  tools: ["TOOL-MARK JIRA", "GIT"],
  managerialExperience: ["MGR-MARK Team Building"],
  domains: ["DOMAIN-MARK Fintech"],
  languages: ["LANG-MARK English", "Hindi"],
};

const external = {
  name: "NAME-MARK Jane Doe",
  jobTitle: "JOBTITLE-MARK",
  experienceSummary: "EXPSUM-MARK 8+ years",
  specialization: "SPEC-MARK Cloud",
  overview: "OVERVIEW-MARK engineer.",
  education: [{ year: "2015", qualification: "EDU-MARK M.Tech" }],
  skills: ["SKILL-MARK AWS", "Go"],
  tools: ["TOOL-MARK JIRA", "GIT"],
  certifications: ["CERT-MARK AWS SA", "CKA"],
  projects: [
    { duration: "Jan 2022 - Dec 2022", client: "Acme Corp", teamSize: "6", role: "ROLE-MARK Lead", description: "DESC-MARK migration.", responsibilities: ["RESP-MARK one", "RESP-MARK two"] },
    { duration: "Mar 2021 - Nov 2021", client: "Globex", teamSize: "4", role: "ROLE-MARK Dev", description: "DESC-MARK pipeline.", responsibilities: ["RESP-MARK three"] },
  ],
  experience: [
    { company: "Accenture", position: "POS-MARK Senior Engineer", duration: "2020 - Present", highlights: ["HIGH-MARK one", "HIGH-MARK two"] },
    { company: "Infosys", position: "POS-MARK Engineer", duration: "2015 - 2020", highlights: ["HIGH-MARK three"] },
  ],
};

// ------------------------------------------------------------------------------------------------- rendering
const templateXml = {};
function render(id, data) {
  const zip = new PizZip(fs.readFileSync(`public/templates/${id}.docx`));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  try {
    doc.render(prepareData(id, data));
  } catch (e) {
    console.error(`${id}: RENDER FAILED`);
    console.error(JSON.stringify(e.properties?.errors?.map((x) => x.properties) ?? e.message, null, 2));
    process.exit(1);
  }
  const xml = doc.getZip().file("word/document.xml").asText();
  const text = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const leftover = text.match(/\{[^}]*\}/g);
  assert(!leftover, `${id}: leftover tags in the output: ${leftover}`);
  assert(!/undefined/.test(text), `${id}: something rendered as "undefined"`);
  assert(!/\bN\/?A\b/i.test(text), `${id}: an "N/A" placeholder reached the document`);
  fs.mkdirSync("/tmp/render-check", { recursive: true });
  const out = doc.getZip().generate({ type: "nodebuffer" });
  return { text, out, zip: doc.getZip() };
}
const textOf = (id, data) => render(id, data).text;

// ------------------------------------------------- 1. static check: no {tag} is split across Word runs
for (const id of ["internal", "external"]) {
  const xml = new PizZip(fs.readFileSync(`public/templates/${id}.docx`)).file("word/document.xml").asText();
  templateXml[id] = xml;
  for (const para of xml.match(/<w:p[ >].*?<\/w:p>/gs) ?? []) {
    const runs = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    for (const t of runs) {
      const open = (t.match(/\{/g) ?? []).length;
      const close = (t.match(/\}/g) ?? []).length;
      assert(open === close, `${id}: a {tag} is split across Word runs near "${t.slice(0, 40)}"`);
    }
  }
}
console.log("templates: no {tag} is split across runs");

// ------------------------------------------------- 2. sections: [name, regex that finds it, how to empty it]
const NA = "N/A";
/** Each optional piece: `found` must match when filled and must NOT match when emptied (blank, [] and "N/A" alike). */
const INTERNAL_SECTIONS = [
  ["experience line", /EXPSUM-MARK/, (d, v) => ({ ...d, experienceSummary: v ?? "" })],
  ["specialization", /SPEC-MARK/, (d, v) => ({ ...d, specialization: v ?? "" })],
  ["projects (heading + all entries)", /\bProjects\b|Payments Platform|Analytics Hub|DESC-MARK/, (d, v) => ({ ...d, projects: v === undefined ? [] : [{ duration: v, title: v, toolsAndTechnologies: [v], teamSize: v, role: v, projectLink: v, description: v, responsibilities: [v] }] })],
  ["certifications", /Certifications|CERT-MARK/, (d, v) => ({ ...d, certifications: v === undefined ? [] : ["", v] })],
  ["tools", /\bTools\b(?! &)|TOOL-MARK/, (d, v) => ({ ...d, tools: v === undefined ? [] : [v] })],
  ["managerial experience", /Managerial Experience|MGR-MARK/, (d, v) => ({ ...d, managerialExperience: v === undefined ? [] : [v, ""] })],
  ["domains", /Domain|DOMAIN-MARK/, (d, v) => ({ ...d, domains: v === undefined ? [] : [v] })],
  ["languages", /Languages|LANG-MARK/, (d, v) => ({ ...d, languages: v === undefined ? [] : [v] })],
];
const INTERNAL_PROJECT_FIELDS = [
  ["project duration", /Jan 2023 - Dec 2023|Feb 2022 - Nov 2022|Project 1 - |Project 2 - /, "duration", ""],
  ["project tools & technologies", /Tools & Technologies/, "toolsAndTechnologies", []],
  ["project team size", /Team Size/, "teamSize", ""],
  ["project role", /\bRole\b|ROLE-MARK/, "role", ""],
  ["project link", /Project Link/, "projectLink", ""],
  ["project description", /DESC-MARK/, "description", ""],
  ["project responsibilities", /RESP-MARK/, "responsibilities", []],
];
const REQUIRED_INTERNAL = [/NAME-MARK/, /JOBTITLE-MARK/, /\bOverview\b/, /OVERVIEW-MARK/, /Education & Training/, /EDU-MARK/, /\bSkills\b/, /SKILL-MARK/];

const EXTERNAL_SECTIONS = [
  ["experience line", /EXPSUM-MARK/, (d, v) => ({ ...d, experienceSummary: v ?? "" })],
  ["specialization", /SPEC-MARK/, (d, v) => ({ ...d, specialization: v ?? "" })],
  ["tools", /\bTools\b|TOOL-MARK/, (d, v) => ({ ...d, tools: v === undefined ? [] : ["", v] })],
  ["certifications", /Certifications|CERT-MARK/, (d, v) => ({ ...d, certifications: v === undefined ? [] : [v] })],
  ["employers (heading + all entries)", /(?<!Projects\/)\bExperience\b|Accenture|Infosys|POS-MARK|HIGH-MARK/, (d, v) => ({ ...d, experience: v === undefined ? [] : [{ company: v, position: v, duration: v, highlights: [v] }] })],
];
const EXTERNAL_PROJECT_FIELDS = [
  ["project duration", /Jan 2022 - Dec 2022|Mar 2021 - Nov 2021|Project 1 - |Project 2 - /, "duration", ""],
  ["project team size", /Team Size/, "teamSize", ""],
  ["project role", /\bRole\b|ROLE-MARK/, "role", ""],
  ["project description", /DESC-MARK/, "description", ""],
  ["project responsibilities", /RESP-MARK/, "responsibilities", []],
];
const EXTERNAL_EXPERIENCE_FIELDS = [
  ["employer position", /POS-MARK/, "position", ""],
  ["employer duration", /2020 - Present|2015 - 2020/, "duration", ""],
  ["employer highlights", /HIGH-MARK/, "highlights", []],
];
const REQUIRED_EXTERNAL = [/NAME-MARK/, /JOBTITLE-MARK/, /\bOverview\b/, /OVERVIEW-MARK/, /Education & Training/, /EDU-MARK/, /\bSkills\b/, /SKILL-MARK/];

function checkTemplate(id, base, sections, projectFields, experienceFields, required) {
  const full = textOf(id, base);
  for (const [name, found] of sections) assert(found.test(full), `${id}: "${name}" must show when filled`);
  for (const [name, found] of [...projectFields, ...experienceFields]) assert(found.test(full), `${id}: "${name}" must show when filled`);
  for (const re of required) assert(re.test(full), `${id}: required content ${re} must show when everything is filled`);

  // each optional section on its own, emptied in every way: [] / "" and "N/A"
  for (const [name, found, empty] of sections) {
    for (const how of [undefined, NA, "  "]) {
      const text = textOf(id, empty(base, how));
      assert(!found.test(text), `${id}: "${name}" must be completely left out when empty (${JSON.stringify(how ?? "[]")}) but ${found} was found`);
      for (const re of required) assert(re.test(text), `${id}: required content ${re} vanished when "${name}" was emptied`);
      for (const [other, otherFound] of sections.filter(([n]) => n !== name)) {
        if (other.startsWith("employers") && name.startsWith("projects")) continue; // shared heading text is checked below
        assert(otherFound.test(text), `${id}: emptying "${name}" must not remove "${other}"`);
      }
    }
  }
  // per-entry fields, emptied on every project / employer
  const entryLists = [["projects", projectFields], ["experience", experienceFields]];
  for (const [listKey, fields] of entryLists) {
    if (!fields.length || !base[listKey]) continue;
    for (const [name, found, key, emptyValue] of fields) {
      for (const how of [emptyValue, Array.isArray(emptyValue) ? [NA] : NA]) {
        const mutated = { ...base, [listKey]: base[listKey].map((e) => ({ ...e, [key]: how })) };
        const text = textOf(id, mutated);
        assert(!found.test(text), `${id}: "${name}" must be left out when empty (${JSON.stringify(how)}) but ${found} was found`);
        for (const re of required) assert(re.test(text), `${id}: required content ${re} vanished when "${name}" was emptied`);
        // the entry itself must remain
        const entryMarker = listKey === "projects" ? (id === "internal" ? /Payments Platform/ : /Acme Corp/) : /Accenture/;
        assert(entryMarker.test(text), `${id}: emptying "${name}" must not remove the entry itself`);
      }
    }
  }
  // every optional section empty at once: only the required content is left
  let bare = base;
  for (const [, , empty] of sections) bare = empty(bare, undefined);
  const bareText = textOf(id, bare);
  for (const [name, found] of sections) assert(!found.test(bareText), `${id}: with everything optional empty, "${name}" is still there`);
  for (const re of required) assert(re.test(bareText), `${id}: required content ${re} vanished in the all-optional-empty render`);
  return { full, bareText };
}

const i = checkTemplate("internal", internal, INTERNAL_SECTIONS, INTERNAL_PROJECT_FIELDS, [], REQUIRED_INTERNAL);
console.log("internal: every optional section / field shows when filled and is completely left out when empty, blank or N/A");

const e = checkTemplate("external", external, EXTERNAL_SECTIONS, EXTERNAL_PROJECT_FIELDS, EXTERNAL_EXPERIENCE_FIELDS, REQUIRED_EXTERNAL);
// external projects live in the same block as the employers: removing them is checked separately
{
  const noProjects = textOf("external", { ...external, projects: [] });
  assert(!/Acme Corp|Globex|DESC-MARK|RESP-MARK|Team Size|ROLE-MARK|Project 1/.test(noProjects), "external: projects must be completely left out when empty");
  assert(!/Projects\/Experience/.test(noProjects) && /Accenture/.test(noProjects) && /\bExperience\b/.test(noProjects), "external: with employers but no projects the shared heading is left out and the Experience heading stays alone");
  const noEmployers = textOf("external", { ...external, experience: [] });
  assert(/Projects\/Experience/.test(noEmployers) && /Acme Corp/.test(noEmployers) && !/Accenture|(?<!Projects\/)\bExperience\b|POS-MARK|HIGH-MARK/.test(noEmployers), "external: with projects but no employers, the Experience block is left out");
  const neither = textOf("external", { ...external, projects: [], experience: [] });
  assert(!/Projects\/Experience|\bExperience\b|Acme Corp|Accenture/.test(neither.replace(/EXPSUM-MARK/g, "")), "external: with neither projects nor employers both headings are left out");
  const emptyEntries = textOf("external", { ...external, projects: [{ duration: "", client: "", teamSize: "", role: "N/A", description: "", responsibilities: [""] }], experience: [{ company: "", position: "", duration: "", highlights: ["N/A"] }] });
  assert(!/Projects\/Experience|\bExperience\b/.test(emptyEntries), "external: completely empty project / employer entries are ignored");
}
console.log("external: every optional section / field shows when filled and is completely left out when empty, blank or N/A");

// internal sidebar: the Managerial Experience block ends with ONE spacer paragraph that goes away with the section
{
  const blankLines = (t) => t.split("\n").filter((l) => l.trim() === "").length;
  const withMgr = blankLines(textOf("internal", internal));
  const withoutMgr = blankLines(textOf("internal", { ...internal, managerialExperience: [] }));
  assert(withMgr - withoutMgr === 1, `internal: the Managerial Experience block must own exactly one blank spacer paragraph (found ${withMgr - withoutMgr})`);
  const lines = textOf("internal", internal).split("\n");
  const last = lines.findIndex((l) => /MGR-MARK/.test(l));
  assert(last >= 0 && lines[last + 1].trim() === "" && /Domain/.test(lines[last + 2]), "internal: the spacer sits between the last managerial item and the Domain heading");
}

// internal: the other cases the old test covered
{
  const noProjects = textOf("internal", { ...internal, projects: [] });
  assert(!/Projects/.test(noProjects), "internal: 'Projects' heading must be omitted with no projects");
  const emptyEntry = textOf("internal", { ...internal, projects: [{ duration: "", title: "", toolsAndTechnologies: [""], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [""] }] });
  assert(!/Projects/.test(emptyEntry), "internal: a completely empty project entry is ignored (no 'Projects' heading)");
  assert(/Project 1 - Jan 2023 - Dec 2023/.test(i.full), "internal: project heading shows the duration");
  assert(/Project 1\s*\n/.test(textOf("internal", { ...internal, projects: internal.projects.map((p) => ({ ...p, duration: "" })) })), "internal: with no duration the heading is just 'Project 1' (no dangling dash)");
  assert(!/Project \d+ -\s*\n/.test(textOf("internal", { ...internal, projects: internal.projects.map((p) => ({ ...p, duration: NA })) })), "internal: no dangling ' - ' with an N/A duration");
}
{
  assert(/Project 1 - Jan 2022 - Dec 2022/.test(e.full), "external: project heading shows the duration");
  assert(!/Project \d+ -\s*\n/.test(textOf("external", { ...external, projects: external.projects.map((p) => ({ ...p, duration: "" })) })), "external: no dangling ' - ' without a duration");
  assert(/Tools/.test(e.full) && /Certifications/.test(e.full) && !/Tools\/Certifications/.test(e.full), "external: Tools and Certifications are separate sections");
  assert(/TOOL-MARK JIRA, GIT/.test(e.full) && /CERT-MARK AWS SA, CKA/.test(e.full), "external: tools and certifications render as comma-separated text");
}
console.log("project / employer headings: no dangling dashes, shared headings behave");


// ------------------------------------------------- 3. formatting in the template XML (scripts/patch-templates.py)
const ART_RATIO = (847 - 153) / (359 - 141); // the logo artwork inside its 1000x500 PNG
for (const id of ["internal", "external"]) {
  const zip = new PizZip(fs.readFileSync(`public/templates/${id}.docx`));
  const xml = templateXml[id];
  // logo: cropped to the artwork and drawn at the artwork's own ratio, positioned from the page margin
  const drawing = xml.match(/<w:drawing>.*?<\/w:drawing>/s)[0];
  const [, cx, cy] = drawing.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/).map(Number);
  const crop = Object.fromEntries([...drawing.match(/<a:srcRect ([^>]*)\/>/)[1].matchAll(/(\w)="(\d+)"/g)].map((m) => [m[1], Number(m[2]) / 100000]));
  const shown = (1000 * (1 - crop.l - crop.r)) / (500 * (1 - crop.t - crop.b));
  assert(Math.abs(cx / cy - ART_RATIO) / ART_RATIO < 0.005 && Math.abs(shown - ART_RATIO) / ART_RATIO < 0.005, `${id}: the logo must keep its aspect ratio (box ${(cx / cy).toFixed(3)}, crop ${shown.toFixed(3)}, artwork ${ART_RATIO.toFixed(3)})`);
  // the label: no tabs or padding, indented exactly to the logo's left edge
  const labelPara = xml.match(/<w:p[ >].*?<\/w:p>/s)[0];
  assert(/>A PROUD MEMBER OF</.test(labelPara) && !labelPara.includes("<w:tab/>") && /<w:ind w:left="\d+"/.test(labelPara), `${id}: "A PROUD MEMBER OF" has no tabs or padding spaces and a fixed indent`);
  // bullets: one numbering definition, one indent, one bullet, one spacing
  const paras = xml.match(/<w:p[ >].*?<\/w:p>/gs) ?? [];
  const bullets = paras.filter((p, n) => n > 0 && /\{#(responsibilities|highlights)\}/.test(paras[n - 1]));
  assert(bullets.length === (id === "internal" ? 1 : 2), `${id}: expected the bullet paragraphs of the templates, found ${bullets.length}`);
  for (const b of bullets) {
    assert(/<w:numId w:val="1"\/>/.test(b) && /<w:ind w:left="720" w:hanging="360"\/>/.test(b) && /<w:spacing w:before="0" w:after="96" w:line="276" w:lineRule="auto"\/>/.test(b), `${id}: every bullet uses numbering 1, indent 720/360 and the item spacing`);
  }
  const numbering = zip.file("word/numbering.xml").asText();
  const abstractId = numbering.match(/<w:num w:numId="1"[^>]*>\s*<w:abstractNumId w:val="(\d+)"/)[1];
  const lvl0 = numbering.match(new RegExp(`<w:abstractNum [^>]*w:abstractNumId="${abstractId}".*?<w:lvl w:ilvl="0">(.*?)</w:lvl>`, "s"))[1];
  assert(lvl0.includes('w:val="•"') && lvl0.includes('w:ascii="Lexend"') && lvl0.includes('<w:sz w:val="22"/>') && lvl0.includes('<w:ind w:left="720" w:hanging="360"/>'), `${id}: the bullet is a Lexend "•" at text size with a 720/360 indent`);
  assert(zip.file("word/settings.xml").asText().includes("<w:doNotExpandShiftReturn/>"), `${id}: justified lines ending in a line break must not be stretched`);
}
console.log("templates: logo ratio and position, one bullet style, no stretched manual-break lines");


/** Every word on every page with its box (pt, from the top left), read with pdftotext -bbox. */
function wordsOf(pdf) {
  const { execFileSync } = globalThis.__child;
  const html = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" });
  return html.split("<page ").slice(1).map((page) =>
    [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
      x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5].replace(/&amp;/g, "&"),
    })),
  );
}

/** Words grouped into lines (same top, within 1pt), each { y0, y1, x0, text }, top to bottom. */
function linesOf(words) {
  const lines = [];
  for (const w of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const line = lines.find((l) => Math.abs(l.y0 - w.y0) < 1);
    if (line) {
      line.words.push(w);
      line.x0 = Math.min(line.x0, w.x0);
      line.y1 = Math.max(line.y1, w.y1);
    } else lines.push({ y0: w.y0, y1: w.y1, x0: w.x0, words: [w] });
  }
  for (const l of lines) l.text = l.words.sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(" ");
  return lines.sort((a, b) => a.y0 - b.y0);
}

/** Bounding box (pt) of the dark pixels in a region of page 1, from a 216 dpi greyscale render. */
function inkBox(pdf, region) {
  const { execFileSync } = globalThis.__child;
  const base = pdf.replace(/\.pdf$/, "-p1");
  execFileSync("pdftoppm", ["-r", "216", "-gray", "-singlefile", "-f", "1", "-l", "1", pdf, base]);
  const pgm = fs.readFileSync(`${base}.pgm`);
  const header = pgm.toString("latin1", 0, 50).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  const [w, h] = [Number(header[1]), Number(header[2])];
  const data = pgm.subarray(header[0].length);
  const k = 216 / 72;
  let box = null;
  for (let y = Math.floor(region.y0 * k); y < Math.min(h, region.y1 * k); y++) {
    for (let x = Math.floor(region.x0 * k); x < Math.min(w, region.x1 * k); x++) {
      if (data[y * w + x] < 160) {
        box ??= { x0: x, y0: y, x1: x, y1: y };
        box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      }
    }
  }
  return box && { x0: box.x0 / k, y0: box.y0 / k, x1: (box.x1 + 1) / k, y1: (box.y1 + 1) / k };
}

const LINE = 13.75; // one line of 11pt Lexend
const near = (value, want, tol) => Math.abs(value - want) <= tol;

/** Logo, bullets, blank lines and sidebar spacing, measured on the PDF LibreOffice laid out. */
function checkGeometry(file, id, pdf, data) {
  const pages = wordsOf(pdf);
  // 1. logo: directly below "A PROUD MEMBER OF", left edges aligned, artwork ratio kept
  const first = linesOf(pages[0]);
  const label = first.find((l) => l.text === "A PROUD MEMBER OF");
  assert(label, `${file}: "A PROUD MEMBER OF" must be one line on page 1`);
  const logo = inkBox(pdf, { x0: label.x0 - 6, y0: label.y1, x1: 612, y1: label.y1 + 60 });
  assert(logo, `${file}: no logo found under the label`);
  assert(near(logo.x0, label.x0, 1.5), `${file}: logo left edge ${logo.x0.toFixed(1)} must line up with the label at ${label.x0.toFixed(1)}`);
  assert(logo.y0 >= label.y1 - 0.5 && logo.y0 - label.y1 <= 6, `${file}: the logo must sit directly below the label (gap ${(logo.y0 - label.y1).toFixed(1)}pt)`);
  const ratio = (logo.x1 - logo.x0) / (logo.y1 - logo.y0);
  assert(Math.abs(ratio - ART_RATIO) / ART_RATIO < 0.04, `${file}: logo drawn at ${ratio.toFixed(3)}, the artwork is ${ART_RATIO.toFixed(3)} (stretched?)`);
  assert(logo.x0 > 306 && logo.y1 < 140, `${file}: the logo belongs in the top right`);

  const SIDEBAR_X = 400; // internal sidebar column starts at ~421pt; external has one column
  for (const words of pages) {
    const main = linesOf(words.filter((w) => id === "external" || w.x0 < SIDEBAR_X));
    // 2. bullets: same bullet position and size, same text indent, same spacing
    const bulletAt = main.flatMap((l, n) => (l.words[0].t === "•" ? [n] : []));
    for (const n of bulletAt) {
      const [dot, text] = main[n].words;
      const ref = main[bulletAt[0]].words;
      assert(near(dot.x0, ref[0].x0, 0.3) && near(dot.x1 - dot.x0, ref[0].x1 - ref[0].x0, 0.3) && near(text.x0, ref[1].x0, 0.3), `${file}: bullets differ in position, size or indent`);
      // continuation lines of this bullet sit at the text indent, 1.15 lines apart; the next bullet 1.5 lines down
      let k = n + 1;
      while (k < main.length && near(main[k].x0, text.x0, 0.5) && main[k].words[0].t !== "•") {
        assert(near(main[k].y0 - main[k - 1].y0, 1.15 * LINE, 1), `${file}: lines inside a bullet must be 1.15 apart (${(main[k].y0 - main[k - 1].y0).toFixed(1)}pt)`);
        k++;
      }
      if (k < main.length && main[k].words[0].t === "•") assert(near(main[k].y0 - main[k - 1].y0, 1.5 * LINE, 1.2), `${file}: bullets must be 1.5 lines apart (${(main[k].y0 - main[k - 1].y0).toFixed(1)}pt)`);
    }
    // 3. one blank line before the description and before the first bullet
    for (const [n, l] of main.entries()) {
      if (n === 0) continue;
      const gap = l.y0 - main[n - 1].y1;
      if (/^DESC-MARK/.test(l.text)) assert(gap > 10 && gap < 30, `${file}: one blank line must precede the description (gap ${gap.toFixed(1)}pt after "${main[n - 1].text}")`);
      if (l.words[0].t === "•" && main[n - 1].words[0].t !== "•" && !near(main[n - 1].x0, main[n].words[1].x0, 0.5)) {
        assert(gap > 10 && gap < 30, `${file}: one blank line must precede the bullets (gap ${gap.toFixed(1)}pt after "${main[n - 1].text}")`);
      }
    }
  }
  // 4. internal sidebar: 1.15 lines inside an item, 1.5 lines from item to item
  if (id === "internal") {
    const side = linesOf(pages[0].filter((w) => w.x0 >= SIDEBAR_X && w.y0 > 140));
    const HEADINGS = /^(Skills|Certifications|Tools|Managerial Experience|Domain|Languages)$/;
    const items = []; // [first line, ..., last line] per item
    const itemTexts = [
      ...data.skills.map((s) => [s.name, `(${s.rating}/5)`]),
      ...[data.certifications, data.managerialExperience, data.domains, data.languages].flat().filter(Boolean).map((t) => [t]),
      ...(data.tools?.length ? [[data.tools.filter(Boolean).join(", ")]] : []),
    ].map((parts) => parts.join(" "));
    let n = 0;
    while (n < side.length) {
      if (HEADINGS.test(side[n].text)) { n++; continue; }
      // grow the item line by line until its text is one of the expected items
      let k = n;
      let text = side[n].text;
      while (!itemTexts.includes(text) && k + 1 < side.length && !HEADINGS.test(side[k + 1].text)) text += " " + side[++k].text;
      if (itemTexts.includes(text)) items.push(side.slice(n, k + 1));
      n = k + 1;
    }
    assert(items.length >= Math.min(2, itemTexts.length), `${file}: could not find the sidebar items (${items.length} of ${itemTexts.length})`);
    for (const [i, item] of items.entries()) {
      for (let j = 1; j < item.length; j++) assert(near(item[j].y0 - item[j - 1].y0, 1.15 * LINE, 1), `${file}: inside a sidebar item lines must be 1.15 apart ("${item[j].text}": ${(item[j].y0 - item[j - 1].y0).toFixed(1)}pt)`);
      const next = items[i + 1];
      const between = next && side.slice(side.indexOf(item.at(-1)) + 1, side.indexOf(next[0]));
      if (next && between.length === 0) assert(near(next[0].y0 - item.at(-1).y0, 1.5 * LINE, 1.2), `${file}: sidebar items must be 1.5 lines apart ("${next[0].text}": ${(next[0].y0 - item.at(-1).y0).toFixed(1)}pt)`);
    }
  }
}

// ------------------------------------------------- 4. optional: PDFs through LibreOffice for a visual check
if (process.argv.includes("--pdf")) {
  const { execFileSync } = await import("node:child_process");
  globalThis.__child = { execFileSync };
  const dir = "/tmp/render-check";
  fs.mkdirSync(dir, { recursive: true });
  const cases = [];
  for (const [id, base, sections] of [["internal", internal, INTERNAL_SECTIONS], ["external", external, EXTERNAL_SECTIONS]]) {
    let bare = base;
    for (const [, , empty] of sections) bare = empty(bare, undefined); // every optional section empty
    bare = { ...bare, projects: [] }; // (external projects are not in its section list: they share a block with employers)
    // entries that only have their name: every optional sub-field of every project / employer is empty
    const sparse = {
      ...base,
      projects: base.projects.map((p) => ({ ...p, duration: "", toolsAndTechnologies: [], teamSize: "", role: "", projectLink: "", description: "", responsibilities: [] })),
      ...(base.experience ? { experience: base.experience.map((x) => ({ ...x, position: "", duration: "", highlights: [] })) } : {}),
      certifications: [], tools: [], domains: [], languages: [], managerialExperience: [], experienceSummary: "", specialization: "",
    };
    // partial combinations: the sidebar / shared heading are most likely to misbehave when only SOME sections are there
    const mixed =
      id === "internal"
        ? { ...base, experienceSummary: "", certifications: [], tools: [], domains: [], projects: base.projects.slice(0, 1) } // keeps managerial + languages
        : { ...base, specialization: "", tools: [], projects: [] }; // keeps certifications + employers only
    // long text everywhere: wrapping bullets, a wrapping description and (internal) wrapping sidebar items
    const LONG = "LONG-MARK led a cross-functional team to migrate a fictional platform to the cloud, cutting batch runtimes and simplifying every release";
    const long = {
      ...base,
      projects: base.projects.map((p) => ({ ...p, description: `DESC-MARK ${LONG}.`, responsibilities: [LONG, "RESP-MARK short", LONG] })),
      ...(id === "internal"
        ? { skills: [{ name: "SKILL-MARK Programme and portfolio management", rating: "4.5" }, ...base.skills], managerialExperience: ["MGR-MARK Stakeholder management across regions", "Hiring"], domains: ["DOMAIN-MARK Banking and financial services", "Retail"] }
        : { experience: base.experience.map((x) => ({ ...x, highlights: [LONG, "HIGH-MARK short"] })) }),
    };
    cases.push([`${id}-full`, id, base], [`${id}-bare`, id, bare], [`${id}-sparse`, id, sparse], [`${id}-mixed`, id, mixed], [`${id}-long`, id, long]);
  }
  for (const [file, id, data] of cases) {
    const { out, zip } = render(id, data);
    fs.writeFileSync(`${dir}/${file}.docx`, out);
    // exactly what Download PDF does (lib/pdfRender.ts): embedded fonts dropped, LibreOffice with the brand fonts
    fs.writeFileSync(`${dir}/${file}.pdf`, await convertDocxToPdf(withoutEmbeddedFonts(zip).generate({ type: "uint8array", compression: "DEFLATE" })));
    console.log(`pdf: ${dir}/${file}.pdf`);
    // automatic layout checks on what LibreOffice actually laid out
    const lines = execFileSync("pdftotext", ["-layout", `${dir}/${file}.pdf`, "-"], { encoding: "utf8" }).split("\n");
    assert(!lines.some((l) => /^\s*[●•▪◦]\s*$/.test(l)), `${file}: an empty bullet was laid out`);
    checkGeometry(file, id, `${dir}/${file}.pdf`, data);
    if (id === "external") {
      // single column: a heading must be followed by content, never by another heading or by nothing
      const HEADINGS = new Set(["Overview", "Education & Training", "Skills", "Tools", "Certifications", "Projects/Experience", "Experience"]);
      const body = lines.map((l) => l.trim()).filter((l) => l && !/^\d+$/.test(l)); // drop blanks and page numbers
      body.forEach((l, n) => {
        if (HEADINGS.has(l)) assert(n + 1 < body.length && !HEADINGS.has(body[n + 1]), `${file}: orphan heading "${l}" (followed by ${body[n + 1] ?? "nothing"})`);
      });
    }
  }
}
console.log("done");
