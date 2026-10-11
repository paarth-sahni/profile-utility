# Resume Generator

Frontend-only Next.js app that generates a styled resume `.docx` from one of two
Word templates, using JSON produced by an external LLM. No backend — everything
(validation, editing, rendering, download) happens in the browser.

## How it works

1. **Template selection** — pick *External Profile* or *Internal Profile*, then
   **Copy LLM Prompt**. Paste that prompt into any LLM together with a resume
   file; it replies with JSON matching the template's schema.
2. **Paste JSON** — the JSON is validated with Zod; field-level errors are shown.
3. **Review & edit** — all fields are editable (array items can be added,
   removed and reordered). **Preview** shows the exact PDF in an iframe.
   Download as **DOCX** (docxtemplater + pizzip, original Word template),
   **PDF** (built natively in the browser with pdf-lib using the template's
   Lexend fonts + logo from `public/fonts` / `public/img`), or both.

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
- `components/ExternalForm.tsx`, `components/InternalForm.tsx` — step-3 editors
- `components/DocPreview.tsx` — PDF preview pane with refresh/stale indicator

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
| `npm run test:e2e` | optional browser checks (below) | local Supabase + seed, `npm run dev`, Chrome |

### End-to-end browser checks (optional)

`npm run test:e2e` drives a real headless Chrome through the Review screen: draft recovery in `sessionStorage`,
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

## Google Drive scope (for "Open in Google Docs")

The sign-in also requests `https://www.googleapis.com/auth/drive.file` (only files the app creates itself).
In Google Cloud: enable the **Google Drive API**, and add the scope under *Google Auth Platform -> Data Access*.
Supabase does not store Google tokens: the Docs feature must read `session.provider_token` in
`app/auth/callback/route.ts` right after `exchangeCodeForSession` (it lasts about an hour, so it can expire before
the 2-hour session limit does). Users who signed in before this change will be asked to approve once more.
