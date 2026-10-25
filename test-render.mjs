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
import { measurePdf } from "./scripts/pdf-measure.mjs";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

// ------------------------------------------- the reference format (eval/reference/format.pdf, measured; see the patcher)
// PDF points from the page's top left. "top" of a text line = baseline - 0.75 x size (the convention of the targets).
// Internal matches the reference; external keeps its own layout (one column, logo flush right) with the same rules.
const TEXT_RIGHT = 612 - 43.2;
const REF = {
  page: { w: 612, h: 792 },
  footLogo: { x: 44.7, w: 24.7, h: 15.0, bottom: 15.4 },
  pageNumber: { size: 8.4 },
  label: { font: "Lexend-Regular", size: 8, top: 38.4, x: { internal: 411.7, external: TEXT_RIGHT - 130.5 - 0.5 } },
  logo: { w: 130.5, h: 42.0, top: 59.25, x: { internal: 412.2, external: TEXT_RIGHT - 130.5 } },
  textX: { internal: 50.7, external: 43.2 },
  sidebarX: 409.2,
  name: { font: "Lexend-Medium", size: 24, top: 59.0 },
  jobTitle: { font: "Lexend-Regular", size: 12, top: 91.0 },
  experienceSummary: { font: "Lexend-Light", size: 11, top: 109.3 },
  specialization: { font: "Lexend-Light", size: 11, top: 126.6 },
  heading: { font: "Lexend-Light", size: 10, firstTop: 182.1, toText: 24.2, sectionGap: 46.3 },
  body: { font: "Lexend-Light", size: 11, pitch: 17.25 },
  // internal only: the grey line under the header block, and the underline of "Project N - <dates>" (stroke widths are
  // drawn widths: the reference's underline is 1.0pt, LibreOffice draws the font's own thickness, 0.7pt for Lexend)
  rule: { color: "#888888", width: 1.0, x0: 54.0, x1: 541.0, y: 146.5 },
  underline: { color: "#373742", width: [0.5, 1.1], below: [1.0, 1.6] },
  project: { heading: "Lexend-Regular", name: "Lexend-Light", label: "Lexend-Regular", value: "Lexend-Light", size: 11, toName: 16.5, toFirstLabel: 24.0, toValue: 15.0, toLabel: 25.5, toDescription: 25.5, toNext: 54.7 },
};
const HEADINGS = {
  internal: ["Overview", "Education & Training", "Projects", "Skills", "Certifications", "Tools", "Managerial Experience", "Domain", "Languages"],
  external: ["Overview", "Education & Training", "Skills", "Tools", "Certifications", "Projects/Experience", "Experience"],
};
const FIELD_LABELS = ["Tools & Technologies", "Team Size", "Role", "Project Link"];
const near = (value, want, tol) => Math.abs(value - want) <= tol;
const POS = 1; // positions within 1pt
const fixed = (v) => v.toFixed(1);
const ART = { l: 153 / 1000, t: 141 / 500, r: (1000 - 847) / 1000, b: (500 - 359) / 500 }; // the logo artwork inside its PNG

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

// Realistic fictional profiles shaped like the reference (the same sections and kinds of field, invented text): rendered
// as internal-sample / external-sample with --pdf, for the side-by-side comparison with eval/reference/format.pdf.
const internalSample = {
  name: "Meera Joshi",
  jobTitle: "Senior Software Engineer",
  experienceSummary: "6+ Years of Industry Experience",
  specialization: "Cloud Data Platforms",
  overview:
    "Builds data pipelines and reporting platforms for retail and logistics businesses, from ingestion through to dashboards used by store and warehouse teams. Works across batch and streaming workloads on AWS, with a focus on data quality checks and cost control. Has mentored new joiners and run sprint planning for a team of five engineers.",
  education: [{ year: "2016", qualification: "Bachelor of Engineering (Computer Science), Lakeshore University" }],
  projects: [
    {
      duration: "Feb 2023 – Jun 2024",
      title: "Store Replenishment Forecasting",
      toolsAndTechnologies: ["Python", "Airflow", "PostgreSQL", "AWS Glue", "React"],
      teamSize: "6",
      role: "Data Engineer",
      projectLink: "NDA",
      description:
        "Forecasting platform that tells store managers which products to reorder each week, built on daily sales and stock feeds from 120 stores, with a review screen for managers and alerts when stock falls below agreed levels.",
      responsibilities: [
        "Built the daily ingestion pipelines for sales and stock feeds in Airflow and AWS Glue.",
        "Designed the PostgreSQL schema for forecasts and the manager review screen.",
      ],
    },
    {
      duration: "Mar 2021 – Jan 2023",
      title: "Warehouse Slotting Dashboard",
      toolsAndTechnologies: ["Node.js", "MySQL", "Chart.js"],
      teamSize: "4",
      role: "Full Stack Developer",
      projectLink: "https://example.com/slotting",
      description:
        "Dashboard that shows warehouse supervisors where each product is stored, how often it is picked and which slots should change, using pick data from the warehouse management system refreshed every hour.",
      responsibilities: ["Developed the slot heat map and the pick frequency reports.", "Added role-based access for supervisors and planners."],
    },
  ],
  skills: [
    { name: "Python", rating: "4.5" },
    { name: "SQL", rating: "4" },
    { name: "Apache Airflow", rating: "3.8" },
    { name: "AWS (Glue, S3, Lambda)", rating: "3.5" },
    { name: "React", rating: "3" },
  ],
  certifications: ["AWS Certified Data Engineer – Associate"],
  tools: ["JIRA", "Git", "Confluence"],
  managerialExperience: ["Sprint Planning", "Mentoring"],
  domains: ["Retail", "Logistics"],
  languages: ["English", "Hindi", "Marathi"],
};

const externalSample = {
  name: "Daniel Ortiz",
  jobTitle: "Senior QA Engineer",
  experienceSummary: "8+ Years of Industry Experience",
  specialization: "Test Automation",
  overview:
    "Plans and automates testing for web and mobile banking products, covering functional, regression and API testing. Introduced contract tests between front-end and back-end teams and keeps release regression suites under two hours. Works closely with product owners on acceptance criteria.",
  education: [{ year: "2015", qualification: "Master of Computer Applications, Northfield Institute of Technology" }],
  skills: ["Test Automation", "API Testing", "Regression Testing", "Performance Testing", "Agile"],
  tools: ["Selenium", "Postman", "JMeter", "Jenkins", "JIRA"],
  certifications: ["ISTQB Certified Tester – Foundation Level"],
  projects: [
    {
      duration: "Jan 2023 – Present",
      client: "Mobile Banking Regression Suite",
      teamSize: "8",
      role: "QA Lead",
      description:
        "Automated regression suite for a mobile banking app used by retail customers, covering account opening, transfers, card controls and statements on Android and iOS, run on every release candidate in the delivery pipeline.",
      responsibilities: ["Designed the page-object framework for Android and iOS tests.", "Cut the regression run from six hours to under two by running suites in parallel."],
    },
    {
      duration: "Apr 2020 – Dec 2022",
      client: "Payments API Contract Testing",
      teamSize: "5",
      role: "Senior QA Engineer",
      description:
        "Contract and integration tests for the payments APIs shared by the web and mobile channels, checking request and response formats, error handling and limits for every payment type before each deployment.",
      responsibilities: ["Wrote Postman collections and contract tests for twelve payment endpoints.", "Added JMeter load tests for peak-hour payment volumes."],
    },
  ],
  experience: [
    { company: "Brightwave Systems", position: "Senior QA Engineer", duration: "Apr 2020 – Present", highlights: ["Leads a team of four testers across two product lines.", "Set up nightly automated runs in Jenkins."] },
    { company: "Contoso Software", position: "QA Engineer", duration: "Jul 2015 – Mar 2020", highlights: ["Tested insurance claims portals for web and mobile."] },
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
  // logo: cropped exactly to the artwork and drawn at the reference's size (130.5 x 42.0pt)
  const drawings = xml.match(/<w:drawing>.*?<\/w:drawing>/gs) ?? [];
  const drawing = drawings.find((d) => d.includes("<pic:pic>"));
  assert(drawing, `${id}: no logo drawing`);
  // internal: the grey header line is one page-anchored line shape (nothing else is a shape); external has none
  assert(drawings.filter((d) => d.includes("wordprocessingShape")).length === (id === "internal" ? 1 : 0), `${id}: wrong number of line shapes`);
  const [, cx, cy] = drawing.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/).map(Number);
  const crop = Object.fromEntries([...drawing.match(/<a:srcRect ([^>]*)\/>/)[1].matchAll(/(\w)="(\d+)"/g)].map((m) => [m[1], Number(m[2]) / 100000]));
  const shown = (1000 * (1 - crop.l - crop.r)) / (500 * (1 - crop.t - crop.b));
  assert(Math.abs(shown - ART_RATIO) / ART_RATIO < 0.005, `${id}: the logo must show exactly the artwork (crop ratio ${shown.toFixed(3)}, artwork ${ART_RATIO.toFixed(3)})`);
  assert(near(cx / 12700, REF.logo.w, 0.05) && near(cy / 12700, REF.logo.h, 0.05), `${id}: the logo box is ${(cx / 12700).toFixed(2)} x ${(cy / 12700).toFixed(2)}pt, want ${REF.logo.w} x ${REF.logo.h}`);
  // the label: no tabs or padding, a fixed indent
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
console.log("templates: logo crop and size, one bullet style, no stretched manual-break lines");

// internal: the projects column ends with the last project's content. A trailing blank line there spilled onto an
// extra, near-empty last page (footer only) whenever the last bullet sat at the foot of a page; see the PDF sweep below.
{
  const xml = render("internal", internal).zip.file("word/document.xml").asText();
  const cell = (xml.match(/<w:tc>.*?<\/w:tc>/gs) ?? []).find((c) => c.includes("RESP-MARK three"));
  const paras = (cell.match(/<w:p[ >].*?<\/w:p>/gs) ?? []).map((p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
  assert(paras.at(-1).includes("RESP-MARK three"), `internal: the projects column must end with the last bullet, not a blank line (ends with ${JSON.stringify(paras.slice(-2))})`);
  const second = paras.findIndex((t) => t.startsWith("Project 2"));
  assert(second > 0 && paras[second - 1] === "", "internal: a blank line still separates one project from the next");
}
console.log("internal: no trailing blank line after the last project");


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

const inkRendered = new Set(); // pages already rendered in this run (the files are rewritten on every run)
/** Bounding box (pt) of the dark pixels in a region of a page (1-based), from a 216 dpi greyscale render. */
function inkBox(pdf, region, page = 1) {
  const { execFileSync } = globalThis.__child;
  const base = pdf.replace(/\.pdf$/, `-p${page}`);
  if (!inkRendered.has(base)) execFileSync("pdftoppm", ["-r", "216", "-gray", "-singlefile", "-f", String(page), "-l", String(page), pdf, base]);
  inkRendered.add(base);
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


/** Footer on every page: the logo's size and place, the page number's font, size, right edge (mirroring the logo) and height. */
function checkFooter(file, pdf, pages) {
  const { footLogo, page } = REF;
  pages.forEach((p, n) => {
    const logo = p.images.find((im) => im.y > page.h - 60);
    assert(logo, `${file} p${n + 1}: no footer logo`);
    assert(near(logo.w, footLogo.w, 0.3) && near(logo.h, footLogo.h, 0.3), `${file} p${n + 1}: footer logo ${fixed(logo.w)} x ${fixed(logo.h)}, want ${footLogo.w} x ${footLogo.h}`);
    assert(near(logo.x, footLogo.x, POS), `${file} p${n + 1}: footer logo left edge ${fixed(logo.x)}, want ${footLogo.x}`);
    assert(near(page.h - logo.y - logo.h, footLogo.bottom, POS), `${file} p${n + 1}: footer logo bottom ${fixed(page.h - logo.y - logo.h)} above the page edge, want ${footLogo.bottom}`);
    const number = p.runs.filter((r) => r.baseline > page.h - 60 && /^\d+$/.test(r.text.trim()));
    assert(number.length === 1 && number[0].text.trim() === String(n + 1), `${file} p${n + 1}: page number missing or wrong (${number.map((r) => r.text)})`);
    const [r] = number;
    assert(/^Lexend-/.test(r.font) && near(r.size, REF.pageNumber.size, 0.05), `${file} p${n + 1}: page number in ${r.font} ${r.size}pt, want Lexend ${REF.pageNumber.size}pt`);
    // drawn glyphs: right edge mirrors the logo's left edge, digits centred on the logo's middle
    const ink = inkBox(pdf, { x0: page.w - 120, y0: logo.y - 3, x1: page.w, y1: page.h }, n + 1);
    assert(near(page.w - ink.x1, logo.x, POS), `${file} p${n + 1}: page number ends ${fixed(page.w - ink.x1)}pt from the right edge, the logo starts ${fixed(logo.x)}pt from the left`);
    assert(near((ink.y0 + ink.y1) / 2, logo.y + logo.h / 2, POS), `${file} p${n + 1}: page number centre ${fixed((ink.y0 + ink.y1) / 2)}, logo centre ${fixed(logo.y + logo.h / 2)}`);
  });
}

let referenceChecks = 0;
/** Text runs grouped into lines per column (internal: main / sidebar), each { page, col, baseline, top, x, size, font, text, runs }. */
function measuredLines(pages, id) {
  const out = [];
  pages.forEach((p, page) => {
    const lines = [];
    for (const r of [...p.runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
      if (r.baseline > REF.page.h - 60) continue; // footer
      const col = id === "internal" && r.x >= 400 ? "side" : "main";
      const line = lines.find((l) => l.col === col && Math.abs(l.baseline - r.baseline) < 0.5);
      if (line) line.runs.push(r);
      else lines.push({ page, col, baseline: r.baseline, runs: [r] });
    }
    for (const l of lines) {
      l.runs.sort((a, b) => a.x - b.x);
      l.x = l.runs[0].x;
      l.text = l.runs.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
      // the font and size of the line's words (a bullet glyph is drawn in the bullet's own font)
      const words = l.runs.filter((r) => r.text.trim() !== "•");
      l.font = (words[0] ?? l.runs[0]).font;
      l.size = (words[0] ?? l.runs[0]).size;
      l.top = l.baseline - 0.75 * l.size;
    }
    out.push(...lines.sort((a, b) => (a.col === b.col ? a.baseline - b.baseline : a.col === "main" ? -1 : 1)));
  });
  return out;
}

/**
 * The reference format, measured on the generated PDF: header (label, logo, name, job title, header lines), section
 * headings (font, size, the space after them, the gap before them), body text (font, size, line pitch), project lines
 * (fonts, sizes, spacing) and every number (Lexend, the size of the text around it). Positions within POS.
 */
function checkReference(file, id, pages, data) {
  const lines = measuredLines(pages, id);
  const is = (line, font, size, what) => {
    referenceChecks++;
    assert(line.font === font && near(line.size, size, 0.01), `${file}: ${what} "${line.text}" is ${line.font} ${line.size}pt, want ${font} ${size}pt`);
  };
  const at = (value, want, what) => {
    referenceChecks++;
    assert(near(value, want, POS), `${file}: ${what} is ${fixed(value)}, want ${fixed(want)}`);
  };
  const real = (v) => typeof v === "string" && v.trim() && !/^n\/?a$/i.test(v.trim());

  // header
  const label = lines.find((l) => l.page === 0 && l.text === "A PROUD MEMBER OF");
  assert(label, `${file}: no "A PROUD MEMBER OF"`);
  is(label, REF.label.font, REF.label.size, "label");
  at(label.x, REF.label.x[id], "label left edge");
  at(label.top, REF.label.top, "label top");
  const im = pages[0].images.find((i) => i.y < 150);
  assert(im, `${file}: no header logo`);
  const logo = { x: im.x + im.w * ART.l, y: im.y + im.h * ART.t, w: im.w * (1 - ART.l - ART.r), h: im.h * (1 - ART.t - ART.b) }; // the visible (cropped) artwork
  assert(near(logo.w, REF.logo.w, 0.3) && near(logo.h, REF.logo.h, 0.3), `${file}: header logo ${fixed(logo.w)} x ${fixed(logo.h)}, want ${REF.logo.w} x ${REF.logo.h}`);
  at(logo.x, REF.logo.x[id], "header logo left edge");
  at(logo.y, REF.logo.top, "header logo top");
  at(logo.y - label.top, REF.logo.top - REF.label.top, "logo top below the label's top");
  for (const key of ["name", "jobTitle", "experienceSummary", "specialization"]) {
    if (!real(data[key])) continue;
    const line = lines.find((l) => l.page === 0 && l.col === "main" && l.text === data[key].trim());
    assert(line, `${file}: header line ${key} not found`);
    is(line, REF[key].font, REF[key].size, key);
    at(line.x, REF.textX[id], `${key} left edge`);
    // later lines move up when an optional one above them is empty: only check a line whose lines above are all there
    const above = ["experienceSummary", "specialization"].slice(0, ["experienceSummary", "specialization"].indexOf(key));
    if (above.every((k) => real(data[k]))) at(line.top, REF[key].top, `${key} top`);
  }
  at(lines.find((l) => l.text === data.name.trim()).top - label.top, REF.name.top - REF.label.top, "name top below the label's top");

  // the thin grey line under the header block: colour, thickness, width and height as in the reference, with any optional
  // header line empty too (internal only; the external layout has no such line)
  const rules = pages[0].lines.filter((x) => x.color.toLowerCase() === REF.rule.color && x.y < 200);
  if (id === "internal") {
    // exactly one: LibreOffice paints a paragraph border or shading twice (two identical fills in the PDF), so the line
    // is a page-anchored shape; a second copy would also be heavier on screen
    assert(rules.length === 1, `${file}: ${rules.length} grey lines under the header block on page 1, want exactly 1`);
    assert(pages.slice(1).every((p) => p.lines.every((x) => x.color.toLowerCase() !== REF.rule.color)), `${file}: a grey header line on a page after the first`);
    for (const r of rules) {
      at(r.x0, REF.rule.x0, "header line left end");
      at(r.x1, REF.rule.x1, "header line right end");
      at(r.y, REF.rule.y, "header line vertical centre");
      assert(near(r.width, REF.rule.width, 0.05), `${file}: header line is ${r.width.toFixed(2)}pt thick, want ${REF.rule.width}`);
    }
  } else assert(rules.length === 0, `${file}: the external template must have no header line`);

  // section headings: font and size, the first line after them, the gap before them
  const names = HEADINGS[id];
  const isHeading = (l) => names.includes(l.text) && l.font === REF.heading.font && near(l.size, REF.heading.size, 0.01);
  let first = { main: true, side: true };
  for (const [n, l] of lines.entries()) {
    if (!names.includes(l.text)) continue;
    is(l, REF.heading.font, REF.heading.size, "section heading");
    const next = lines[n + 1];
    if (next && next.page === l.page && next.col === l.col) at(next.top - l.top, REF.heading.toText, `space after "${l.text}" (heading top to first line top)`);
    const prev = lines[n - 1];
    const firstInColumn = first[l.col];
    first[l.col] = false;
    if (firstInColumn) {
      // Overview / Skills: the reference's first headings (external: only with both header lines there)
      if (id === "internal" || (real(data.experienceSummary) && real(data.specialization))) at(l.top, REF.heading.firstTop, `"${l.text}" top`);
      continue;
    }
    if (!prev || prev.page !== l.page || prev.col !== l.col || isHeading(prev)) continue;
    // after a project the gap is set for a project ending in bullets (the usual case)
    const afterProject = id === "external" && l.text === "Experience";
    if (afterProject && !(prev.x > REF.textX[id] + 10)) continue;
    at(l.baseline - prev.baseline, REF.heading.sectionGap, `gap before "${l.text}" (last line to heading baseline)`);
  }

  // body text: overview lines
  const overviewAt = lines.findIndex((l) => l.text === "Overview" && l.col === "main");
  for (let n = overviewAt + 1; n < lines.length && !isHeading(lines[n]) && lines[n].page === lines[overviewAt].page; n++) {
    is(lines[n], REF.body.font, REF.body.size, "overview");
    if (n > overviewAt + 1) at(lines[n].baseline - lines[n - 1].baseline, REF.body.pitch, "overview line pitch");
  }

  // projects: heading -> name -> labels / values -> description; and from one project to the next
  const P = REF.project;
  const main = lines.filter((l) => l.col === "main");
  for (const [n, l] of main.entries()) {
    if (!/^Project \d+\b/.test(l.text) || l.font !== P.heading) continue;
    is(l, P.heading, P.size, "project heading");
    // internal: the whole heading is underlined in the text colour (one line from its first to its last character)
    const under = pages[l.page].lines.filter((x) => x.color.toLowerCase() === REF.underline.color && x.y > l.baseline + REF.underline.below[0] && x.y < l.baseline + REF.underline.below[1] + 0.5 && x.x0 < l.runs.at(-1).x1 && x.x1 > l.x);
    if (id === "internal") {
      referenceChecks++;
      assert(under.length > 0, `${file}: "${l.text}" is not underlined`);
      const u = under[0];
      at(u.x0, l.x, `underline of "${l.text}": left end vs the text`);
      at(u.x1, l.runs.at(-1).x1, `underline of "${l.text}": right end vs the text`);
      assert(u.width >= REF.underline.width[0] && u.width <= REF.underline.width[1], `${file}: underline of "${l.text}" is ${u.width.toFixed(2)}pt thick`);
      assert(u.y - l.baseline >= REF.underline.below[0] && u.y - l.baseline <= REF.underline.below[1], `${file}: underline of "${l.text}" is ${(u.y - l.baseline).toFixed(2)}pt below the baseline, want ${REF.underline.below.join("–")}`);
    } else assert(under.length === 0, `${file}: external "${l.text}" must not be underlined`);
    const k = Number(l.text.match(/^Project (\d+)/)[1]) - 1;
    const project = (data.projects ?? []).filter((p) => Object.values(p).some((v) => (Array.isArray(v) ? v.some(real) : real(v))))[k];
    const prev = main[n - 1];
    if (k > 0 && prev && prev.page === l.page && prev.x > REF.textX[id] + 10) at(l.baseline - prev.baseline, P.toNext, `project ${k + 1}: gap from the previous project's last bullet`);
    const nameText = id === "internal" ? project?.title : project?.client;
    let m = n + 1;
    if (real(nameText) && main[m]?.page === l.page) {
      is(main[m], P.name, P.size, "project name");
      at(main[m].baseline - l.baseline, P.toName, `project ${k + 1}: heading to name`);
    }
    // the field labels and their values
    let previousValueEnd = main[m];
    let firstLabel = true;
    for (m = n + 2; m < main.length && main[m].page === l.page && !/^Project \d+\b/.test(main[m].text) && !isHeading(main[m]); m++) {
      if (!FIELD_LABELS.includes(main[m].text) || main[m].font !== P.label) continue;
      is(main[m], P.label, P.size, "field label");
      const before = main[m - 1];
      if (before.page === l.page) at(main[m].baseline - before.baseline, firstLabel ? P.toFirstLabel : P.toLabel, `project ${k + 1}: gap before "${main[m].text}"`);
      firstLabel = false;
      const value = main[m + 1];
      if (value?.page === l.page) {
        is(value, P.value, P.size, `"${main[m].text}" value`);
        at(value.baseline - main[m].baseline, P.toValue, `project ${k + 1}: "${main[m].text}" label to value`);
        previousValueEnd = value;
      }
    }
    const description = real(project?.description) && main.find((x) => x.page === l.page && x.baseline > previousValueEnd.baseline && project.description.startsWith(x.text.split(" ").slice(0, 3).join(" ")));
    if (description && previousValueEnd !== main[n + 1]) {
      is(description, REF.body.font, REF.body.size, "project description");
      const valueEnd = main.filter((x) => x.page === l.page && x.baseline < description.baseline).at(-1);
      at(description.baseline - valueEnd.baseline, P.toDescription, `project ${k + 1}: last field to description`);
    }
  }

  // nothing else carries the text-colour underline: one per project heading on internal, none on external
  const headings = lines.filter((x) => /^Project \d+\b/.test(x.text) && x.col === "main").length;
  const underlines = pages.reduce((n, p) => n + p.lines.filter((x) => x.color.toLowerCase() === REF.underline.color).length, 0);
  assert(underlines === (id === "internal" ? headings : 0), `${file}: ${underlines} underlines for ${headings} project headings`);

  // numbers: in Lexend, at the size of the text around them
  for (const l of lines) {
    for (const r of l.runs.filter((r) => /\d/.test(r.text))) {
      assert(/^Lexend-(Light|Regular|Medium)$/.test(r.font), `${file}: "${r.text}" is drawn in ${r.font}, not Lexend`);
      assert(near(r.size, l.size, 0.01), `${file}: "${r.text}" is ${r.size}pt in a ${l.size}pt line ("${l.text}")`);
    }
  }
  const fonts = new Set(pages.flatMap((p) => p.runs.map((r) => r.font)));
  assert([...fonts].every((f) => /^Lexend-(Light|Regular|Medium)$/.test(f)), `${file}: fonts other than Lexend in the PDF: ${[...fonts]}`);
}

/** Logo, bullets, blank lines and sidebar spacing, measured on the PDF LibreOffice laid out. */
function checkGeometry(file, id, pdf, data) {
  const pages = wordsOf(pdf);
  // 1. the label is one line on page 1 (its place, and the logo's, are checked against the reference in checkReference)
  const first = linesOf(pages[0]);
  assert(first.some((l) => l.text === "A PROUD MEMBER OF"), `${file}: "A PROUD MEMBER OF" must be one line on page 1`);

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
  cases.push(["internal-sample", "internal", internalSample], ["external-sample", "external", externalSample]);
  // internal: one project with 1..8 bullets, so the last bullet lands at the foot of page 1 in one of them
  const footProject = (n) => ({ ...internal.projects[0], description: "DESC-MARK a payments platform for a retail bank with a focus on reliability.", responsibilities: Array.from({ length: n }, (_, k) => `RESP-MARK ${k + 1} for the project.`) });
  const foot = Array.from({ length: 8 }, (_, k) => [`internal-foot-${k + 1}`, "internal", { ...internal, certifications: [], tools: [], managerialExperience: [], domains: [], languages: [], projects: [footProject(k + 1)] }]);
  cases.push(...foot);
  const pageCounts = [];
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
    const measured = await measurePdf(`${dir}/${file}.pdf`);
    checkFooter(file, `${dir}/${file}.pdf`, measured);
    checkReference(file, id, measured, data);
    // no extra near-empty last page: the last page carries more than its page number (and the footer's logo)
    const pages = execFileSync("pdftotext", [`${dir}/${file}.pdf`, "-"], { encoding: "utf8" }).split("\f").filter((p, n, all) => n < all.length - 1 || p.trim());
    assert(!/^\s*\d*\s*$/.test(pages.at(-1)), `${file}: the last page (${pages.length}) is empty apart from the footer`);
    if (file.startsWith("internal-foot-")) pageCounts.push(pages.length);
    if (id === "external") {
      // single column: a heading must be followed by content, never by another heading or by nothing
      const HEADINGS = new Set(["Overview", "Education & Training", "Skills", "Tools", "Certifications", "Projects/Experience", "Experience"]);
      const body = lines.map((l) => l.trim()).filter((l) => l && !/^\d+$/.test(l)); // drop blanks and page numbers
      body.forEach((l, n) => {
        if (HEADINGS.has(l)) assert(n + 1 < body.length && !HEADINGS.has(body[n + 1]), `${file}: orphan heading "${l}" (followed by ${body[n + 1] ?? "nothing"})`);
      });
    }
  }
  assert(pageCounts.includes(1) && pageCounts.includes(2), `internal-foot: the bullets must cross the foot of page 1 for this check to mean anything (pages ${pageCounts})`);
  console.log("pdf: no near-empty last page (internal, last bullet at the foot of a page)");
  console.log(`pdf: reference format, footer and fonts checked on ${cases.length} PDFs (${referenceChecks} measurements)`);
}
console.log("done");
