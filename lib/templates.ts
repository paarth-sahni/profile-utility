import type { TemplateId } from "./schemas";

export interface TemplateMeta {
  id: TemplateId;
  name: string;
  description: string;
  highlights: string[];
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "external",
    name: "External Profile",
    description:
      "Client-facing single-column profile: overview, education, skills, tools/certifications, numbered projects and an employment history section.",
    highlights: ["Single column", "Projects + Experience sections", "Skills as comma list"],
  },
  {
    id: "internal",
    name: "Internal Profile",
    description:
      "Internal two-column profile: detailed projects with tools, team size, role and link on the left; skills with ratings, certifications, tools, managerial experience, domains and languages in the sidebar.",
    highlights: ["Two columns", "Skill ratings (x/5)", "Domains & languages sidebar"],
  },
];
