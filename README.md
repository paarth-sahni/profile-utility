# Resume Generator

Next.js app that turns a resume (or a blank form) into a branded InfoBeans profile `.docx`, from one of two Word
templates. Sign-in is with an InfoBeans Google account; the resume is read by an LLM on the server (`/api/extract`),
and **internal** profiles can be saved per user in Supabase (My Profiles). **External** (client-facing) profiles are
never stored.

## How it works

The generator (`/internal`, `/external`) is one workflow with these steps:

1. **Start** — upload a resume / existing profile, or start from a blank form.
2. **Upload resume** — the file is read and pre-fills the form; a single note above the form asks you to review every
   section (`ExtractionSummary`).
3. **Edit details** — every field is editable (tags for skills/tools, add / remove / reorder items). Required fields
   (name, job title, overview, one education entry, one skill) are marked in red when missing. There is **no save
   control here**: an internal profile is saved only by **Submit** on Preview (below).
4. **Preview** — pressing *Preview →* first validates the profile; if anything is missing you stay on (or return to)
   Edit details with the fields marked. Otherwise the **exact generated DOCX** is rendered in the page with
   `docx-preview`: the same `Blob` is what *Download DOCX* saves and *Open in Google Docs* uploads. Buttons:
   - **← Back to edit** — keeps every edit.
   - **Download DOCX** — all users.
   - **Open in Google Docs** — managers and admins only (see below).
   - **Submit** — internal profiles only (see below).

   A **required consent checkbox** — "I confirm the information in this profile is accurate and may be shared" — must
   be ticked before Submit, Download or Google Docs. Each use is written to `audit_log` (`consent_submit`,
   `consent_download`, `consent_google_docs`; who, when, which template and which wording version, never profile
   content) through `POST /api/consent` *before* the action runs; if that fails the action does not happen.

**Submit** (internal only, on Preview) validates, records the consent and saves the profile as a new version in
My Profiles (if nothing changed since the last save, that version is reused). Preview stays on screen and shows
"Submitted · saved to My Profiles · v3" with a *View in My Profiles* link; *Download DOCX* remains available. There is
no further step and no external form link.

### Internal vs external

| | Internal | External |
|---|---|---|
| Saved in the database | yes, by Submit on Preview: My Profiles, version history (Base, v2, v3, ...) | **never** |
| Edit details | no save controls (same as external) | no save controls |
| Preview | Back to edit, Download DOCX, Submit (stays on Preview), (Google Docs) | Back to edit, Download DOCX, (Google Docs) |
| Session-expiry banner | "go to Preview and Submit to save your profile (or download your DOCX)", no button | "download your DOCX now", no button |
| Listed in My Profiles / Manage | yes | n/a |

The server enforces it: `POST /api/profiles` answers **400 `EXTERNAL_NOT_SAVED`** for template `external`
(`lib/profilePayload.ts` only accepts `internal`, and `saveVersionAs` refuses it as well). `My Profiles` and `/manage`
(search function `search_profiles_by_name`) list internal profiles only. Older external rows, if any exist from before
this rule, are not deleted, just not listed.

Additional pages: **/instructions** (step-by-step generation process for each
template) and **/style-guide** (the typography Style Guide PDF, embedded as-is
from `public/style-guide/`).

## Templates

The originals (`IB - External Profile Format.docx`, `IB - Internal Profile
Format Final.docx`, in the parent folder) were converted into docxtemplater
templates by inserting `{placeholder}` and `{#loop}…{/loop}` tags directly into
their `word/document.xml`, preserving every font, color, size, spacing and the
embedded logo. The tagged copies live in `public/templates/`.

To re-tag after changing a source template, adjust the paraId-keyed rules and run:

```bash
python3 ../tag_templates.py
```

`node test-render.mjs` renders both tagged templates with sample data and
checks for leftover tags (writes outputs to `/tmp/out-*.docx`).

## Key files

- `lib/schemas.ts` — Zod schemas for both templates (source of truth for the JSON shape)
- `lib/prompts.ts` — the LLM extraction prompts (schema + rules + example)
- `lib/generate.ts` — docxtemplater rendering, data mapping, error explanation
- `lib/pdf.ts` — native PDF layout engine + both template renderers (pure, node-testable)
- `lib/pdfClient.ts` — browser asset loading, PDF blob/download helpers
- `components/ProfileWorkflow.tsx` — the steps, validation, saving and Submit
- `components/ExternalForm.tsx`, `components/InternalForm.tsx` — the Edit details editors
- `components/PreviewStep.tsx` — Preview step: consent checkbox, Download / Google Docs / Submit
- `components/usePreviewDocx.ts` — builds the DOCX once; the preview, the download and Google Docs all use that Blob
- `components/DocPreview.tsx` — renders a DOCX Blob in the page (`docx-preview`)
- `lib/consent.ts`, `lib/consentClient.ts`, `app/api/consent/route.ts` — the consent wording and its audit record

`npx tsx test-pdf.mts` builds sample PDFs for both templates to `/tmp` for
visual inspection.

## Develop

```bash
npm install
npm run dev
```

## Tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | unit tests (`lib/*.test.ts`) | nothing |
| `npm run test:db` | the data layer as seeded users (round trips, ownership, search) | local Supabase + seed |
| `npm run test:rls` | Row Level Security per role and table | local Supabase + seed |
| `npm run test:render` | the real Word templates: each optional section present when filled and completely gone when empty, no leftover or split tags (add `-- --pdf` to also convert full / empty / sparse / mixed renders with LibreOffice into `/tmp/render-check/` and check them) | nothing (`--pdf`: LibreOffice + poppler) |
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

`npm run test:e2e` runs two scripts: `scripts/e2e-drafts.mjs` (above) and `scripts/e2e-ui.mjs`: the Preview step (exact
DOCX rendered, the downloaded file matches what was previewed, validation gate, consent before Download / Submit /
Google Docs and its `audit_log` rows, Back keeps edits), Submit saving a version and showing the success message on Preview (and reusing the version when unchanged), no Submit step or "Submit Profile" nav link,
external profiles never saved (no save UI, API 400, not listed in My Profiles / Manage), Open in Google Docs for managers
and admins only (Preview, My Profiles, Manage), previews hiding empty sections, automatic version labels (Base, v2, v3), saving only through Submit, the
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

An **Open in Google Docs** button sits next to *Download DOCX* on Preview, on `/profiles/[id]` (every version) and on
`/manage/[id]` (read-only; the manager view also has *Download DOCX*). It is offered to **managers and admins only**
(`canUseGoogleDocs()` in `lib/authRules.ts`; the pages read the role on the server and do not render the button for
anyone else). It is a product rule enforced by the pages: the export runs in the browser with the user's own Google
token, so there is no server call to refuse. On Preview it uploads the very DOCX that is previewed, after the consent
box is ticked and recorded. It works entirely in the browser:

1. On click, Google Identity Services opens Google's own consent popup and returns a short-lived **access token**
   for the single scope `https://www.googleapis.com/auth/drive.file` (only files this app creates).
2. The browser builds the DOCX, uploads it to the user's **own** Drive converting it to a Google Doc
   (`POST https://www.googleapis.com/upload/drive/v3/files`), and opens the link.
3. The token is held in a local variable for that one call. It is **never stored** (no cookie, no `localStorage`) and
   **never sent to our server**: the only request that carries it goes to `www.googleapis.com`.

The script `https://accounts.google.com/gsi/client` is loaded on pages that show the button (so the popup can open
inside the click). If you add a Content-Security-Policy later, allow `https://accounts.google.com/gsi/` and
`https://www.googleapis.com`. Failures (blocked pop-up, closed window, access denied, Drive API off, offline, rate
limit) show a plain-language message and suggest *Download DOCX*.

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
"could not save" message; they can still Download and use Google Docs from Preview.

## Manual test list

Everything below is also covered by `npm test`, `npm run test:db`, `npm run test:rls` and `npm run test:e2e`; run it by
hand after a visual change. Seeded users: `member@`, `manager@`, `admin@example.test` (password `password123`).

1. **Preview gate** (member, `/internal`): *Create a Profile from Scratch* → *Preview →* with nothing filled → stays on
   Edit details, fields marked red. Fill name, job title, overview, year, qualification, one skill + rating → *Preview →*
   → the DOCX appears in the page.
2. **Back keeps edits**: *← Back to edit* → everything typed is still there.
3. **Consent**: on Preview press *Download DOCX* and *Submit* without the box → a message, nothing happens. Tick it →
   Download works; check `select action, detail from audit_log order by id desc limit 3;` shows `consent_download`
   with `{"template": "internal", "consentVersion": "1"}`.
4. **Same file**: open the downloaded DOCX in Word; it matches the preview.
5. **No save on Edit details**: no *Save* button, *Version label*, role-specific box or saved/unsaved line; nothing is in
   `profiles` until you Submit. **Submit (internal)**: tick, *Submit* → stays on Preview and shows "Submitted · saved to My Profiles · v1" with a
   *View in My Profiles* link (no new step, no form link); Download DOCX still works. *My Profiles* lists it. Submit
   again without edits → still v1. Edit, Preview, Submit → v2, then v3 (labels are automatic: Base, v2, v3). Open a version from My Profiles ("Open in Review"), edit, Preview, Submit → a new version of the same profile. The top and mobile menus have no "Submit Profile" link.
6. **External**: `/external` → blank form → no save controls; steps are Start, Upload resume, Edit details,
   Preview; Preview has *Back to edit* and *Download DOCX* only. Nothing appears in `profiles`. From a signed-in tab:
   `fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:'external'})}).then(r=>r.json())`
   → `EXTERNAL_NOT_SAVED` (400).
7. **Google Docs**: as `member@example.test` it is on neither Preview nor *My Profiles*; as `admin@example.test` or
   `manager@example.test` it is on Preview, and on `/manage/[id]`; admins also see it on *My Profiles*.
8. **Manage**: `/manage` as `manager@example.test` lists internal profiles only.
