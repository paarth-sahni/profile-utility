# Client-name compliance: handover and runbook

Written for the engineer who picks this up next (Saumya) and for whoever deploys it. Everything below describes the code in this
repository; nothing has been applied to a hosted database and enforcement is **off** until someone sets `COMPLIANCE_ENFORCE=on`.

## 1. What it does

A generated profile (internal or external) must not name a client, company or project from the business's client list.

1. The list lives in a Google Sheet ("InfoBeans Client List": one tab, header `S.No | Client Name | Legal Name | Friendly Name | Client Group`).
2. A job copies the four name columns into the database (the **registry**) on the 5th and 20th of each month, or when an administrator
   presses a button. Profiles are never checked against Google directly.
3. While editing, the browser asks the server which typed text matches a registered name and marks it in red, with the text highlighted.
4. The server refuses the profile at the protected steps: **Preview** (the PDF), **PDF download** and **Submit**, whatever the browser did.

Not covered, by decision: names that are not on the list (no unknown-company detection), and project names (the new sheet has none).

```
Google Sheet --(read-only service account, A:E)--> runSync --(service_role-only functions)--> registry tables (Supabase)
                                                      ^                                              |
      timer every 30 min -> /api/internal/sync        |                                              v
      admin button      -> /api/admin/sync -----------+            compliance_registry_names() -> cached matcher (60 s)
                                                                              |
   browser (Edit step) -> /api/compliance/check -------------------------------+--> red marks + highlighted text
   Preview / PDF / Submit -> /api/pdf, /api/profiles -> complianceGate -> 422 COMPLIANCE or 503 REGISTRY_UNAVAILABLE
```

## 2. Where things are

| Area | Files |
|---|---|
| Matching (pure) | `lib/compliance/normalize.ts` (one way to normalise), `match.ts` (whole-word phrases, longest match), `check.ts` (scans every real string of a profile) |
| Server gate | `lib/compliance/gate.ts` (decision, 422/503 bodies), `registryCache.ts` (60 s cache, 24 h stale copy), `registry.ts` (wiring, server-only) |
| Routes | `app/api/pdf`, `app/api/profiles` (call the gate), `app/api/compliance/check` (live check), `app/api/admin/sync`, `app/api/admin/compliance/review`, `app/api/internal/sync` |
| Sheet reading | `lib/sync/googleAuth.ts` (JWT), `sheetsClient.ts` (A:E only), `parseTab.ts` (headers by value), `tabs.ts`, `buildSnapshot.ts`, `hints.ts` (safe error wording) |
| Running a sync | `lib/sync/runSync.ts` (one attempt, always closes its run), `runner.ts` (real wiring), `retry.ts`, `scheduler.ts`, `health.ts`, `config.ts`, `errors.ts` |
| Service key | `lib/sync/adminClient.ts` is the **only** file that reads `SUPABASE_SERVICE_ROLE_KEY` (a test enforces it) |
| Admin UI | `app/admin/compliance/page.tsx`, `components/admin/*`, `lib/db/compliance*.ts`, link in `components/SiteNav.tsx` |
| Editing UI | `components/fields.tsx` (highlights), `InternalForm.tsx`, `ExternalForm.tsx`, `ProfileWorkflow.tsx`, `useComplianceCheck.ts`, `lib/complianceClient.ts` |
| Database | `supabase/migrations/20261023120000_compliance_tables.sql`, `..120100_compliance_rpcs.sql`, `..120200_compliance_settings_seed.sql` |
| Database support | `supabase/rollback/20261023_compliance_rollback.sql`, `docs/compliance-precheck.sql`, `docs/compliance-verify.sql` |
| Ops | `ops/profile-sync.service`, `ops/profile-sync.timer`, `ops/nginx-block-internal.conf` |

## 3. Settings (environment)

| Variable | Purpose |
|---|---|
| `COMPLIANCE_ENFORCE` | `on` enforces. Unset or anything else = dormant (nothing checked, no service key needed). The instant kill switch. |
| `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` | Read-only service account and the sheet. The key goes on **one line in double quotes with `\n` for line breaks**. |
| `SYNC_TAB_NAMES` | Optional comma list. Default: read every tab. A tab without the expected header makes the sync partial, so exclude notes tabs. |
| `SUPABASE_SERVICE_ROLE_KEY` | Used only by `lib/sync/adminClient.ts` (sync, the registry read, the scheduler state). Add to production only after the migrations are verified. |
| `SYNC_CRON_SECRET` | Shared secret for the timer. Without it the scheduled endpoint answers 503. |
| `SYNC_TIMEZONE` | Zone for "the 5th and 20th" (default `Asia/Kolkata`). |
| `GOOGLE_SA_KEY_CREATED` | Optional `YYYY-MM-DD`; the admin page reminds at about 12 months. |

Schedule days, retry limit and "stale after" are rows in `compliance_settings` (defaults 5 and 20, 4 tries, 20 days), changed with a plain SQL `UPDATE`.

## 4. How the sheet is read

- Only columns **A:E** are requested. `S.No` is never read. `Client Name` and `Legal Name` are required headers; `Friendly Name` and
  `Client Group` are optional (a missing one is reported, not silent). Headers are found by text, so row position and column order do not matter.
- A tab is `ok`, `empty`, `unparseable` (no required headers) or `ambiguous` (header twice). Unparseable and ambiguous are **never** treated as empty.
- A snapshot is **complete** only if every selected tab was read and parsed. Only a complete snapshot may conclude that a name is missing.
  A partial run still adds new names but marks nothing missing.
- The same text in several columns is one name with several types (client, legal, friendly, group). Look-alikes ("Acme Ltd" / "Acme Limited") are never merged.

## 5. Missing names and removal

A name seen nowhere in a **complete** run becomes `pending_removal_review`. It **stays enforced**. An administrator chooses *Keep enforcing* or
*Stop enforcing* on `/admin/compliance`. Nothing is ever deleted (a trigger rejects DELETE on every registry table) and a sync never reactivates a
deactivated name. Every decision and every sync is written to `audit_log`.

## 6. Security model

- Employees cannot read the registry (only managers and admins can, through row level security) and cannot call any sync function. The profile check
  reads the list through `compliance_registry_names()`, which only the service key can run, so the full list never reaches a browser.
- `service_role` has **no table privilege** on the registry tables; it can only execute the six functions. The platform still gives it full access to the
  rest of the database, so the key itself must be guarded like a root password (file mode 600, never in git, bundles, chat or logs).
- Only administrators can start a sync or review a name: checked in the route and again inside the database function.
- Run history and logs hold counts, tab titles and codes only. Error text is fixed wording chosen by code; Google's responses, cell values, the spreadsheet id and keys are never repeated.
- The scheduler endpoint has three locks: blocked in nginx (`ops/nginx-block-internal.conf`), refuses requests carrying forwarding headers, and needs the shared secret.

## 7. Deploying (in this order)

1. **Database (hosted Supabase, by hand).** Back up / confirm point-in-time recovery. Run `docs/compliance-precheck.sql` (expect 0, 0, 0 then true, true, true). Apply the three migrations one at a time in order
   (they are idempotent and wrapped in a transaction). Run `docs/compliance-verify.sql` and compare each result with its comment. Rollback: set `COMPLIANCE_ENFORCE=off`, then `psql -1 -f supabase/rollback/20261023_compliance_rollback.sql`.
2. **Code**, with `COMPLIANCE_ENFORCE` unset. Safe: nothing is checked.
3. **Google access.** Needs the sheet shared with the service account (see 10). Run `npm run sync:inspect` (structure only, no database write); fix anything it reports.
4. **Service key.** Add `SUPABASE_SERVICE_ROLE_KEY` and `SYNC_CRON_SECRET` to `/var/www/profile/.env` (chmod 600), restart the app.
5. **First sync.** Sign in as an administrator, open `/admin/compliance`, press *Synchronise now*, and compare the counts with the sheet.
6. **Timer.** Install `ops/profile-sync.service` and `.timer`, add `ops/nginx-block-internal.conf`, reload nginx.
7. **Switch enforcement on.** Set `COMPLIANCE_ENFORCE=on`, restart, test with a fictional registered name on both the internal and external forms.

## 8. Tests

| Command | What it covers |
|---|---|
| `npm test` | All unit tests, including matching, the parser, the Google client (fake network), the runner, the gate and cache, the scheduler, the UI helpers and the "service key is read in one file" scan. The PDF tests need LibreOffice. |
| `npm run test:compliance` | Registry SQL: privileges, row security, constraints, sync behaviour as each role, rollback script. Needs `psql` and the local stack. |
| `npm run test:sync` | The real sync path against the **local** database with a fake sheet (refuses any non-loopback URL). Leaves rows: clean the local database with `truncate compliance_name_sources, compliance_names, compliance_sync_runs`. |
| `npm run test:rls`, `npm run test:db` | Existing suites; the registry tables are included. |
| `npm run sync:inspect` | Reads the real sheet and prints structure only. Run by a person with access. |

Tests use fictional names only. Never run any of the database tests against a hosted database.

## 9. Behaviour worth knowing

- **Fail closed.** With enforcement on and the registry unloadable, Preview, PDF and Submit answer 503. A copy loaded in the last 24 hours keeps being used while the database or key has a short problem.
- **Cache.** The list is cached for 60 seconds per process (the app is single instance). A successful sync clears the cache at once.
- **Consent.** Download still records consent (`/api/consent`) before it runs; its PDF only exists after the gate passed. **Submit** sends the tick inside the save request and `POST /api/profiles` records it only after the client-name gate passes (order: gate, metadata clean-up, consent, save; `lib/profileSave.ts`). A refused Submit (422/503) leaves no consent row. The only case with a consent row and no saved version is a database failure during the save itself, which was a real attempt. Re-submitting an already saved, unchanged version sends no profile content and creates no version; it has no save request, so it asks the server's name check first (`lib/resubmit.ts`: check, consent, then optionally mark primary) and stops, recording nothing, if a name is now registered or the check is unavailable.
- **Submit is disabled while the checker flags the profile**, on the Preview step as well as Edit; the server refuses it regardless.
- **"Open in Google Docs"** builds the file in the browser, so the server cannot gate it like the PDF. It asks the server to check just before the upload and stops if a name is found. This is the one path that relies on the browser.
- **Stored metadata is cleaned, not blocked.** The review flags (reason, path), analysis notes, earliest-start text and prompt plan and version label saved with an internal version are free text the person cannot see, so a registered name in them cannot be fixed by the person. With enforcement on, `POST /api/profiles` replaces such a flag reason or note with fixed text and drops a matching path or prompt-plan entry, then saves (`lib/compliance/redact.ts`). Not scanned on purpose: enum and boolean analysis fields (cannot hold a name), browser drafts and the `/api/extract` response (the person's own data in their own browser), and raw upload text (not stored).

## 10. Open items

- **Google access is blocked by InfoBeans policy**: the sheet cannot be shared with the service-account address (it is not in an allowlisted domain). IT must allow it, or move the service account into a project under the InfoBeans organisation. Until then `sync:inspect` answers `SHEETS_AUTH`. Interim: test with a copy of the sheet owned by a developer (fictional names preferred), changing only `GOOGLE_SHEETS_SPREADSHEET_ID`.
- **Project names**: the new sheet has no project names, so they are not enforced. Needs a source if the business still wants it.
- **False positives**: Friendly Name and Client Group can hold short or generic words. They appear as anomalies; an allow-list is the future answer.
- **Notifications** are in-app only (the admin page and the run history). No email or chat integration exists.
- **Key rotation**: the service-account key is rotated once or twice a year by hand (Google Cloud → IAM → Service Accounts → Keys → add, update `.env`, restart, delete the old key).
- `lib/database.types.ts` was not regenerated; the new code calls the registry functions untyped. Run `npm run db:types` against the local stack when convenient.
