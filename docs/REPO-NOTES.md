# Repo Notes — InfoBeans Profile Generator

Written 2026-10-05 on branch `feature/auto-extract` (HEAD `c196e3a`). This is a read-only survey: nothing
in the code was changed. Everything below was read directly from the repo; the things I ran are listed
in [Verification done](#verification-done).

Contents: [1 What the app does](#1-what-the-app-does-end-to-end) · [2 Data flow](#2-data-flow) ·
[3 Internal vs External](#3-internal-vs-external) · [4 Word templates](#4-how-the-word-templates-are-filled) ·
[5 Build and deploy](#5-build-and-deploy-today) · [6 Template files](#6-which-files-in-publictemplates-are-used) ·
[7 Risks and dead code](#7-risks-bugs-dead-code-fragile-spots) · [8 Handover PDF mismatches](#8-where-the-handover-pdf-doesnt-match-this-repo)

---

## 0. Stack at a glance

| Thing | Value |
|---|---|
| Framework | Next.js **16.2.9** (App Router), React 19.2.4, TypeScript strict |
| Output | `output: "export"` (pure static site, no server) — [next.config.ts](../next.config.ts) |
| Styling | Tailwind v4 (`@theme` tokens in [app/globals.css](../app/globals.css)), Lexend via `next/font/google` |
| Validation | `zod` ^4 |
| DOCX | `docxtemplater` + `pizzip`, saved with `file-saver` |
| PDF | `pdf-lib` + `@pdf-lib/fontkit`, hand-written layout engine |
| DOCX preview | `docx-preview` (only used by `DocPreview`, which is not mounted — see §7) |
| Tests | none in a runner; two ad-hoc scripts: `test-render.mjs`, `test-pdf.mts` |
| Backend / DB / auth / env vars used by code | none (only `NEXT_PUBLIC_BASE_PATH`) |

`AGENTS.md` warns that this is a newer Next.js than expected. I checked
`node_modules/next/dist/docs/01-app/02-guides/static-exports.md` for the export behaviour the app relies on
(static HTML per route, `basePath` support, `redirect()` handled at build time, no rewrites/redirects/headers
in `next.config`).

---

## 1. What the app does, end to end

A browser-only tool that turns a candidate's details into a branded InfoBeans profile (`.docx`).
Two audiences, two routes, two Word templates. There is no server logic: the "LLM step" is done by the
user by hand in Gemini.

**User journey (both routes share [components/ProfileWorkflow.tsx](../components/ProfileWorkflow.tsx)):**

1. **Land.** `/` redirects to `/internal` ([app/page.tsx](../app/page.tsx)). `/external` is a separate URL that
   the nav only exposes once you're on it. `/instructions` redirects to `/internal/instructions`.
2. **Step 0 – Start.** Two cards (copy comes from the `START` map in `ProfileWorkflow.tsx`):
   - *Upload / Update existing* → shows the "prompt screen" (not an actual upload; see below).
   - *Create from scratch* → `startBlankForm()` loads `blankResume(templateId)` and jumps to step 2.
3. **Prompt screen.** "Copy LLM Prompt" copies `promptFor(templateId)` from [lib/prompts.ts](../lib/prompts.ts).
   The user pastes it into Gemini together with the resume PDF, and copies Gemini's JSON reply. Button
   "I Have the JSON →" goes to step 1.
4. **Step 1 – Paste JSON.** `validateJson()` runs `JSON.parse` then `schemaFor(templateId).safeParse()`. Errors
   are shown with human-readable paths via `describeFieldPath`. On success `setData(result.data)` and the app
   moves to step 2 with `fromScratch=false`.
5. **Step 2 – Review & Generate.** [InternalForm](../components/InternalForm.tsx) or
   [ExternalForm](../components/ExternalForm.tsx) edits the `data` object (add/remove/reorder items, remove
   optional sections). Pressing **DOCX ↓** calls `handleGenerate()`:
   re-validate with zod → `findNAIssues()` (blocks leftover "N/A" in mandatory fields) → `generateDocx()` →
   browser downloads `<Name>_<template>_profile.docx`.
6. **Step 3 – Submit (internal only).** After a successful download, "Continue to Submit" shows a link to a
   Google Form ([lib/constants.ts](../lib/constants.ts)) where the DOCX is uploaded by hand.

**Not in the UI today:** a PDF download button and the preview panel. `lib/pdf.ts`, `lib/pdfClient.ts` and
`components/DocPreview.tsx` exist and work in isolation, but nothing in `ProfileWorkflow.tsx` imports them
(confirmed with grep). The only "user can get a PDF" path today is through the test script. See §7.

Other pages: `/internal/instructions`, `/external/instructions` (static how-to text, [components/InstructionsContent.tsx](../components/InstructionsContent.tsx)),
`/style-guide` (embeds `public/style-guide/Style Guide.pdf` in an `<object>`).

---

## 2. Data flow

```
Gemini JSON (pasted)  ──►  JSON.parse  ──►  zod safeParse (lib/schemas.ts)  ──►  React state `data`
Blank form            ──►  blankResume(id) (lib/schemas.ts) ─────────────────────►  (same state)
                                         │
                       forms edit `data` immutably (onChange → setData)
                                         │
                      handleGenerate(): safeParse again + findNAIssues()
                                         │
                       generateDocx(id, result.data, fileName)   [lib/generate.ts]
                       └─ prepareData(id, data) → docxtemplater.render → Blob → saveAs
                       (PDF path, unused by UI:  buildResumePdf(id, data, assets) [lib/pdf.ts])
```

- **Where profile data lives:** only in React state (`useState<ResumeData | null>`) inside `ProfileWorkflow`.
  Not in `localStorage`, cookies, a database or the URL (grep for `localStorage|sessionStorage` finds nothing).
  Refreshing the page loses everything. `jsonText` (the pasted JSON) is also held in state.
- **Validation ([lib/schemas.ts](../lib/schemas.ts)):** `externalResumeSchema` and `internalResumeSchema` are the
  single source of truth for the shape; `ExternalResume` / `InternalResume` types come from `z.infer`.
  Rules worth knowing:
  - Most strings: `nonEmpty()` (trimmed, min 1). `teamSize` and `projectLink` are `looseText()` (anything, incl. blank).
  - `specialization`: max **5 words** (`maxWords`). The `Field` input also silently truncates to 5 words as you type.
  - `education`: array of **exactly 1**. Forms only edit `education[0]`.
  - Arrays that must be non-empty: skills, tools, certifications, experience (external); skills, certifications,
    tools, domains, languages, and each project's `toolsAndTechnologies` / `responsibilities` (internal).
    `projects` may be empty in both; internal `managerialExperience` may be empty.
  - "N/A" handling is **separate from the schema**: `isNAValue` (`/^n\/?a$/i`) and `findNAIssues()` run only just
    before DOCX generation, so the user can still reach the form to fix placeholders. `teamSize` / `projectLink`
    are exempt (they are dropped from the output instead).
  - `describeFieldPath()` + `FIELD_LABELS` / `SECTION_LABELS` turn zod paths into labels like "Project 1 → Duration".
  - `blankResume(id)` gives one empty entry per section so every form field renders.
  - `formatYearsExperience("4")` → `"4+ Years of Industry Experience"`; applied only for the **internal blank-form**
    route in `handleGenerate()` (external blank-form leaves `experienceSummary` as free text).
- **How data reaches `generate.ts`:** `handleGenerate()` passes the zod-parsed `result.data` into
  `generateDocx(templateId, data, fileName)` → `renderDocxBlob()` → `prepareData()`.
  `prepareData()` is the adapter between schema shape and template shape (see §4).
- **How data reaches `pdf.ts`:** `renderPdfBlob()` in [lib/pdfClient.ts](../lib/pdfClient.ts) loads fonts + logo once
  (cached promise), then calls `buildResumePdf(id, data, assets)`. **`pdf.ts` consumes the raw schema data**,
  not `prepareData()`'s output, so any DOCX-side mapping logic (comma-joins, "N/A" dropping) is re-implemented
  there (`hasRealValue`, `.join(", ")`). `pdf.ts` is pure (no browser APIs) so `test-pdf.mts` can run it in Node.
  Note that the PDF path would receive data that has **not** gone through `findNAIssues` unless a caller adds it.

---

## 3. How Internal and External differ

| | **Internal** | **External** |
|---|---|---|
| Route | `/internal` (default home) | `/external` |
| Audience | Employees refreshing their own profile | Sales/delivery producing client-facing candidate profiles |
| Layout | Two columns: projects left; skills (with ratings), certifications, tools, managerial experience, domains, languages in sidebar | Single column: overview, education, skills, tools, certifications, projects, experience |
| Margins (PDF) | 43pt (0.6") | 72pt (1") |
| Skills | `{name, rating}` objects, rendered "(3.8/5)" | plain strings, comma-joined |
| Projects | `title`, `toolsAndTechnologies[]`, `teamSize`, `role`, `projectLink`, `description`, `responsibilities[]` | `client`, `teamSize`, `role`, `description`, `responsibilities[]` |
| Employment history | none | `experience[]` (company, position, duration, highlights[]) |
| Extra fields | `managerialExperience`, `domains`, `languages` | none |
| Steps | 4 (Start, Provide data, Review & Generate, **Submit**) | 3 |
| Blank-form summary | number-only field → "N+ Years…" (`fromScratch`) | free text |
| Submission | Google Form link in nav and step 3 | none |

**Files that are template-specific:**
- Pages: [app/internal/page.tsx](../app/internal/page.tsx), [app/external/page.tsx](../app/external/page.tsx) (+ `/instructions` pair). Each is a 3-line wrapper passing `audience`.
- Forms: [components/InternalForm.tsx](../components/InternalForm.tsx), [components/ExternalForm.tsx](../components/ExternalForm.tsx).
- Schemas: the two halves of [lib/schemas.ts](../lib/schemas.ts) (`schemaFor(id)` picks one).
- Prompts: `INTERNAL_*` / `EXTERNAL_*` constants in [lib/prompts.ts](../lib/prompts.ts).
- DOCX mapping: the two branches of `prepareData()` in [lib/generate.ts](../lib/generate.ts), plus `public/templates/{internal,external}.docx`.
- PDF: `renderInternal()` / `renderExternal()` in [lib/pdf.ts](../lib/pdf.ts).
- Copy: `START`, `HERO_SUBTEXT`, `STEP_LABELS` in `ProfileWorkflow.tsx`; `showInternal` / `showExternal` blocks in `InstructionsContent.tsx`.
- [lib/templates.ts](../lib/templates.ts) (`TEMPLATES` metadata) — **not imported anywhere** (see §7).

**Shared:** `ProfileWorkflow`, `fields.tsx`, `Stepper`, `SiteNav`, `Footer`, `InstructionsContent`, `DocPreview`, `generate.ts` / `pdf.ts` entry points, `schemas.ts` helpers.

---

## 4. How the Word templates are filled

**Mechanism:** [lib/generate.ts](../lib/generate.ts) fetches `${BASE}/templates/${id}.docx` at click time (so the
template is a runtime static asset, not bundled), opens it with `PizZip`, and renders it with
`new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })` then `doc.render(prepareData(id, data))`.
The result is a Blob saved with `file-saver`. Errors from docxtemplater are unwrapped by `explainError()` into a
bullet list shown on the page.

**Placeholders actually present in the live templates** (extracted from `word/document.xml`; headers/footers have none):

- `external.docx`: `{name} {jobTitle} {experienceSummary} {specialization} {overview} {skills} {tools} {certifications}`,
  loops `{#education}{year}{qualification}{/education}`, `{#projects}{number} {duration} {client} {role} {description}`
  + `{#hasTeamSize}{teamSize}{/hasTeamSize}` + `{#responsibilities}{.}{/responsibilities}{/projects}`,
  `{#experience}{company} {position} {duration} {#highlights}{.}{/highlights}{/experience}`.
- `internal.docx`: the same header fields plus `{#hasProjects}` (wraps the "Projects" heading and loop),
  `{#projects}{number} {duration} {title} {toolsAndTechnologies} {role}` with `{#hasTeamSize}{teamSize}`,
  `{#hasProjectLink}{projectLink}`, `{#responsibilities}{.}`; sidebar `{#skills}{name}{rating}`,
  `{#certifications}{.}`, `{tools}`, `{#managerialExperience}{.}`, `{#domains}{.}`, `{#languages}{.}`.

**`prepareData()` conversions** (the contract between schema and template):
- External: `skills`, `tools`, `certifications` → comma-joined strings. Each project gets `number = i+1`,
  `teamSize` blanked if empty/"N/A", and `hasTeamSize` boolean.
- Internal: `tools` joined; `hasProjects`; per project `number`, `toolsAndTechnologies` joined, `teamSize`/`projectLink`
  blanked if empty/"N/A" with `hasTeamSize` / `hasProjectLink`, and `hasDuration` (**not used by the live template**, see §7).
- Section/label omission is done with boolean conditional sections (`{#hasX}…{/hasX}`) wrapped around the *label
  paragraph and the value paragraph* so a hidden optional field leaves no orphan title.

**Provenance:** the tagged templates were produced by a Python script (`tag_templates.py`, paraId-keyed rules) that
inserts tags into the original InfoBeans Word files' XML. That script and the originals are **not in this repo** (README says
they live in the parent folder; the parent folder here contains only `profile/` and an unrelated `db-wrapper-rag/`).

**What breaks them:**
1. **Retyping or reformatting tagged paragraphs in Word.** Word splits `{tag}` across XML runs when you edit/format
   it, and docxtemplater then throws "duplicate/unclosed tag" errors (surfaced via `explainError`). Safe edits: change
   styling of the whole paragraph without retyping the braces; or regenerate with the tagging script.
2. **A schema field with no tag** is silently dropped from the output (the form collects it, the document ignores it).
   Conversely a tag with no data renders empty (docxtemplater default; with no `nullGetter` set) — historically `undefined` showed up for a combined
   "Tools/Certifications" heading (regression comment in `test-render.mjs`).
3. **Renaming a field in `schemas.ts` without updating `prepareData()` and the template.** Three places must change together (schema, form, template) — plus `prompts.ts`, `pdf.ts` and `test-*` scripts.
4. **Moving/renaming `public/templates/external.docx` / `internal.docx`.** The filename is built from the template id (`${id}.docx`), so these two names are load-bearing.
5. **Wrong `NEXT_PUBLIC_BASE_PATH`** → template fetch 404 → "Could not load template…" at the last step (page itself still looks healthy).
6. **Paragraph loops:** `paragraphLoop: true` means a loop tag sitting alone in its paragraph removes that paragraph; putting extra text in the same paragraph changes the output.

`node test-render.mjs` renders both templates with sample data and checks for leftover `{…}` text, omitted
headings and N/A handling. It passes today. **Caveat:** its `prep()` is a hand-copied mirror of `prepareData()`, so it
can drift from the real function.

---

## 5. Build and deploy today

- **Build:** `npm run build` → `next build` with `output: "export"` → static site in `out/` (gitignored). Routes
  pre-rendered: `/`, `/external`, `/external/instructions`, `/instructions`, `/internal`, `/internal/instructions`,
  `/style-guide`, `/_not-found`. The only scripts in `package.json` are `dev`, `build`, `start` (no lint, no test, no `build:internal`).
- **basePath:** `next.config.ts` reads `NEXT_PUBLIC_BASE_PATH` (default `""`) and sets both `basePath` and `assetPrefix`.
  Because it's a `NEXT_PUBLIC_` var it is **inlined at build time**, and the same variable is read manually in
  `lib/generate.ts`, `lib/pdfClient.ts`, `components/SiteNav.tsx` and `app/style-guide/page.tsx` to prefix `fetch()` /
  `<img>` / `<a>` URLs that Next doesn't rewrite automatically.
- **CI/CD:** [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — on push to `main` (or manual dispatch):
  checkout → Node 20 → `npm ci` → `npm run build` with `NEXT_PUBLIC_BASE_PATH=/${{ github.event.repository.name }}` →
  `configure-pages` → upload `out/` → `deploy-pages`. So it publishes to **GitHub Pages under `/<repo-name>/`**.
- **Local dev:** `npm run dev`. a local `.env.local` is expected to hold `GROQ_API_KEY` (git-ignored by `.env*`);
  **no code reads it yet** — it's for the planned TASK-01.
- **Planned change (not applied):** [docs/tasks/TASK-01-auto-extract.md](tasks/TASK-01-auto-extract.md) would drop
  `output: "export"` for `output: "standalone"`, rename `deploy.yml` to `.disabled`, add `app/api/extract/route.ts`
  calling Groq, and replace the paste-JSON UI with an upload screen. That is a **fundamental deployment change**
  (static files → Node process behind nginx) and conflicts with the static-only assumptions in the handover (§8).

---

## 6. Which files in `public/templates` are used

Code only ever loads `${id}.docx` with `id ∈ {"internal","external"}` (grep: `lib/generate.ts:79`, `test-render.mjs:80`).

| File | Status | Notes |
|---|---|---|
| `internal.docx` | **USED** | live internal template; byte-identical to `internal_13J.docx` (same md5) |
| `external.docx` | **USED** | live external template; differs slightly from `external_13J.docx` |
| `internal_13J.docx` | unused | identical copy of `internal.docx` (a dated snapshot) |
| `external_13J.docx` | unused | near-copy of `external.docx` (word/document.xml 12 bytes smaller) |
| `internal_july_10.docx`, `internal_latest.docx` | unused | older iterations; have `{#hasProjects}` but not `hasTeamSize` / `hasProjectLink` |
| `internal_1.docx`, `internal_xyz.docx` | unused | identical to each other (same md5); older, no conditional tags |
| `internal_2.docx`, `internal__.docx`, `internal_x.docx`, `internal_xy.docx` | unused | older iterations, no conditional tags |
| `external_1.docx`, `external_x.docx` | unused | older iterations without `hasTeamSize` |
| `internal.textClipping` | unused junk | macOS clipping file (195 bytes) accidentally committed |

That's 12 unused `.docx` plus one `.textClipping`, ~6.3 MB of the repo; every one of them is also copied into the
deployed `out/templates/` and so ships to the public site. They match the handover's claim that only the two
canonical files are used.

Other `public/` contents: `fonts/` (Lexend Light/Regular/Medium TTFs used by the PDF; **`Lexend-bold.ttf` is not referenced**),
`img/logo.png` (nav + PDF), `style-guide/Style Guide.pdf`, and the five Next starter SVGs (`file.svg`, `globe.svg`,
`next.svg`, `vercel.svg`, `window.svg`; unused).

---

## 7. Risks, bugs, dead code, fragile spots

Not fixed — just listed. Roughly ordered by impact.

### Functional / behavioural
1. **PDF export and preview are not reachable from the UI.** `ProfileWorkflow` only has a "DOCX ↓" button; `DocPreview`,
   `pdfClient`, `generatePdf` are never imported. README and handover both say users can download PDF and see a preview.
   TASK-01 acceptance says "Generate DOCX and PDF both work" — currently PDF can't be triggered in the app.
2. **DOCX and PDF disagree on empty "Managerial Experience".** In `internal.docx` the heading "Managerial Experience" is
   *outside* the `{#managerialExperience}` loop, so with an empty list the heading still prints with nothing under it.
   `pdf.ts` hides the heading when the list is empty. (`hasProjects` is correctly wrapped, so "Projects" is fine.)
3. **Blank internal form can't be generated without extra clicks.** `blankResume("internal")` seeds `managerialExperience: [""]`,
   a project with empty required fields, etc.; `internalResumeSchema` rejects empty-string items, so the user must remove the
   optional section/project (✕) or fill them. Same for the external blank project. Not documented in the UI.
4. **Back button goes to the wrong place for blank-form users.** Step 2's "← Back" calls `goTo(1)` (paste-JSON screen) even when
   the user came from "Create from scratch"; stepper "Provide data" does the same. They land on an empty textarea.
5. **Step-1 JSON edit is a one-way trip.** Going back from review to the JSON step keeps `jsonText`, but pressing Continue
   re-parses the *original* JSON and overwrites any edits made in the review form (`setData(result.data)`) without warning.
6. **Specialization is silently truncated** to 5 words as you type/paste (`Field` `maxWords`) — pasted text loses words without notice.
7. **`experienceSummary` wording drifts:** prompt requires `"<N>+ Years of Industry Experience"`; schema doesn't enforce it
   (any non-empty string); `test-render.mjs` / `test-pdf.mts` use `"… years of Industry Experience"`.
8. **N/A check is bypassed on any path that doesn't go through `handleGenerate`** (a future PDF button would need to call
   `findNAIssues` itself).
9. **`hasDuration` is computed for internal projects but no live template tag uses it** (0 matches in `internal.docx`), so an
   empty/blank duration still prints the "Project N - " heading. (Duration is mandatory in the schema, so low impact.)
10. **`generateDocx` filename uses `data.name`** (unparsed state) not the validated `result.data.name`; harmless but inconsistent.
11. **Filename sanitising is only whitespace→`_`.** A name with `/`, `:` etc. is passed to `saveAs` as-is.

### Dead / duplicate code
12. `components/DocPreview.tsx`, `lib/pdfClient.ts` (exports), `lib/templates.ts` (`TEMPLATES`) are unused; `docx-preview` dependency is only
    used by `DocPreview` (so it ships in `node_modules` but not in the bundle).
13. `RemovedSection` is copy-pasted into both `InternalForm.tsx` and `ExternalForm.tsx`; `BLANK_PROJECT` / blank-entry literals are duplicated
    between forms and `blankResume()`; `START`/`STEP_LABELS`/instructions text duplicated per audience.
14. The Google Form URL is defined in `lib/constants.ts` **and hardcoded again** in `InstructionsContent.tsx:203`.
15. `app/internal/page.tsx` vs `app/external/page.tsx` (and the instructions pair) are near-identical wrappers.
16. `restoreProjects` in `InternalForm` puts the shared `BLANK_PROJECT` object itself into state (the external form spreads a copy).
    Updates are immutable so it works today, but it's an aliasing trap.
17. `Lexend-bold.ttf`, 5 Next starter SVGs, `internal.textClipping`, 12 unused `.docx` (see §6).
18. `README.md` says `node test-render.mjs` writes to `/tmp/out-*.docx` — true, but `test-pdf.mts` also writes to `/tmp`; both scripts hardcode `/tmp`.

### Fragility / maintenance
19. **PDF layout is a hand-coded reimplementation of the Word templates** (magic numbers: `memberLeadSpaces: 162`, logo EMU→pt anchors,
    column ratio `0.68` vs comment "~70.7%", fixed 43pt/72pt margins). Any template edit in Word requires manual PDF re-tuning. No automated comparison.
20. `test-render.mjs` mirrors `prepareData()` by hand → can pass while the real function is broken; there's no CI test job at all, and no lint script.
21. **Tag-splitting risk** when editing the templates in Word (see §4) and the generation script (`tag_templates.py`) is **missing from this checkout**,
    so templates can't be regenerated from source.
22. **Three-way schema contract** (zod ↔ prompt ↔ template/PDF) has no test that keeps them aligned. The prompt tells the LLM to use "N/A" placeholders
    and to fill empty required lists with inferred content, while the app then blocks "N/A" in mandatory fields. TASK-01 explicitly reverses this.
23. **`NEXT_PUBLIC_BASE_PATH` is hand-threaded** into 4 files; a new `fetch('/…')` without the prefix breaks only on sub-path deployments.
24. `next/font/google` makes `next build` depend on reaching Google Fonts (it also self-hosts at build time; build here succeeded). The PDF separately fetches the TTFs from `public/fonts`,
    so Lexend is loaded two different ways.
25. `bg-[--background]` in `app/layout.tsx` is Tailwind v3 syntax; in Tailwind v4 the CSS-variable shorthand is `bg-(--background)`. It works only because `body { background: var(--background) }` in `globals.css` covers it.
26. `.next/` / `out/` / `next-env.d.ts` are gitignored (correct); `.env.local` is expected to hold a `GROQ_API_KEY` entry — it is git-ignored (`.gitignore:34 .env*`) and not tracked, but remember `TASK-01` asks for `.env.example`, and `.env*` ignore would also hide that file unless an exception is added.
27. Accessibility: stepper buttons are `disabled` for future steps but have no `aria-current`; forms use clickable ✕ glyph buttons with `title` only (no `aria-label`); label text uses `<span>` wrapping inputs (fine) but no field-level error association (`aria-describedby`).
28. `app/page.tsx` and `app/instructions/page.tsx` use `redirect()` — under static export these become client-side redirect pages; they work, but a plain nginx host gets a 200 page with a meta-refresh rather than a real 301.
29. No `engines` field / `.nvmrc`; CI pins Node 20, local Node version unspecified.

### Brand-rule conflicts (against the global engineering standards)
30. `font-bold`/`font-semibold` used for headings/buttons (`ProfileWorkflow`, `Footer`, `style-guide`, `fields.tsx`), and `italic` in both forms' `RemovedSection` and `<em>` in `InstructionsContent.tsx`. Global brand rules say Lexend Medium only, no italic, and Phosphor thin icons; the UI uses text glyphs (✕ ↑ ↓ ✓) and custom inline SVGs in `Footer` (stroke, not Phosphor). `rounded-*` shapes are used widely despite the brand skill's "no rounded shapes".
    Per-component `.types.ts` / `Component/` folder structure from the global standard is not followed in this repo (flat `components/`, no separate types files). Flagging only; not a bug.

---

## 8. Where the Handover PDF doesn't match this repo

Source: the handover PDF (7 pages) supplied with the project.

| Handover says | This repo |
|---|---|
| A `deploy/` folder with `nginx.conf`, `DEPLOYMENT.md`, `sso/` (`oauth2-proxy.cfg`, `SSO-SETUP.md`) | **No `deploy/` folder exists.** The only "deploy" artefact is `.github/workflows/deploy.yml`. No nginx config, no SSO/oauth2-proxy files. (`grep -ri nginx` only hits TASK-01.) |
| Build with **`npm run build:internal`**; plain `build` gives a blank page because it's set for a different address; check the output has no `"/profile"` prefix | **`build:internal` doesn't exist.** `package.json` scripts: `dev`, `build`, `start`. basePath comes from `NEXT_PUBLIC_BASE_PATH` (default empty = root). Plain `npm run build` produces a root-relative site; the *CI* build adds `/<repo-name>`. No `/profile` string appears anywhere in the source. The failure mode is inverted compared to the handover. |
| Site is served by nginx at the production host, with Google SSO limiting it to staff | The repo's only automated deployment is **GitHub Pages** (public, no auth). Nothing here implements or references SSO or the production host. |
| Deploy = copy `out/` to the server and reload nginx | Only `out/` generation is in the repo; CI uploads it as a Pages artifact. No server-copy step exists. |
| Project folder is `resume-generator/` | Folder is `profile/` (`package.json` name is still `resume-generator`). |
| `tag_templates.py` "sits one folder above the project" | Not present one level up (parent has only `profile/` and `db-wrapper-rag/`). README refers to `../tag_templates.py` too. |
| `app/page.tsx` "shows the Internal generator"; `instructions/page.tsx` "how-to for internal" | Both are **redirects** (`/` → `/internal`, `/instructions` → `/internal/instructions`). The real pages are `app/internal/page.tsx` and `app/internal/instructions/page.tsx`, which the handover's map does not list. |
| "Downloads … as a Word document **or a PDF**", and `DocPreview.tsx` "shows the Word or PDF result before download" | Only DOCX download is wired up; **PDF and preview aren't reachable** (see §7.1). |
| `ProfileWorkflow.tsx` "…the download buttons" (plural) | One download button (DOCX). |
| Stepper: "Start, Provide data, Review and Generate" | Internal has a fourth step, **Submit**. |
| "SiteNav.tsx / Footer.tsx: nav bar and footer" | Correct, but handover doesn't mention `Stepper`/Submit link logic or that `/external` is hidden from the internal nav. |
| `lib/templates.ts` "short descriptions of the two profile types shown on screen" | Not shown anywhere — nothing imports it. |
| "Nothing is stored; no key, no integration with Gemini" | True for `main`'s runtime. But this branch's `TASK-01` introduces a server route and a Groq key (`GROQ_API_KEY` already sits in `.env.local`), which will invalidate the "no back end / static files" premise, the nginx-only deploy, and the "privacy: Gemini by the user's own hand" note. |
| "Only `internal.docx` / `external.docx` are used" | Correct, but handover doesn't warn that **12 other `.docx` files + a `.textClipping`** sit in the same folder and ship to production. |
| README/handover "Preview shows the exact PDF in an iframe" | README claim also inaccurate for the same reason as above. |

---

## Verification done

Run locally, no network publishing, no git writes:
- `node test-render.mjs` → both templates render, no leftover tags, empty-projects and N/A omission cases pass.
- `npx tsc --noEmit` → no type errors.
- `npm run build` → succeeded; 10 static pages generated into `out/` (gitignored). `git status` stayed clean.
- Extracted the placeholder lists directly from `word/document.xml` in `internal.docx` / `external.docx` and md5-compared all templates.
- Read all of `app/`, `components/`, `lib/`, `.github/workflows/deploy.yml`, `README.md`, `AGENTS.md`, `CLAUDE.md`, both test scripts,
  `docs/tasks/TASK-01-auto-extract.md`, and the handover PDF.
- Not done: opening the app in a browser, producing a real PDF/DOCX visually, or running `test-pdf.mts` (writes to `/tmp`).
