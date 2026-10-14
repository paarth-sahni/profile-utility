# Resume Generator

Next.js app that turns a resume (or a blank form) into a branded InfoBeans profile **PDF**, made from one of two Word
templates. Sign-in is with an InfoBeans Google account; the resume is read by an LLM on the server (`/api/extract`),
and **internal** profiles can be saved per user in Supabase (My Profiles). **External** (client-facing) profiles are
never stored.

## How it works

The generator (`/internal`, `/external`) is one workflow with these steps:

1. **Start** — upload a resume / existing profile, or start from a blank form.
2. **Upload profile** — the file is read and pre-fills the form; a single note above the form asks you to review every
   section (`ExtractionSummary`).
3. **Edit details** — every field is editable (tags for skills/tools, add / remove / reorder items). Required fields
   (name, job title, experience summary / years of experience, overview, one education entry, one skill) are marked in red when missing. There is **no save
   control here**: an internal profile is saved only by **Submit** on Preview & Submit (below).
4. **Preview & Submit** (internal; **Preview** for external, which has no Submit) — pressing *Preview & Submit →*
   (*Preview →* for external) first validates the profile; if anything is missing you stay on (or return to)
   Edit details with the fields marked. Otherwise the server makes the **PDF** (`POST /api/pdf`, see [PDF](#pdf)) and
   the page draws that PDF (pdf.js): the same `Blob` is what *Download PDF* saves. Buttons:
   - **← Back to edit** — keeps every edit.
   - **Download PDF** — all users. File name `<Name>-<Job_title>-InfoBeans.pdf`, e.g.
     `Abdul-Technology_Delivery_Manager-InfoBeans.pdf` (spaces become `_`, other unsafe characters are removed).
   - **Submit** — internal profiles only (see below).

   A **required consent checkbox** — "I confirm the information in this profile is accurate and may be shared" — must
   be ticked before Submit or Download. Each use is written to `audit_log` (`consent_submit`,
   `consent_download`, `consent_google_docs`; who, when, which template and which wording version, never profile
   content) through `POST /api/consent` *before* the action runs; if that fails the action does not happen.
   *Download PDF* on My Profiles and Manage asks for the same tick in a dialog and records `consent_download` the same way.

**Submit** (internal only, on Preview & Submit) validates, records the consent and saves the profile as a new version in
My Profiles (if nothing changed since the last save, that version is reused). Preview stays on screen and shows
"Submitted · saved to My Profiles · v3" with a *View in My Profiles* link; *Download PDF* remains available. There is
no further step and no external form link.

### Internal vs external

| | Internal | External |
|---|---|---|
| Saved in the database | yes, by Submit on Preview: My Profiles, version history (Base, v2, v3, ...) | **never** |
| Edit details | no save controls (same as external) | no save controls |
| Last step | **Preview & Submit**: Back to edit, Download PDF, Submit (stays on the step) | **Preview**: Back to edit, Download PDF |
| Session-expiry banner | "go to Preview & Submit to save your profile (or download your PDF)", no button | "download your PDF now", no button |
| Listed in My Profiles / Manage | yes | n/a |

The server enforces it: `POST /api/profiles` answers **400 `EXTERNAL_NOT_SAVED`** for template `external`
(`lib/profilePayload.ts` only accepts `internal`, and `saveVersionAs` refuses it as well). `My Profiles` and `/manage`
(search function `search_profiles_by_name`) list internal profiles only. Older external rows, if any exist from before
this rule, are not deleted, just not listed.

Additional pages: **/instructions** (step-by-step generation process for each
template) and **/style-guide** (the typography Style Guide PDF, embedded as-is
from `public/style-guide/`).

## PDF

There is no DOCX download any more: every download (Preview, My Profiles, Manage) is a PDF, and Preview shows that
same PDF.

- `POST /api/pdf` (`app/api/pdf/route.ts`): signed-in users only (401 otherwise, also in `proxy.ts`), 60 PDFs per
  10 minutes per user, body `{ template, data }` checked with the strict schema and the "N/A" check (422 `INCOMPLETE`
  otherwise). Nothing is stored and no profile content is logged (only an error code); `Cache-Control: no-store`.
- `lib/pdfRender.ts` fills the Word template exactly as the browser does (`lib/docxFill.ts`), drops the template's
  embedded fonts (one of them is mislabelled and turned all Lexend Light text into Lexend Regular), and runs
  `soffice --headless --convert-to pdf` in a fresh temporary directory with its own LibreOffice profile
  (`-env:UserInstallation`), deleted afterwards. At most 2 conversions run at once per server process.
- Fonts: the Lexend files in `public/fonts` are copied into that temporary directory and given to LibreOffice through a
  private fontconfig file, so nothing has to be installed system-wide. If `soffice` is missing the API answers
  **503 `CONVERTER_MISSING`** and the error is logged as `[pdf] could not make the PDF (CONVERTER_MISSING)`.
- Settings (optional): `SOFFICE_PATH` (default `soffice`), `PDF_FONTS_DIR` (default `public/fonts`).
- Preview draws the PDF with pdf.js (through `unpdf`, loaded only on Preview) rather than an `<iframe>`: phones do not
  show a PDF inside a page (Android offers a download, iOS shows page 1 only).
- *Open in Google Docs* still uploads the filled DOCX (Google converts it); that is the only place a DOCX is made.

### Production server (go-live checklist)

- **LibreOffice** 7.3 or newer; Writer without a GUI is enough (Ubuntu 22.04: `apt-get install
  --no-install-recommends libreoffice-writer-nogui`, 7.3.7), with `soffice` on the `PATH` of the Node process (or set
  `SOFFICE_PATH`). Tested with 7.3.7.2. Check: `soffice --version`. Newer versions can shift line breaks slightly:
  run `npm run test:render -- --pdf` after an upgrade.
- **fontconfig** (comes with LibreOffice) and a basic sans font for symbols the brand font lacks (`fonts-dejavu-core`,
  normally pulled in by LibreOffice). The **Lexend** fonts need no install: they ship in `public/fonts`, which must be
  deployed next to the server (`cp -r public .next/standalone/` for the standalone output; the server reads
  `public/templates` and `public/fonts` relative to its working directory).
- A writable temporary directory (`TMPDIR`, default `/tmp`) for the Node user; each conversion uses under 2 MB there
  for a second or two.
- Memory / CPU (measured): one conversion takes ~1.2 s and ~220 MB peak for LibreOffice; at most 2 run at once per
  Node process, so allow ~500 MB on top of the app.
- Smoke test after deploy: open Preview for any profile, or `npm run test:render -- --pdf` on the box.

## Templates

The originals (`IB - External Profile Format.docx`, `IB - Internal Profile
Format Final.docx`) were converted into docxtemplater templates by inserting `{placeholder}` and `{#loop}…{/loop}`
tags into their `word/document.xml`; those tagged originals are kept in `docs/template-backups/`.
`public/templates/{internal,external}.docx` are **generated** from them, never edited by hand:

```bash
python3 scripts/patch-templates.py
```

It wraps every optional section in a `{#hasX}` condition (flags set in `lib/docxData.ts`) and applies the formatting:
the logo at its true aspect ratio directly under "A PROUD MEMBER OF" (left edges aligned), one bullet style for all
responsibilities, a blank line before the project description and before its bullets, sidebar spacing (1.15 inside an
item, 1.5 between items) and no stretched last line in justified paragraphs. Change the script and run it again.

`npm run test:render` checks the generated templates; `npm run test:render -- --pdf` also converts full / empty /
sparse / mixed / long renders exactly as Download PDF does into `/tmp/render-check/` and measures them (logo
position and ratio, bullets, blank lines, sidebar spacing). Open those PDFs to look at them.

## Key files

- `lib/schemas.ts` — Zod schemas for both templates (source of truth for the JSON shape)
- `lib/prompts.ts` — the LLM extraction prompts (schema + rules + example)
- `lib/docxData.ts` — maps a profile onto the template tags (and the optional-section flags)
- `lib/docxFill.ts` — fills a template with docxtemplater (shared by browser and server)
- `lib/pdfRender.ts`, `app/api/pdf/route.ts` — the server-side PDF (LibreOffice)
- `lib/pdfClient.ts` — browser side: ask `/api/pdf` for the PDF, save it
- `lib/docxReady.ts` — "is this profile complete enough to export?" and the PDF file name
- `lib/generate.ts` — fills the template in the browser (Google Docs upload only)
- `components/ProfileWorkflow.tsx` — the steps, validation, saving and Submit
- `components/ExternalForm.tsx`, `components/InternalForm.tsx` — the Edit details editors
- `components/PreviewStep.tsx` — Preview & Submit step: consent checkbox, Download PDF / Submit
- `components/ConsentCheckbox.tsx` — the consent checkbox shared by Preview & Submit and the Download PDF dialog
- `components/usePreviewPdf.ts` — builds the PDF once; the preview and the download use that Blob
- `components/PdfPreview.tsx` — draws a PDF Blob in the page (pdf.js via `unpdf`)
- `components/DownloadPdfButton.tsx` — Download PDF on My Profiles and Manage
- `lib/consent.ts`, `lib/consentClient.ts`, `app/api/consent/route.ts` — the consent wording and its audit record
- `scripts/patch-templates.py` — generates `public/templates/*.docx` from `docs/template-backups/`

## Develop

```bash
npm install
npm run dev
```

## Tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | unit tests (`lib/*.test.ts`), incl. real PDF conversions (`pdfRender`, `extractText`) | LibreOffice (`soffice`) |
| `npm run test:db` | the data layer as seeded users (round trips, ownership, search) | local Supabase + seed |
| `npm run test:rls` | Row Level Security per role and table | local Supabase + seed |
| `npm run test:render` | the real Word templates: each optional section present when filled and completely gone when empty, no leftover or split tags, the formatting in the XML (logo ratio, bullet definition, spacing). Add `-- --pdf` to also convert full / empty / sparse / mixed / long renders as Download PDF does into `/tmp/render-check/` and measure them (logo position and ratio, bullets, blank lines, sidebar spacing) | nothing (`--pdf`: LibreOffice + poppler) |
| `npm run test:e2e` | optional browser checks (below) | local Supabase + seed, `npm run dev`, Chrome |

### End-to-end browser checks (optional)

`npm run test:e2e` drives a real headless Chrome through the generator: draft recovery in `sessionStorage`,
the 401-then-restore path, the session-expiry banner, Discard, the "Discard your unsaved draft?" dialog, sign-out
clearing drafts, and another user never seeing a draft. It runs only against the **local stack and the seeded
users** (`member@example.test`, ... `password123`) and signs them in by setting a session cookie, so Google sign-in
is not involved. It refuses to run if the Supabase or database URL is not local.

```bash
npm run db:start && npm run db:reset     # local stack + seed (once)
npm run dev                              # in another terminal; development mode only:
                                         # the seeded @example.test users cannot sign in to a production build
npm run test:e2e
```

`npm run test:e2e` runs two scripts: `scripts/e2e-drafts.mjs` (above, incl. a 401 from `/api/pdf` on Preview) and
`scripts/e2e-ui.mjs`: the Preview step (the PDF itself drawn in the page, the downloaded PDF byte-identical to the
previewed one (SHA-256) and named `<Name>-<Job_title>-InfoBeans.pdf`, no DOCX anywhere, `/api/pdf` refusing incomplete
data, validation gate, consent before Download / Submit and its `audit_log` rows, Back keeps edits),
Download PDF on My Profiles, Manage and for external profiles, Submit saving a version and showing the success message on Preview (and reusing the version when unchanged), no Submit step or "Submit Profile" nav link,
external profiles never saved (no save UI, API 400, not listed in My Profiles / Manage), Open in Google Docs only on
/manage/[id] for managers and admins (never on Preview or My Profiles), previews hiding empty sections, automatic version labels (Base, v2, v3), saving only through Submit, the
unsaved-changes dialog, optional-section notes and brand rules. Google is **stubbed** in the page (a fake token client;
Drive requests are intercepted), so nothing real is called and the test can prove the token goes only to
`www.googleapis.com`. The Google checks need `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set to any value in `.env.local` before
`npm run dev` starts, otherwise they are skipped.

The scripts save a few dozen profiles as the seeded users, and the save API allows 60 saves per 10 minutes per user
(an in-memory limit). One `npm run test:e2e` is well within it; if you run it again straight away you may hit the limit
(saves answer 429 and a scenario times out). Wait a few minutes or restart `npm run dev` to reset it.

Settings (all optional): `APP_URL` (default `http://localhost:3000`), `CHROME_BIN` (default `google-chrome`),
`E2E_CHROME_PORT` (default `9333`), `E2E_DB_URL`. It needs `psql` on the PATH (to age a session for the expiry
checks) and Node 20 with `--experimental-websocket` (the npm script sets it). Test data is named "E2E ..." and is
deleted when the run ends. The harness is `scripts/e2e-lib.mjs`; scenarios are `scripts/e2e-*.mjs`.

## Local auth setup (Google sign-in)

Users sign in with their InfoBeans Google account (`@infobeans.com` only). `/internal`, `/external` and
`POST /api/extract` require a session; `/instructions` and `/style-guide` stay public.

1. Create a Google OAuth client (Google Cloud Console -> APIs & Services -> Credentials -> OAuth client ID,
   type *Web application*). Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback`.
2. Put the values in `supabase/.env` (git-ignored; read by the Supabase CLI, not by Next.js):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
3. Restart the stack: `npm run db:stop && npm run db:start`, then `npm run dev` and open http://localhost:3000.

TODO (cloud): use the cloud Supabase project's Google provider, add its callback URL to the OAuth client,
and disable email sign-up there.

## Session limit

A sign-in lasts at most **2 hours**. After that the user is signed out and must sign in with Google again.
This is enforced twice: Supabase `[auth.sessions] timebox = "2h"` (supabase/config.toml; on a hosted project
set it under Auth -> Sessions, which needs a paid plan) and `proxy.ts`, which checks `last_sign_in_at` on every
protected request.

## Auth helpers for server code

`lib/auth.ts` (server-only) exposes `getCurrentUser()` -> `{ id, email, role } | null` and `requireUser()`
(redirects to `/login` when signed out). The role is read from `public.app_users` through the user's own
session; it is never taken from the JWT or `user_metadata`. Both enforce the `@infobeans.com` domain and the
2-hour limit (`SESSION_MAX_AGE_MS`). Pure rules (`isAllowedEmail`, `safeNextPath`, `sessionExpired`, ...) live in `lib/authRules.ts`,
which is safe to import from `proxy.ts`, client components and tests.

## Open in Google Docs

An **Open in Google Docs** button sits next to *Download PDF* on the `/manage/[id]` profile pages only (read-only; not on
Preview & Submit and not on My Profiles). It is offered to **managers and admins only**
(`canUseGoogleDocs()` in `lib/authRules.ts`; the pages read the role on the server and do not render the button for
anyone else). It is a product rule enforced by the pages: the export runs in the browser with the user's own Google
token, so there is no server call to refuse. It uploads the filled DOCX of the version being viewed (the same data the PDF
is made from). It works entirely in the browser:

1. On click, Google Identity Services opens Google's own consent popup and returns a short-lived **access token**
   for the single scope `https://www.googleapis.com/auth/drive.file` (only files this app creates).
2. The browser builds the DOCX, uploads it to the user's **own** Drive converting it to a Google Doc
   (`POST https://www.googleapis.com/upload/drive/v3/files`), and opens the link.
3. The token is held in a local variable for that one call. It is **never stored** (no cookie, no `localStorage`) and
   **never sent to our server**: the only request that carries it goes to `www.googleapis.com`.

The script `https://accounts.google.com/gsi/client` is loaded on pages that show the button (so the popup can open
inside the click). If you add a Content-Security-Policy later, allow `https://accounts.google.com/gsi/` and
`https://www.googleapis.com`. Failures (blocked pop-up, closed window, access denied, Drive API off, offline, rate
limit) show a plain-language message and suggest *Download PDF*.

### Setup

Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`.env.local` locally; for a production build it must be present **at build time**,
because `NEXT_PUBLIC_` values are baked into the bundle). With no value the buttons are hidden. It is a public ID;
this feature has no client secret.

In Google Cloud (the same project as the sign-in is fine):

1. **APIs & Services -> Library**: enable the **Google Drive API**. (Without it the button reports "Google Drive is
   not enabled for this app yet".)
2. **Google Auth Platform -> Audience**: user type **Internal**, so only InfoBeans accounts can use it.
3. **Google Auth Platform -> Data Access**: add the scope `.../auth/drive.file`.
4. **Google Auth Platform -> Clients -> Create client -> Web application**. Under **Authorized JavaScript origins**
   add `http://localhost:3000` (local) and the production origin (`https://...`). No redirect URI is needed for this
   popup flow, and the client secret is not used.
5. Copy the client ID into `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

Note for the sign-in code: `components/LoginCard.tsx` still requests `drive.file` when signing in (an earlier plan that
read `session.provider_token` on the server). Open in Google Docs no longer uses it, so that scope can be dropped from
the sign-in to keep it to the minimum.

## Roles and saving

Only `team_member` and `admin` accounts can create profiles (Row Level Security: `profiles_insert_own`); managers and
checkers can read everything but cannot save. A manager who presses *Submit* on an internal profile therefore gets the
"could not save" message; they can still Download from Preview & Submit.

## Primary profile

Each team member has at most one **primary** internal profile: the one managers see and use
(migration `20261014120000_primary_profile.sql`).

- **Setting it:** *Mark as primary* on My Profiles (confirmed in a dialog), or the *Mark as primary profile* box above
  *Submit* on Preview & Submit (saves the version and sets the primary in one call, `submit_profile_version`). The
  first profile a person submits becomes primary automatically. Saving a new version never moves the primary; a
  primary profile simply shows its newest version.
- **Rules in the database:** `profiles.is_primary` with a unique index (one per owner). Nobody writes the column
  directly (no INSERT/UPDATE privilege); `set_primary_profile(id)` switches it atomically and only for the owner (a
  trigger refuses anyone else, admins included).
- **/manage:** one row per team member: their primary profile, or their most recently updated one when none is
  marked (there is no backfill). A profile's page lists the person's other profiles, read-only.

## Manual test list

Everything below is also covered by `npm test`, `npm run test:db`, `npm run test:rls` and `npm run test:e2e`; run it by
hand after a visual change. Seeded users: `member@`, `manager@`, `admin@example.test` (password `password123`).

1. **Preview gate** (member, `/internal`): *Create a Profile from Scratch* → *Preview →* with nothing filled → stays on
   Edit details, fields marked red. Fill name, job title, years of experience, overview, year, qualification, one skill + rating → *Preview & Submit →*
   → the PDF appears in the page (every page, readable on a phone too: try the browser's device mode).
2. **Back keeps edits**: *← Back to edit* → everything typed is still there.
3. **Consent**: on Preview press *Download PDF* and *Submit* without the box → a message, nothing happens. Tick it →
   Download works; check `select action, detail from audit_log order by id desc limit 3;` shows `consent_download`
   with `{"template": "internal", "consentVersion": "1"}`.
4. **Same file**: the downloaded file is named like `Jane_Doe-Senior_Engineer-InfoBeans.pdf` and looks exactly like the
   preview. There is no *Download DOCX* anywhere (Preview, My Profiles, Manage).
5. **Formatting** (open the PDF at 100-200 %): the logo is not stretched and sits directly under "A PROUD MEMBER OF",
   left edges aligned, top right; all bullets look the same, with even gaps; a blank line before the project
   description and before its bullets; in the internal sidebar a wrapped item is tight (1.15) and items are further apart
   (1.5); the last line of the overview is not stretched. Text is in Lexend (Light for body text).
6. **No save on Edit details**: no *Save* button, *Version label*, role-specific box or saved/unsaved line; nothing is in
   `profiles` until you Submit. **Submit (internal)**: tick, *Submit* → stays on Preview and shows "Submitted · saved to My Profiles · v1" with a
   *View in My Profiles* link (no new step, no form link); Download PDF still works. *My Profiles* lists it. Submit
   again without edits → still v1. Edit, Preview, Submit → v2, then v3 (labels are automatic: Base, v2, v3). Open a version from My Profiles ("Open in editor"), edit, Preview, Submit → a new version of the same profile. The top and mobile menus have no "Submit Profile" link.
7. **External**: `/external` → blank form → no save controls; steps are Start, Upload profile, Edit details,
   Preview; Preview has *Back to edit* and *Download PDF* only; the PDF is named after the candidate. Nothing appears in `profiles`. From a signed-in tab:
   `fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'external'})}).then(r=>r.json())`
   → `EXTERNAL_NOT_SAVED` (400).
8. **Google Docs**: nobody sees it on Preview & Submit or on *My Profiles*; as `admin@example.test` or
   `manager@example.test` it is on `/manage/[id]`.
9. **Manage**: `/manage` as `manager@example.test` lists internal profiles only; *Download PDF* on `/manage/[id]` saves
   the version shown.
10. **Saved versions**: on *My Profiles* → a profile → *Download PDF* on any version → that version as a PDF; an
    incomplete draft shows "Open in editor to finish it" instead.
11. **Converter missing** (staging only): stop the app, start it with `SOFFICE_PATH=/nonexistent npm run dev` → Preview
    shows "PDF creation is not available on this server right now"; the server log has
    `[pdf] could not make the PDF (CONVERTER_MISSING)` and no profile content.
