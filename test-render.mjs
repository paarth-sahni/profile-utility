import fs from "node:fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const external = {
  name: "Jane Doe",
  jobTitle: "Lead Engineer",
  experienceSummary: "8+ years of Industry Experience",
  specialization: "Cloud Platforms",
  overview: "Seasoned engineer with broad platform experience.",
  education: [
    { year: "2015", qualification: "M.Tech (CS), IIT Delhi" },
    { year: "2012", qualification: "B.E. (IT), RGPV Bhopal" },
  ],
  skills: "AWS, Terraform, Go",
  tools: "JIRA, GIT",
  certifications: "AWS SA Pro, CKA",
  projects: [
    { number: 1, duration: "Jan 2022 - Dec 2022", client: "Acme Corp", teamSize: "6", role: "Tech Lead", description: "Migrated workloads to AWS.", responsibilities: ["Led migration.", "Cut costs 30%."] },
    { number: 2, duration: "Mar 2021 - Nov 2021", client: "Globex", teamSize: "4", role: "Developer", description: "Built data pipeline.", responsibilities: ["Designed ETL.", "Automated reports."] },
  ],
  experience: [
    { company: "Accenture", position: "Senior Engineer", duration: "2020 - Present", highlights: ["Shipped platform v2.", "Mentored 5 engineers."] },
    { company: "Infosys", position: "Engineer", duration: "2015 - 2020", highlights: ["Built APIs.", "Improved uptime."] },
  ],
};

const internal = {
  name: "Jane Doe",
  jobTitle: "Lead Engineer",
  experienceSummary: "8+ years of Industry Experience",
  specialization: "Cloud Platforms",
  overview: "Seasoned engineer with broad platform experience.",
  education: [
    { year: "2015", qualification: "M.Tech (CS), IIT Delhi" },
    { year: "2012", qualification: "B.E. (IT), RGPV Bhopal" },
  ],
  projects: [
    { number: 1, duration: "Jan 2023 - Dec 2023", title: "Payments Platform", toolsAndTechnologies: "Go, Postgres, K8s", teamSize: "6", role: "Tech Lead", projectLink: "NDA", description: "Built a payments platform.", responsibilities: ["Led design.", "Shipped v1."] },
    { number: 2, duration: "Feb 2022 - Nov 2022", title: "Analytics Hub", toolsAndTechnologies: "Python, Spark", teamSize: "3", role: "Developer", projectLink: "https://example.com", description: "Built analytics hub.", responsibilities: ["Built ETL.", "Created dashboards."] },
  ],
  skills: [
    { name: "Go", rating: "4.5" },
    { name: "AWS", rating: "4" },
    { name: "React", rating: "3.5" },
  ],
  certifications: ["AWS SA Pro", "CKA"],
  tools: "JIRA, GIT",
  managerialExperience: ["Project Management", "Team Building"],
  domains: ["Fintech", "Healthcare"],
  languages: ["English", "Hindi"],
};

// mirror prepareData: hasProjects hides the internal "Projects" heading; hasYear/hasTeamSize/
// hasProjectLink let the templates drop a blank OR "N/A" optional field (title + value + gap).
const isNA = (v) => /^n\/?a$/i.test(String(v).trim());
const hasReal = (v) => !!String(v).trim() && !isNA(v);
const prep = (id, data) => {
  if (id === "internal") {
    return {
      ...data,
      hasProjects: data.projects.length > 0,
      projects: data.projects.map((p) => ({
        ...p,
        teamSize: hasReal(p.teamSize) ? p.teamSize : "",
        hasTeamSize: hasReal(p.teamSize),
        projectLink: hasReal(p.projectLink) ? p.projectLink : "",
        hasProjectLink: hasReal(p.projectLink),
        hasDuration: !!String(p.duration).trim(),
      })),
    };
  }
  return {
    ...data,
    projects: data.projects.map((p) => ({ ...p, teamSize: hasReal(p.teamSize) ? p.teamSize : "", hasTeamSize: hasReal(p.teamSize) })),
  };
};

function render(id, data) {
  const zip = new PizZip(fs.readFileSync(`public/templates/${id}.docx`));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  try {
    doc.render(prep(id, data));
  } catch (e) {
    console.error(`${id}: RENDER FAILED`);
    console.error(JSON.stringify(e.properties?.errors?.map((x) => x.properties) ?? e.message, null, 2));
    process.exit(1);
  }
  const xml = doc.getZip().file("word/document.xml").asText();
  const leftover = xml.replace(/<[^>]+>/g, "").match(/\{[^}]*\}/g);
  if (leftover) {
    console.error(`${id}: leftover tags: ${leftover}`);
    process.exit(1);
  }
  fs.writeFileSync(`/tmp/out-${id}.docx`, doc.getZip().generate({ type: "nodebuffer" }));
  return xml.replace(/<[^>]+>/g, "");
}

for (const [id, data] of [["external", external], ["internal", internal]]) {
  render(id, data);
  console.log(`${id}: rendered OK, leftover tags: none`);
}

// empty-projects case: the internal "Projects" heading must be fully omitted
const internalText = render("internal", { ...internal, projects: [] });
if (/Projects/.test(internalText)) {
  console.error("internal(empty projects): 'Projects' heading should be omitted but was found");
  process.exit(1);
}
render("external", { ...external, projects: [] }); // must still render (shared Projects/Experience heading)
console.log("empty-projects: internal heading omitted, external OK");

// optional-field omission: a blank / "N/A" optional field must drop its title too, not just the value.
const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } };

// external: Tools and Certifications must be two separate sections with their own data
// (regression: the source's combined "Tools/Certifications" section rendered "undefined").
{
  const t = render("external", external);
  assert(/Tools/.test(t) && /Certifications/.test(t), "external: 'Tools' and 'Certifications' headings must both render");
  assert(!/Tools\/Certifications/.test(t), "external: combined 'Tools/Certifications' heading must be gone");
  assert(/JIRA, GIT/.test(t), "external: tools data must render under Tools");
  assert(/AWS SA Pro, CKA/.test(t), "external: certifications data must render under Certifications");
  assert(!/undefined/.test(t), "external: no field should render as 'undefined'");
}

// external: project duration appears in the heading, like internal ("Project N - <duration>")
assert(/Project 1 - Jan 2022 - Dec 2022/.test(render("external", external)), "external: project heading must include the duration");

// present-case sanity: labels show when the values are real
assert(/Team Size/.test(render("external", external)), "external: 'Team Size' should show when provided");
{
  const t = render("internal", internal);
  assert(/Team Size/.test(t), "internal: 'Team Size' should show when provided");
  assert(/Project Link/.test(t), "internal: 'Project Link' should show when provided");
}

// external: teamSize "N/A" and blank both drop the "Team Size" heading
for (const v of ["N/A", "  ", "na"]) {
  const t = render("external", { ...external, projects: external.projects.map((p) => ({ ...p, teamSize: v })) });
  assert(!/Team Size/.test(t), `external: 'Team Size' heading must be omitted when teamSize is ${JSON.stringify(v)}`);
}
// internal: teamSize + projectLink "N/A"/blank drop their headings
for (const v of ["N/A", "", "na"]) {
  const t = render("internal", { ...internal, projects: internal.projects.map((p) => ({ ...p, teamSize: v, projectLink: v })) });
  assert(!/Team Size/.test(t), `internal: 'Team Size' heading must be omitted when teamSize is ${JSON.stringify(v)}`);
  assert(!/Project Link/.test(t), `internal: 'Project Link' heading must be omitted when projectLink is ${JSON.stringify(v)}`);
}
console.log("optional-field omission: titles dropped for blank/N/A, shown when provided");
console.log("done");
