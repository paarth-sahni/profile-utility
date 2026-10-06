# TASK 02 — Database, login, roles and saved profile versions (Supabase)

## Goal
Today nothing is saved: a refresh loses the profile. After this task:
- People sign in.
- A Team Member can save a profile, keep a version history, and create role-specific versions.
- A Manager or Admin can see all profiles and search them by name.
- The tables needed for the Checker role and for JD search exist, but their screens come in later tasks.

**Environment:** a local Supabase stack (Supabase CLI in Docker) on this laptop. Never connect to
a cloud project, never push, and never put real employee data in seed files. A cloud project
(Mumbai region) comes later, after approval, using the same migrations.

**Security model (non-negotiable):**
1. The browser uses Supabase **only for authentication** (sign-in/out, session). It never queries
   tables, storage or RPCs directly. No `.from(...)` in client components.
2. All data reads and writes run on the Next.js server, through a Supabase client built from the
   **signed-in user's session**, so Row Level Security applies to every query.
3. RLS is enabled on every table with **default deny**. Each permission is an explicit policy,
   tested per role.
4. The service-role key is used only in seed scripts and admin tooling, never in request handling.
   If you think a request path needs it, stop and ask.

## Step 0 — Read before writing code
- Read `docs/REPO-NOTES.md`, `AGENTS.md`, `lib/schemas.ts`, `lib/extract.ts` and
  `components/ProfileWorkflow.tsx`.
- Next.js 16: read `node_modules/next/dist/docs/` for route handlers, server actions, and request
  interception. Middleware may be renamed in v16 (check whether it is `proxy.ts`).
- Read the current `@supabase/ssr` and `@supabase/supabase-js` docs for the Next.js App Router with
  cookie-based sessions. Use `getUser()` (verified with the auth server) for authorisation
  decisions, not `getSession()` alone.
- Check `docker --version`. If Docker isn't available, stop and tell me.

## Step 1 — Local Supabase setup
- Run `npx supabase init` and `npx supabase start`. Add the CLI as a dev dependency.
- Env vars, added to `.env.local` with placeholders in `.env.example`:
  - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (needed by the browser for auth only)
  - `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`; seed/admin scripts only)
  - `AUTH_ALLOWED_DOMAIN=infobeans.com` (confirm the real domain with me)
- npm scripts:
  - `db:start`, `db:stop`
  - `db:reset` (re-applies migrations + seed)
  - `db:types` (generates `lib/database.types.ts`)
- Put all schema changes in `supabase/migrations/`. Never change the database through the dashboard.
- Mark `lib/db/*` and the server Supabase client with `import "server-only"`.

## Step 2 — Schema (migration `..._init.sql`)
Extensions: `pg_trgm`, and `vector` (no vector columns yet; JD search adds them).

**Principle:** fully normalised. Every section of a profile is its own table, and every item is its
own row with a `position int` column (unique per parent, starting at 1). The profile shape in
`lib/schemas.ts` stays the app's contract. The database stores it in tables and rebuilds it exactly.

### Types
- `app_role`: `team_member`, `checker`, `manager`, `admin`
- `template_kind`: `internal`, `external`
- `version_kind`: `base`, `role_specific`
- `review_status`: `pending`, `approved`, `changes_requested`
- `list_kind`: `certification`, `tool`, `domain`, `language`, `managerial`, `skill_plain`
  (`skill_plain` = external-profile skills, which have no rating)

### Users

**`app_users`**
- Columns: `id uuid PK` (references `auth.users`, on delete cascade), `email`, `full_name`,
  `role app_role default 'team_member'`, `created_at`.
- A trigger on `auth.users` insert creates this row.
- Domain check: the same trigger rejects any email outside `AUTH_ALLOWED_DOMAIN`, except
  `@example.test` seed users. Make that exception depend on a setting that is off by default.

### Profiles and versions

**`profiles`** (one per person and template)
- Columns:
  - `id uuid PK`
  - `owner_id` (references `app_users`)
  - `template template_kind`
  - `candidate_name text`
  - `current_version_id uuid null`
  - `archived bool default false`
  - `created_at`, `updated_at`

**`profile_versions`** (immutable; holds the single-value fields)
- Columns:
  - `id uuid PK`
  - `profile_id` (references `profiles`, on delete cascade)
  - `version_no int` (sequential per profile)
  - `kind version_kind`
  - `label text`
  - `parent_version_id uuid null` (references `profile_versions`)
  - `source text check in ('upload','scratch','edit')`
  - `created_by` (references `app_users`), `created_at`
  - `name`, `job_title`, `experience_summary`, `specialization`, `overview` (all `text not null default ''`)
  - `analysis jsonb`, `prompt_plan text[]` (display only, never searched)
  - `search tsvector`, maintained by the save function from the version and its child rows
- Constraints: unique `(profile_id, version_no)`.

### Child tables (all `on delete cascade` from their parent)

**`version_education`** (0 or 1 row per version)
- Columns: `version_id` (PK, references `profile_versions`), `year text`, `qualification text`.

**`version_projects`**
- Columns:
  - `id uuid PK`
  - `version_id`, `position`
  - `project_name text` (internal: project title; external: client name)
  - `duration`, `team_size` (text, so ranges like "2-3" survive), `role`
  - `project_link` (internal only; '' for external)
  - `description`

**`project_technologies`**
- Columns: `project_id`, `position`, `name`.

**`project_responsibilities`**
- Columns: `project_id`, `position`, `text`.

**`version_skills`** (internal, rated)
- Columns: `version_id`, `position`, `name`, `rating text null`.
- `rating` stays text so "4" and "4.0" round-trip exactly. A check constraint ensures it is a
  number from 0 to 5 when present.

**`version_list_items`**
- Columns: `version_id`, `kind list_kind`, `position`, `value text`.
- Unique: `(version_id, kind, position)`.

**`version_experience`** (external only)
- Columns: `id uuid PK`, `version_id`, `position`, `company`, `position_title`, `duration`.

**`experience_highlights`**
- Columns: `experience_id`, `position`, `text`.

**`version_review_flags`** (the "Please double-check" list)
- Columns: `version_id`, `position`, `path text`, `reason text`.

**Indexes**
- GIN on `profile_versions.search`.
- Trigram on `profiles.candidate_name`.
- B-tree on lower(name) for `version_skills` and `project_technologies`, and on
  `version_list_items(kind, lower(value))`, ready for search by skill.

### Immutability
- A trigger raises an error on UPDATE of `profile_versions` and of every child table, for every
  role. A change is always a new version, with new child rows.

### Review and audit

**`checker_reviews`** (for TASK-04)
- Columns: `id`, `version_id`, `checker_id`, `status`, `comment`, `created_at`.

**`review_items`** (for TASK-04)
- Columns: `id`, `review_id`, `path`, `reason`, `resolved`.

**`audit_log`**
- Columns: `id`, `actor_id`, `action`, `entity`, `entity_id`, `at`.
- Metadata only, insert-only.

### Functions
- `save_profile_version(p_profile_id uuid null, p_template, p_kind, p_label, p_parent uuid null, p_source, p_profile jsonb, p_flags jsonb, p_analysis jsonb, p_prompt_plan text[])`
  - `security invoker`. In ONE transaction it: creates the profile if needed; inserts the version
    with the next `version_no`; inserts every child row in order; builds `search`; updates
    `current_version_id` and `candidate_name`; writes the audit row.
  - It returns the new version id and number.
- `get_profile_version(p_version_id uuid) returns jsonb`
  - `security invoker`. It rebuilds the profile in EXACTLY the `lib/schemas.ts` shape for its
    template, plus flags, analysis and the prompt plan, ordered by `position`.
- `current_app_role()`: `security definer`, `stable`, with `search_path` set.
- Revoke EXECUTE from `anon` on every function.

## Step 3 — Row Level Security (enabled on every table, no policy = no access)

| Table | team_member | checker | manager | admin |
|---|---|---|---|---|
| app_users | read self | read self | read all | read all, update role |
| profiles | create/read/update own | read all | read all | all |
| profile_versions | create/read on own profiles | read all | read all | read all, delete |
| checker_reviews / review_items | read on own profiles | create, read, update own | read all | all |
| audit_log | none | none | read | read |

- Child tables (education, projects, technologies, responsibilities, skills, list items,
  experience, highlights, review flags) follow their version's access. Each has its own SELECT and
  INSERT policies that join back to `profile_versions` → `profiles.owner_id`. Every table needs
  policies; a table with none is unreachable, and a missing join is a leak.
- `anon` gets nothing on any table.
- Nobody may change their own `role`; only admin can, through a policy and a column check.
- No UPDATE on `profile_versions` for anyone.

## Step 4 — Auth
- **Local:** email + password through Supabase Auth.
  - Seed users are created by `supabase/seed.sql` or a seed script using the service role:
    `member@example.test`, `checker@example.test`, `manager@example.test`, `admin@example.test`,
    with password `password123`, local only.
  - Seed 2 fictional profiles with 2 versions each. Use no real names.
- **Later (cloud):** Google sign-in restricted to InfoBeans accounts, through the Supabase Google
  provider plus the domain check from Step 2. Leave a README TODO, and disable email sign-up in the
  cloud config notes.
- **Protected routes:** `/internal`, `/external`, `/profiles`, `/manage` and `POST /api/extract`.
  Without a verified user, pages redirect to `/login`, and the API returns 401.
- Refresh the session in the request interceptor as the `@supabase/ssr` docs describe.
- Add a sign-out item and the user's email to `SiteNav`.

## Step 5 — App changes
Keep the existing upload → Review → DOCX flow working exactly as now.

**Server data functions in `lib/db/`** (each builds the user-session client, so RLS applies)
- `saveVersion(...)` validates with `schemaFor(template)` (lenient structural mode), then calls
  `save_profile_version`. Store review flags even if some are open.
- `getVersion(id)` calls `get_profile_version` and validates the result with the same schema before
  returning it.
- `listMyProfiles()`, `getProfileWithVersions(id)`.
- `searchProfilesByName(q)` uses trigram similarity. It is for manager/admin only: RLS limits the
  rows, and the function also returns 403 for other roles.
- Use server actions or route handlers for all writes. Never trust ids or roles sent by the
  browser.

**Review screen**
- A "Save version" button with a label, defaulting to "Base".
- A "Save as role-specific version…" button that asks for a label and saves with its parent being
  the current version.
- A "Saved · v3 · Base" line after saving, and an unsaved-changes warning on leaving the page.

**`/profiles` (My profiles)**
- A list of the user's profiles, each showing its version history.
- Each version has two actions: "Open in Review" (loads that version's data into the form) and
  "Download DOCX" (uses the existing `generateDocx`).

**`/manage` (manager/admin only)**
- Name search, results, and a read-only version history.

No JD search box or checker screens in this task, and no placeholders for them.

## Step 6 — Data rules
- Never store the uploaded file or the raw extracted text. Store only the profile fields (in the
  tables above), the review flags, the analysis and the prompt plan.
- Never log profile content. Errors returned to the browser are generic.
- No Supabase Storage buckets in this task.
- Nothing about the Groq call changes.

## Step 7 — Tests
- RLS tests (`npm run test:rls`): sign in as each seeded user with the anon key, directly against
  the local stack, to prove the database itself enforces the table. Check that:
  - each role gets exactly its row in the table;
  - a team member can't read another member's profile by guessing its id;
  - `anon` reads and writes nothing;
  - nobody can UPDATE a version;
  - a member can't change their own role.
- Route tests: `/api/extract` and every server action return 401 without a user.
- Unit tests:
  - `saveVersion` rejects a bad shape;
  - version numbers stay sequential under concurrent saves;
  - the domain check rejects an outside email when the seed exception is off.
- **Round-trip tests** (the most important): for an internal and an external fictional profile
  with every field filled, including a range team size, an empty rating, no managerial items and
  multi-line descriptions, check that `getVersion(saveVersion(x))` deep-equals `x`.
- RLS on every child table: a member can't read another member's projects, skills or list items by
  querying the child table directly with the anon key.
- Keep all existing tests passing.

## Acceptance checks
- [ ] `npm run db:reset` builds the database from migrations + seed with no errors.
- [ ] Signed out: protected pages redirect, and `/api/extract` returns 401.
- [ ] As member: upload a resume, save v1 "Base", edit, save v2, then save a role-specific version
      "Java Backend" with v2 as its parent. All three appear in history.
- [ ] Opening v1 shows v1's data, and a DOCX from a saved version matches the pre-save DOCX.
- [ ] As manager: name search finds the seeded profiles and the member's one. As member, the search
      returns 403.
- [ ] `npm run test:rls` passes every check, including every child table.
- [ ] Round-trip tests pass for both templates.
- [ ] `grep -rn "\.from(" components app --include=*.tsx` finds no table queries in client components.
- [ ] No service-role key in any client bundle (`grep -r SERVICE_ROLE .next/static` returns nothing).
- [ ] tsc, all tests, `test-render.mjs` and the build pass.

## Not in this task
JD/requirement search (TASK-03), Checker screens (TASK-04), the cloud Supabase project and Google
sign-in (deployment, after approval), and storing original resume files (needs an HR decision).
