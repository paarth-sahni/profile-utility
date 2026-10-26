/**
 * Purpose: fictional, fully filled profiles for the database tests. Every field is set, including the edge
 * cases storage must preserve: a range team size, an empty rating, no managerial items, multi-line text.
 * No real people. Used by supabase/tests/db.test.ts.
 */
import type { ExternalResume, InternalResume } from "../../lib/schemas";

export const INTERNAL_FIXTURE: InternalResume = {
  name: "Testy McSample",
  jobTitle: "Senior Software Engineer",
  experienceSummary: "8+ Years of experience in backend development",
  specialization: "Java and cloud platforms",
  overview: "First line of the overview.\nSecond line, after a line break.\n\nThird paragraph.",
  education: [{ year: "2014", qualification: "B.E. Computer Science" }],
  projects: [
    {
      duration: "Jan 2020 - Mar 2022",
      title: "Fictional Billing Platform",
      toolsAndTechnologies: ["Java", "Spring Boot", "PostgreSQL"],
      teamSize: "2-3",
      role: "Backend Lead",
      projectLink: "https://example.test/billing",
      description: "Built a billing service.\nHandled invoices and retries.",
      responsibilities: ["Designed the schema", "Reviewed pull requests"],
    },
    {
      duration: "Apr 2022 - Present",
      title: "Placeholder Analytics",
      toolsAndTechnologies: ["Python", "Redis"],
      teamSize: "5",
      role: "Developer",
      projectLink: "",
      description: "Single-line description.",
      responsibilities: ["Wrote ingestion jobs"],
    },
  ],
  skills: [
    { name: "Java", rating: "4.5" },
    { name: "SQL", rating: "" },
  ],
  certifications: ["Sample Cloud Associate"],
  tools: ["Git", "Docker"],
  managerialExperience: [],
  domains: ["Fintech", "Retail"],
  languages: ["English", "Hindi"],
};

export const EXTERNAL_FIXTURE: ExternalResume = {
  name: "Sample Q. Person",
  jobTitle: "Data Engineer",
  experienceSummary: "6+ Years of experience in data engineering",
  specialization: "Pipelines and warehousing",
  overview: "Overview line one.\nOverview line two.",
  education: [{ year: "2016", qualification: "M.Sc. Statistics" }],
  projects: [
    {
      duration: "2019 - 2021",
      client: "Fictional Retail Co",
      teamSize: "4-6",
      role: "Data Engineer",
      description: "Built nightly pipelines.\nMonitored them.",
      responsibilities: ["Wrote Airflow DAGs", "Tuned warehouse queries"],
    },
  ],
  experience: [
    {
      company: "Example Analytics Ltd",
      position: "Senior Data Engineer",
      duration: "2021 - Present",
      highlights: ["Cut batch time by half", "Mentored two juniors"],
    },
    { company: "Placeholder Systems", position: "Data Engineer", duration: "2017 - 2021", highlights: ["Built the first warehouse"] },
  ],
  skills: ["Python", "SQL", "Airflow"],
  tools: ["dbt", "Git"],
  certifications: ["Sample Data Professional"],
};

/** Only the required fields; every optional section is empty (the shape the DOCX leaves sections out for). */
export const MINIMAL_INTERNAL_FIXTURE: InternalResume = {
  name: "Minimal Person",
  jobTitle: "Engineer",
  experienceSummary: "",
  specialization: "",
  overview: "Just the overview.",
  education: [{ year: "2014", qualification: "B.E." }],
  projects: [],
  skills: [{ name: "Java", rating: "4" }],
  certifications: [],
  tools: [],
  managerialExperience: [],
  domains: [],
  languages: [],
};

export const MINIMAL_EXTERNAL_FIXTURE: ExternalResume = {
  name: "Minimal Candidate",
  jobTitle: "Analyst",
  experienceSummary: "",
  specialization: "",
  overview: "Just the overview.",
  education: [{ year: "2016", qualification: "M.Sc." }],
  skills: ["SQL"],
  tools: [],
  certifications: [],
  projects: [],
  experience: [],
};
