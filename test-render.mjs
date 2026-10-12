/**
 * Purpose: renders the REAL Word templates (public/templates/{internal,external}.docx) with the REAL prepareData
 * (lib/docxData.ts) and checks the optional-section behaviour:
 *   - every optional section / field is present when filled and COMPLETELY gone (heading, content, spacer) when it is
 *     empty, blank or "N/A"; required sections never disappear;
 *   - with every optional section empty only the required content is left;
 *   - no {tag} is left over, none is split across Word runs, nothing renders as "undefined".
 * Run: npm run test:render   (it uses tsx so it can import the TypeScript module). Add --pdf to also convert the
 * full and the all-optional-empty renders with LibreOffice into /tmp/render-check/ for a visual check.
 */
import fs from "node:fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { prepareData } from "./lib/docxData.ts";

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
  return { text, out };
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

// ------------------------------------------------- 3. optional: PDFs through LibreOffice for a visual check
if (process.argv.includes("--pdf")) {
  const { execFileSync } = await import("node:child_process");
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
    cases.push([`${id}-full`, id, base], [`${id}-bare`, id, bare], [`${id}-sparse`, id, sparse], [`${id}-mixed`, id, mixed]);
  }
  for (const [file, id, data] of cases) {
    fs.writeFileSync(`${dir}/${file}.docx`, render(id, data).out);
    // A private profile directory keeps this headless run separate from a LibreOffice window you may have open
    // (otherwise the request is handed to that window and no PDF is written).
    execFileSync("soffice", [`-env:UserInstallation=file://${dir}/lo-profile`, "--headless", "--convert-to", "pdf", "--outdir", dir, `${dir}/${file}.docx`], { stdio: "ignore" });
    assert(fs.existsSync(`${dir}/${file}.pdf`), `LibreOffice did not write ${file}.pdf`);
    console.log(`pdf: ${dir}/${file}.pdf`);
    // automatic layout checks on what LibreOffice actually laid out
    const lines = execFileSync("pdftotext", ["-layout", `${dir}/${file}.pdf`, "-"], { encoding: "utf8" }).split("\n");
    assert(!lines.some((l) => /^\s*[●•▪◦]\s*$/.test(l)), `${file}: an empty bullet was laid out`);
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
