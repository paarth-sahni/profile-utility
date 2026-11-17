import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyHeading, describeAchievementSections, findAchievementSections, itemInSource, itemKey, MAX_ACHIEVEMENT_LINES, sameItem, splitItems } from "./achievements";

// Fictional resumes only. Text is shaped like lib/extractText.ts output: one line per heading / bullet, Word list items as "- ".
const resume = (...lines: string[]) => lines.join("\n");

test("heading: every wording variant, case and decoration is recognised as a surely-achievements heading (tier 1)", () => {
  const cases: [string, string][] = [
    ["Achievements", "Achievements"],
    ["ACHIEVEMENTS", "ACHIEVEMENTS"],
    ["Key Achievements", "Key Achievements"],
    ["Notable Achievements:", "Notable Achievements"],
    ["Professional Achievements", "Professional Achievements"],
    ["Major Accomplishments", "Major Accomplishments"],
    ["Accomplishments", "Accomplishments"],
    ["Key Accomplishments", "Key Accomplishments"],
    ["Awards", "Awards"],
    ["AWARDS", "AWARDS"],
    ["Awards & Recognition", "Awards & Recognition"],
    ["Awards and Honors", "Awards and Honors"],
    ["Honours & Awards", "Honours & Awards"],
    ["Honors", "Honors"],
    ["Recognition", "Recognition"],
    ["Accolades", "Accolades"],
    ["ACHIEVEMENTS & AWARDS", "ACHIEVEMENTS & AWARDS"],
    ["Awards Received", "Awards Received"],
    ["Personal Achievements", "Personal Achievements"],
    ["5. Awards", "Awards"],
    ["=== AWARDS ===", "AWARDS"],
    ["  Awards   &   Recognition  ", "Awards & Recognition"],
    ["Awards, Honours and Recognition", "Awards, Honours and Recognition"],
  ];
  for (const [line, heading] of cases) {
    const c = classifyHeading(line);
    assert.ok(c, `"${line}" should be a heading`);
    assert.equal(c.tier, 1, line);
    assert.equal(c.heading, heading, line);
  }
});

test("heading: Highlights and Activities headings are only possibly achievements (tier 2)", () => {
  for (const line of ["Highlights", "Key Highlights", "Career Highlights", "PROFESSIONAL HIGHLIGHTS", "Achievements & Activities"]) {
    const c = classifyHeading(line);
    assert.ok(c && c.tier === 2, line);
  }
});

test("heading: NEGATIVES that must not match", () => {
  for (const line of [
    "Rewards programme",
    "Won several awards in 2019.",
    "Awards were given to the whole team",
    "Key Responsibilities",
    "Certifications",
    "Awards and Certifications", // mixed with another section
    "Publications and Awards",
    "Project Highlights",
    "Highlights of Qualifications",
    "Experience",
    "Skills",
    "achievements", // lower case: the middle of a sentence, not a heading
    "- Awards", // a bullet is an item
    "• Achievements",
    "Employee of the Year 2021",
    "Built a platform that won an award for the best claims automation across the group", // far too long
    "",
  ]) {
    assert.equal(classifyHeading(line), null, `"${line}" must not be a heading`);
  }
});

test("section: bulleted list between two known sections", () => {
  const out = findAchievementSections(
    resume("Jane Doe", "Senior Engineer", "", "EXPERIENCE", "Acme Corp", "- Built things", "", "ACHIEVEMENTS", "- Won the Employee of the Year award 2021", "- Led a migration that saved 30% cost", "- Speaker at DevCon 2020", "", "EDUCATION", "B.E. 2012"),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].heading, "ACHIEVEMENTS");
  assert.equal(out[0].tier, 1);
  assert.equal(out[0].bulleted, true);
  assert.deepEqual(out[0].items, ["Won the Employee of the Year award 2021", "Led a migration that saved 30% cost", "Speaker at DevCon 2020"]);
});

test("section: a plain list with no bullets is one item per line", () => {
  const out = findAchievementSections(resume("AWARDS", "Employee of the Year 2021", "Best Team Lead, Q3 2020", "Innovation Award for the claims platform", "SKILLS", "Java"));
  assert.equal(out.length, 1);
  assert.equal(out[0].bulleted, false);
  assert.deepEqual(out[0].items, ["Employee of the Year 2021", "Best Team Lead, Q3 2020", "Innovation Award for the claims platform"]);
});

test("section: wrapped bullets are joined to their item", () => {
  const out = findAchievementSections(
    resume("Achievements", "- Reduced the monthly close from ten days to", "  four days across three business units", "- Mentored twelve engineers", "Education", "B.E."),
  );
  assert.deepEqual(out[0].items, ["Reduced the monthly close from ten days to four days across three business units", "Mentored twelve engineers"]);
});

test("section: numbered lines, bullet symbols and Word list dashes all count as bullets", () => {
  const numbered = findAchievementSections(resume("Awards", "1. Award A for delivery", "2. Award B for quality", "3) Award C for leadership"));
  assert.deepEqual(numbered[0].items, ["Award A for delivery", "Award B for quality", "Award C for leadership"]);
  const symbols = findAchievementSections(resume("Accomplishments", "• Shipped the platform", "● Cut costs by a third", "▪ Trained the new team"));
  assert.deepEqual(symbols[0].items, ["Shipped the platform", "Cut costs by a third", "Trained the new team"]);
  assert.equal(symbols[0].bulleted, true);
});

test("section: an intro line ending in a colon is not an item", () => {
  const out = findAchievementSections(resume("Achievements", "Won the following awards:", "- Best Manager 2020", "- Innovator of the Year 2022"));
  assert.deepEqual(out[0].items, ["Best Manager 2020", "Innovator of the Year 2022"]);
});

test("section: two achievement sections are both collected, in resume order", () => {
  const out = findAchievementSections(resume("AWARDS", "- Award one", "- Award two", "EDUCATION", "B.E.", "ACHIEVEMENTS", "- Achievement one", "- Achievement two"));
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.heading), ["AWARDS", "ACHIEVEMENTS"]);
  assert.deepEqual(out[1].items, ["Achievement one", "Achievement two"]);
});

test("section: at the very end of the resume, and with a column marker after it", () => {
  assert.deepEqual(findAchievementSections(resume("EXPERIENCE", "Acme", "Honours", "- First honour", "- Second honour"))[0].items, ["First honour", "Second honour"]);
  const marked = findAchievementSections(resume("Awards", "- Alpha award", "- Beta award", "--- SIDEBAR ---", "Java", "Go"));
  assert.deepEqual(marked[0].items, ["Alpha award", "Beta award"]);
});

test("section: page numbers inside the section are not items", () => {
  const out = findAchievementSections(resume("Awards", "- Alpha award", "Page 2 of 3", "- Beta award", "3"));
  assert.deepEqual(out[0].items, ["Alpha award", "Beta award"]);
});

test("section: achievements written inside a job's own bullets are NOT taken", () => {
  assert.deepEqual(findAchievementSections(resume("EXPERIENCE", "Acme Corp", "- Achievements: won the award for best team", "- Built the claims platform", "EDUCATION", "B.E.")), []);
});

test("section: tier 2 (Key Highlights) is found and marked as the weaker kind", () => {
  const out = findAchievementSections(resume("KEY HIGHLIGHTS", "- Ten years in insurance technology", "- Led teams of up to 40", "EXPERIENCE", "Acme"));
  assert.equal(out[0].tier, 2);
  assert.equal(out[0].items.length, 2);
});

test("section: a heading with no items gives nothing, and a runaway block is capped", () => {
  assert.deepEqual(findAchievementSections(resume("Awards", "Education", "B.E.")), []);
  const many = findAchievementSections(resume("Achievements", ...Array.from({ length: 100 }, (_, i) => `- Item number ${i + 1}`)));
  assert.equal(many[0].items.length, MAX_ACHIEVEMENT_LINES);
});

test("section: no heading at all gives nothing, even if the words appear in sentences", () => {
  assert.deepEqual(findAchievementSections(resume("Jane Doe", "She won several awards and accomplishments during her career.", "SKILLS", "Java")), []);
});

test("splitItems: plain lines continue when the next starts lower case or the last ends with a comma / 'and'", () => {
  const { items } = splitItems(["Best Manager of the year for the", "claims division in 2020", "Innovation Award,", "Group Level 2021", "Employee of the Month"]);
  assert.deepEqual(items, ["Best Manager of the year for the claims division in 2020", "Innovation Award, Group Level 2021", "Employee of the Month"]);
});

test("sameItem: exact, case and punctuation differences, containment and near-equal wording are the same; others are not", () => {
  assert.ok(sameItem("Employee of the Year 2021", "employee of the year, 2021"));
  assert.ok(sameItem("Won the Employee of the Year award 2021", "Employee of the Year award 2021"));
  assert.ok(sameItem("Led a migration that saved 30% of the cost", "Led a migration which saved 30% cost of the"));
  assert.ok(!sameItem("Employee of the Year 2021", "Best Team Lead 2020"));
  // the same wording with a different number is a different achievement (never merged)
  assert.ok(!sameItem("Awarded for outstanding delivery of the claims platform 2021", "Awarded for outstanding delivery of the claims platform 2022"));
  assert.ok(!sameItem("Employee of the Quarter Q1 2021", "Employee of the Quarter Q2 2021"));
  assert.ok(sameItem("Awarded for delivery of the claims platform in 2021", "Delivery of the claims platform awarded 2021")); // same numbers, reworded
  assert.ok(!sameItem("", "x"));
  assert.equal(itemKey("  A-B  c!! "), "a b c");
});

test("itemInSource: a phrase or a near-identical line is found; an invented one is not", () => {
  const src = resume("AWARDS", "- Employee of the Year 2021", "- Best Team Lead, Q3 2020");
  assert.ok(itemInSource("Employee of the Year 2021", src));
  assert.ok(itemInSource("best team lead q3 2020", src));
  assert.ok(!itemInSource("Won the national innovation prize", src));
});

test("describeAchievementSections lists each heading and its items for the model", () => {
  const text = describeAchievementSections([{ heading: "Awards & Recognition", tier: 1, bulleted: true, items: ["One", "Two"] }]);
  assert.match(text, /Section headed "Awards & Recognition" \(2 items\)/);
  assert.match(text, /- One\n- Two/);
});
