import fs from "node:fs";
import { buildResumePdf, type PdfAssets } from "./lib/pdf";
import type { ExternalResume, InternalResume } from "./lib/schemas";

const assets: PdfAssets = {
  lexendLight: fs.readFileSync("public/fonts/LexendLight-regular.ttf"),
  lexend: fs.readFileSync("public/fonts/Lexend-regular.ttf"),
  lexendMedium: fs.readFileSync("public/fonts/LexendMedium-regular.ttf"),
  logoPng: fs.readFileSync("public/img/logo.png"),
};

const external: ExternalResume = {
  name: "Amit Dave",
  jobTitle: "Senior Project Lead",
  experienceSummary: "3+ years of Industry Experience",
  specialization: "ServiceNow ITSM",
  overview:
    "ServiceNow professional with 3+ years of industry experience specializing in IT Service Management (ITSM). Skilled in ServiceNow development, configuration, customization, and implementation of ITSM modules. Experienced in requirement analysis, workflow automation, incident, problem, change, and service request management. Proficient in collaborating with cross-functional teams to deliver scalable solutions and enhance operational efficiency.",
  education: [{ year: "2008", qualification: "Bachelor of Engineering (IT), RGPV Bhopal" }],
  skills: ["Java script", "WordPress", "MYSQL", "MongoDB", "MVC(CodeIgniter, Laravel, YII, CakePHP)", "HTML5 & CSS", "jQuery & JavaScript", "NodeJS", "ReactJS", "Client Interaction", "Team Management"],
  tools: ["JIRA", "SVN", "GIT"],
  certifications: ["ServiceNow CSA"],
  projects: [
    {
      duration: "Jan 2021 - Dec 2021",
      client: "Bharti Airtel, Africa",
      teamSize: "5",
      role: "Developer and Tester",
      description:
        "Worked on a client project involving report mapping and simple report generation using Crystal Reports. Performed end-to-end testing based on use cases designed per the customization. Used Citrix tool, worked on SMSB tool, and executed queries using Interactive SQL.",
      responsibilities: [
        "Worked on report mapping and report generation using Crystal Reports.",
        "Designed and executed test cases for customized client requirements.",
        "Performed end-to-end application testing and validation.",
        "Utilized Citrix and SMSB tools for project execution and support activities.",
        "Executed SQL queries using Interactive SQL for data validation and analysis.",
      ],
    },
    {
      duration: "Feb 2022 - Present",
      client: "Globex Retail, EU",
      teamSize: "8",
      role: "Senior Developer",
      description: "Built a retail analytics platform with near-real-time dashboards for store operations across 12 countries.",
      responsibilities: [
        "Designed the event ingestion pipeline handling 2M events/day.",
        "Implemented dashboard widgets and alerting rules.",
        "Mentored three junior developers on code quality.",
      ],
    },
  ],
  experience: [
    {
      company: "Accenture",
      position: "ServiceNow Developer",
      duration: "2023 - Present",
      highlights: [
        "Configured and customized ITSM, HRSD, and ITBM modules to improve workflow efficiency by 40%.",
        "Streamlined HR operations by implementing HRSD modules, reducing case resolution time by 30%.",
        "Applied ITIL best practices to boost incident resolution and overall system efficiency.",
        "Integrated ServiceNow HRSD with Workday/SuccessFactors, enhancing data accuracy and cutting onboarding delays by 25%.",
        "Developed business rules, client scripts, and UI policies to enhance performance and user experience.",
        "Built UI policies, data policies, custom tables, reports, dashboards, and UI actions.",
        "Configured SLAs, notifications, and layouts for an optimized user experience.",
        "Automated Service Catalog processes, reducing manual efforts by 50%.",
      ],
    },
    {
      company: "Infosys",
      position: "Software Engineer",
      duration: "2019 - 2023",
      highlights: ["Built REST APIs for retail clients.", "Improved CI pipeline times by 35%.", "Led migration from SVN to GIT."],
    },
  ],
};

const internal: InternalResume = {
  name: "Amit Dave",
  jobTitle: "Senior Project Lead",
  experienceSummary: "3+ years of Industry Experience",
  specialization: "ServiceNow ITSM",
  overview: external.overview,
  education: external.education,
  projects: [
    {
      duration: "Feb 2020 - June 2020",
      title: "National College Admissions Consulting site",
      toolsAndTechnologies: ["Node", "HTML", "MySQL", "CSS", "React", "PayPal"],
      teamSize: "3",
      role: "Project Lead",
      projectLink: "NDA",
      description:
        "Developed a web-based college admissions consulting platform that connects students with experienced former admissions officers from leading universities for personalized application reviews and guidance. The platform enables users to explore consulting services, submit requests, and securely complete transactions online.",
      responsibilities: [
        "Led end-to-end development of a college admissions consulting platform.",
        "Developed frontend and backend modules using React, Node.js, and MySQL.",
        "Integrated PayPal payment gateway for secure online transactions.",
        "Designed responsive user interfaces and optimized user experience.",
        "Managed project delivery, task allocation, and team coordination.",
        "Collaborated with stakeholders to gather and implement requirements.",
        "Conducted testing, bug fixes, and production deployments.",
      ],
    },
    {
      duration: "Nov 2019 - Jan 2020",
      title: "Aerospace Hub site",
      toolsAndTechnologies: ["Node", "HTML", "MySQL", "CSS", "React"],
      teamSize: "3",
      role: "Project Lead",
      projectLink: "NDA",
      description:
        "Developed a web-based platform for the aviation and aerospace industry, designed to support industry growth, collaboration, and innovation. The platform serves as a digital hub for aerospace-related initiatives.",
      responsibilities: [
        "Led end-to-end development of the aerospace industry platform.",
        "Built frontend and backend functionalities using React, Node.js, and MySQL.",
        "Developed responsive and user-friendly interfaces.",
        "Managed project planning, delivery, and team coordination.",
        "Performed testing, bug fixes, and deployment activities.",
      ],
    },
  ],
  skills: [
    { name: "Java script", rating: "3.5" },
    { name: "WordPress", rating: "3.7" },
    { name: "MYSQL", rating: "4" },
    { name: "MongoDB", rating: "3.5" },
    { name: "MVC(CodeIgniter, Laravel, YII, CakePHP)", rating: "3.5" },
    { name: "HTML5 & CSS", rating: "3.9" },
    { name: "jQuery & JavaScript", rating: "3.8" },
    { name: "NodeJS", rating: "3.8" },
    { name: "ReactJS", rating: "3.8" },
    { name: "Client Interaction", rating: "3.8" },
    { name: "Team Management", rating: "4" },
  ],
  certifications: ["ServiceNow ITSM"],
  tools: ["JIRA", "SVN", "GIT"],
  managerialExperience: ["Timeline & Efforts Estimation", "Project Management", "Team Building", "Certified Scrum Master"],
  domains: ["Healthcare", "POS System", "E-commerce"],
  languages: ["English", "Hindi"],
};

const ext = await buildResumePdf("external", external, assets);
fs.writeFileSync("/tmp/test-external.pdf", ext);
const int = await buildResumePdf("internal", internal, assets);
fs.writeFileSync("/tmp/test-internal.pdf", int);
console.log("external:", ext.length, "bytes | internal:", int.length, "bytes");
