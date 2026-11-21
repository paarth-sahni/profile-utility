# Teams employee data (ops/teams_db.py)

The profile app needs a few facts about employees from the Teams app: the IB code (PDF file name, `/profile/<ib_code>` links),
who reports to whom (the team list, who counts as a lead) and the delivery unit and department (filters). They are read
**live** from the Teams app's Microsoft SQL Server by one Python script, `ops/teams_db.py`, which returns only the fields
below as JSON. The Next.js server runs it through `lib/teamsClient.ts`; the browser never talks to the script or the database.

## What is and isn't stored

| | |
|---|---|
| Returned per employee | IB code, email, name, role / designation, delivery unit, department, manager's email. Nothing else. |
| Read from SQL Server | Only the mapped columns of `InfoBeansMD..TeamMemberList` (no `select *`), people whose employment status is `Exit` left out by the query. |
| Stored | **Nothing.** No table, no file, no log. The Next.js server keeps answers in memory for 10 minutes per server process, then reads again. |
| Printed / logged | JSON to stdout for the caller only. A failure prints `{"error": "<code>"}` (e.g. `connect_failed`, `query_failed`, `not_configured`); the driver's own message (which could name the server) is never printed. The Next.js log gets the command name and the code, never an argument or a row. Credentials are never printed. |

## Settings

Environment only: `.env.local` locally, the server's environment in production (see `.env.example`). Only the Python
script reads the SQL settings; `lib/teamsClient.ts` passes the child process `PATH`, the locale and the `TEAMS_*` variables
and nothing else (no Supabase or LLM keys).

| Variable | |
|---|---|
| `TEAMS_SQL_HOST`, `TEAMS_SQL_PORT` (1433) | The Teams SQL Server. |
| `TEAMS_SQL_DATABASE` | May be empty: the table is named in full (`InfoBeansMD..TeamMemberList`). |
| `TEAMS_SQL_USER`, `TEAMS_SQL_PASSWORD` | A read-only account. The connection is opened read-only (`read_only=True`). |
| `TEAMS_SQL_ENCRYPT` | `require` (default), `request` or `off`. pymssql 2.4.6 (FreeTDS 1.5.19, TLS built in) supports it; whether the **server** accepts TLS is unknown until it is reachable (`connect_failed` with `require` but not with `request` would mean it does not). FreeTDS does not verify the server's certificate unless it is given a CA file. |
| `TEAMS_DB_MODE=mock` | Fictional employees (below), no connection. Local development, tests and the demo. |
| `TEAMS_DB_PYTHON`, `TEAMS_DB_SCRIPT` | Optional: the Python and the script path the Next.js server runs (defaults `python3`, `<app folder>/ops/teams_db.py`). |

For a manual run the script also reads the `TEAMS_*` lines of the repo's `.env.local` (and nothing else from it) when they
are not in the environment.

## Column mapping

`COLUMNS` at the top of `ops/teams_db.py`, marked **COLUMN MAPPING**, is the only place that knows the Teams table: our field
on the left, the Teams column on the right. The names there are guesses until the server is reachable. On the first real run:

```bash
python3 ops/teams_db.py columns     # prints {"columns": [...], "row_count": N}: names and a count, no rows
```

then fix `COLUMNS`, `MANAGER_COLUMN_HOLDS` (`"email"` if the manager column holds the manager's email, `"ib_code"` if it holds
the manager's IB code) and `EXIT_STATUSES` if needed, and run `npm run test:teams-db`.

## Commands

Each prints one JSON value to stdout (exit status 0), or `{"error": "<code>"}` (exit status 1). Arguments are checked (an
email, an IB code) before anything runs.

| Command | Prints |
|---|---|
| `python3 ops/teams_db.py by-email <email>` | One employee, or `null`. |
| `python3 ops/teams_db.py by-code <ib_code>` | One employee, or `null` (any letter case). |
| `python3 ops/teams_db.py team <manager_email>` | Everyone under them, direct and indirect (following the manager field down; a cycle cannot loop). |
| `python3 ops/teams_db.py has-reportees <email>` | `{"email": ..., "has_reportees": true/false}`: true makes the person a **lead** in the app. |
| `python3 ops/teams_db.py all` | Every active employee ("All team members"). |
| `python3 ops/teams_db.py units` | `{"delivery_units": [...], "departments": [...]}`. |
| `python3 ops/teams_db.py columns` | Column names and row count only. |

An employee is `{"ib_code", "email", "name", "role", "delivery_unit", "department", "manager_email"}`; `ib_code` may be `null`.

## Mock mode

`TEAMS_DB_MODE=mock` uses invented people at `example.test` (the local seed's sign-ins plus a few who have no account):
Morgan Director → Test Manager (`manager@`) → Test Lead (`lead@`, a plain team member in the app, but a lead because people
report to them) → Test Member (`member@`), Riya Fictional and Sam Nocode (no IB code); Test Manager → Test Member Two
(`member2@`, the other delivery unit and department). Ex Employee has employment status Exit and is never returned. Two
delivery units (Alpha, Beta) and two departments (Engineering, Quality Assurance).

## Tests

- `npm run test:teams-db`: the script with fake connections and fictional rows (query shape, encryption setting, Exit filter,
  team walk, argument checks, no secret in an error).
- `npm test` includes `lib/teamsClient.test.ts`: the real script in mock mode, the cache, the time-out and the child's
  environment.

## Server requirements

Python 3.10+ and pymssql (`pip install -r ops/requirements.txt`; the wheel bundles FreeTDS and OpenSSL). The script must be
deployed with the app: `next build` with `output: "standalone"` does not copy `ops/`, so copy `ops/teams_db.py` next to the
server (or set `TEAMS_DB_SCRIPT` to where it is). If Python, pymssql or the script is missing, or the server is unreachable,
the app keeps working: PDF names without the IB code, "Team list unavailable", and team members keep their own access only.
