#!/usr/bin/env python3
"""
Purpose: reads the Teams app's team-member list LIVE from its Microsoft SQL Server and returns only the fields the profile app
needs (IB code, email, name, role, delivery unit, department, manager's email), as JSON on stdout. Nothing is stored: no
table, no file, no log. Used by the Next.js server through lib/teamsClient.ts; see docs/TEAMS-DB.md.

Commands (each prints one JSON value to stdout; on failure {"error": "<code>"} and exit status 1, never a message from the
driver, which could name the server):
    python3 ops/teams_db.py by-email <email>         one employee or null
    python3 ops/teams_db.py by-code <ib_code>        one employee or null
    python3 ops/teams_db.py team <manager_email>     everyone under them, direct and indirect
    python3 ops/teams_db.py has-reportees <email>    {"email": ..., "has_reportees": true|false}
    python3 ops/teams_db.py all                      every active employee (the "All team members" list)
    python3 ops/teams_db.py units                    {"delivery_units": [...], "departments": [...]}
    python3 ops/teams_db.py columns                  the table's column names and row count only (first real run)

Settings (environment only; read from the process environment, or for a manual run from the repo's .env.local, TEAMS_* keys
only): TEAMS_SQL_HOST, TEAMS_SQL_PORT (1433), TEAMS_SQL_DATABASE (may be empty: the table name is fully qualified),
TEAMS_SQL_USER, TEAMS_SQL_PASSWORD, TEAMS_SQL_ENCRYPT (require | request | off; default require),
TEAMS_DB_MODE=mock (fictional employees, no connection). Credentials are never printed.
"""
import json
import os
import re
import sys
from pathlib import Path

# ======================================================================================================================
# COLUMN MAPPING: the one place that knows the Teams table. Fix these names once the real ones are known (`columns` prints
# them). Left: our field. Right: the column in InfoBeansMD..TeamMemberList. Only these columns are ever selected.
# ======================================================================================================================
TABLE_DATABASE = "InfoBeansMD"
TABLE_NAME = "TeamMemberList"
COLUMNS = {
    "ib_code": "EmployeeCode",
    "email": "EmailId",
    "name": "EmployeeName",
    "role": "Designation",
    "delivery_unit": "DeliveryUnit",
    "department": "Department",
    "manager": "ReportingManagerEmail",
    "status": "EmploymentStatus",
}
# What the "manager" column holds: "email" (the manager's email) or "ib_code" (the manager's IB code, turned into the
# manager's email here).
MANAGER_COLUMN_HOLDS = "email"
# Employment status values that mean the person has left (compared case-insensitively, trimmed): excluded everywhere.
EXIT_STATUSES = {"exit"}
# ======================================================================================================================

FIELDS = ("ib_code", "email", "name", "role", "delivery_unit", "department", "manager_email")
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_ ]{0,127}$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}$")
IB_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")
ROOT = Path(__file__).resolve().parent.parent


class TeamsDBError(Exception):
    """A failure with a code that is safe to print (no server name, user, password or row)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def quoted(identifier: str) -> str:
    """A SQL Server identifier in brackets, refused unless it is a plain name (the mapping is not user input, but still)."""
    if not IDENTIFIER.match(identifier):
        raise TeamsDBError("bad_column_name")
    return f"[{identifier}]"


def table() -> str:
    # a three-part name with the default schema (InfoBeansMD..TeamMemberList), so TEAMS_SQL_DATABASE may be empty
    return f"{quoted(TABLE_DATABASE)}..{quoted(TABLE_NAME)}"


def select_sql() -> str:
    """The one query for employees: the mapped columns only (no select *), the people who have left excluded."""
    cols = ", ".join(f"{quoted(c)} as {quoted(k)}" for k, c in COLUMNS.items())
    status = quoted(COLUMNS["status"])
    exits = ", ".join("'" + s.replace("'", "''") + "'" for s in sorted(EXIT_STATUSES))
    return f"select {cols} from {table()} where {status} is null or lower(ltrim(rtrim({status}))) not in ({exits})"


def text(value) -> str:
    return "" if value is None else str(value).strip()


def clean(rows: list[dict]) -> list[dict]:
    """Raw rows (keyed by our field names) -> employees: trimmed, emails lower case, the people who have left dropped (again,
    in case the server compares differently), rows without an email dropped, the manager as an email."""
    active = [r for r in rows if text(r.get("status")).lower() not in EXIT_STATUSES]
    by_code = {text(r.get("ib_code")).upper(): text(r.get("email")).lower() for r in active if text(r.get("ib_code"))}
    out, seen = [], set()
    for r in active:
        email = text(r.get("email")).lower()
        if not EMAIL.match(email) or email in seen:
            continue
        seen.add(email)
        manager = text(r.get("manager"))
        manager_email = by_code.get(manager.upper(), "") if MANAGER_COLUMN_HOLDS == "ib_code" else manager.lower()
        out.append({
            "ib_code": text(r.get("ib_code")) or None,
            "email": email,
            "name": text(r.get("name")),
            "role": text(r.get("role")) or None,
            "delivery_unit": text(r.get("delivery_unit")) or None,
            "department": text(r.get("department")) or None,
            "manager_email": manager_email or None,
        })
    return out


# ------------------------------------------------------------------------------------------------ mock (fictional only)
# TEAMS_DB_MODE=mock: invented people at example.test, keyed by the Teams column names above so the mapping and the Exit
# filter are exercised too. The @example.test sign-ins are the local seed users (supabase/seed.sql):
#   Morgan Director (no app account) -> Test Manager -> Test Lead (a plain team_member in the app) -> Test Member
#                                                    -> Riya Fictional; Sam Nocode (no IB code)
#                                  -> Test Member Two (other delivery unit and department)
#   Test Admin and Test Checker report to Morgan Director; Ex Employee has left (Exit) and is never returned.
MOCK_ROWS = [
    ("IB9000", "director@example.test", "Morgan Director", "Director of Delivery", "Delivery Unit Alpha", "Engineering", "", "Active"),
    ("IB9001", "manager@example.test", "Test Manager", "Delivery Manager", "Delivery Unit Alpha", "Engineering", "director@example.test", "Active"),
    ("IB9002", "lead@example.test", "Test Lead", "Technical Lead", "Delivery Unit Alpha", "Engineering", "manager@example.test", "Active"),
    ("IB9003", "member@example.test", "Test Member", "Software Engineer", "Delivery Unit Alpha", "Engineering", "lead@example.test", "Active"),
    ("IB9004", "member2@example.test", "Test Member Two", "QA Engineer", "Delivery Unit Beta", "Quality Assurance", "manager@example.test", "Active"),
    ("IB9005", "riya.fictional@example.test", "Riya Fictional", "Business Analyst", "Delivery Unit Beta", "Quality Assurance", "lead@example.test", "Active"),
    ("", "sam.nocode@example.test", "Sam Nocode", "AI Intern", "Delivery Unit Beta", "Quality Assurance", "lead@example.test", "Active"),
    ("IB9006", "ex.employee@example.test", "Ex Employee", "Software Engineer", "Delivery Unit Alpha", "Engineering", "lead@example.test", "Exit"),
    ("IB9007", "admin@example.test", "Test Admin", "Operations Head", "Delivery Unit Alpha", "Engineering", "director@example.test", "Active"),
    ("IB9008", "checker@example.test", "Test Checker", "Quality Checker", "Delivery Unit Beta", "Quality Assurance", "director@example.test", "Active"),
]
MOCK_COLUMNS = list(COLUMNS.values())


def mock_raw_rows() -> list[dict]:
    rows = [dict(zip(MOCK_COLUMNS, r)) for r in MOCK_ROWS]
    if MANAGER_COLUMN_HOLDS == "ib_code":  # the mock follows the mapping: managers by code
        code = {r[COLUMNS["email"]]: r[COLUMNS["ib_code"]] for r in rows}
        for r in rows:
            r[COLUMNS["manager"]] = code.get(r[COLUMNS["manager"]], "")
    # as the query returns them: keyed by our field names, the people who have left filtered out by the query
    return [{k: r[c] for k, c in COLUMNS.items()} for r in rows if text(r[COLUMNS["status"]]).lower() not in EXIT_STATUSES]


# ------------------------------------------------------------------------------------------------------------- the class
def settings(env=None) -> dict:
    """TEAMS_* settings from the environment, or (manual runs) from the repo's .env.local, TEAMS_* keys only."""
    env = dict(os.environ if env is None else env)
    local = ROOT / ".env.local"
    if not env.get("TEAMS_SQL_HOST") and env.get("TEAMS_DB_MODE") != "mock" and local.exists():
        for line in local.read_text(encoding="utf8").splitlines():
            m = re.match(r"^\s*(TEAMS_[A-Z_]+)\s*=\s*(.*?)\s*$", line)
            if m and not env.get(m.group(1)):
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return {k: v for k, v in env.items() if k.startswith("TEAMS_")}


class TeamsDB:
    """The team-member list, read live. `connect` makes the DB-API connection (pymssql.connect by default; tests pass a fake).
    Each call reads the table once; the Next.js server caches answers for 10 minutes (lib/teamsClient.ts)."""

    def __init__(self, env=None, connect=None):
        self.env = settings(env)
        self.mock = self.env.get("TEAMS_DB_MODE", "").strip().lower() == "mock"
        self._connect = connect
        self._employees = None

    # -- connection
    def connection(self):
        host, user, password = (self.env.get(k, "").strip() for k in ("TEAMS_SQL_HOST", "TEAMS_SQL_USER", "TEAMS_SQL_PASSWORD"))
        if not host or not user or not password:
            raise TeamsDBError("not_configured")
        encryption = (self.env.get("TEAMS_SQL_ENCRYPT") or "require").strip().lower()
        if encryption not in ("require", "request", "off"):
            raise TeamsDBError("bad_encrypt_setting")
        connect = self._connect
        if connect is None:
            try:
                import pymssql  # imported here so mock mode and the tests need no driver
            except ImportError:
                raise TeamsDBError("driver_missing") from None
            connect = pymssql.connect
        port = (self.env.get("TEAMS_SQL_PORT") or "1433").strip()
        if not port.isdigit():
            raise TeamsDBError("bad_port")
        try:
            return connect(
                server=host, port=port, user=user, password=password, database=(self.env.get("TEAMS_SQL_DATABASE") or "").strip(),
                login_timeout=4, timeout=8, encryption=encryption, read_only=True, as_dict=True, appname="profile-utility",
            )
        except Exception:
            raise TeamsDBError("connect_failed") from None

    def query(self, sql: str, params=()) -> list[dict]:
        conn = self.connection()
        try:
            cur = conn.cursor()
            cur.execute(sql, params) if params else cur.execute(sql)
            return list(cur.fetchall())
        except TeamsDBError:
            raise
        except Exception:
            raise TeamsDBError("query_failed") from None
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # -- data
    def employees(self) -> list[dict]:
        if self._employees is None:
            self._employees = clean(mock_raw_rows() if self.mock else self.query(select_sql()))
        return self._employees

    def by_email(self, email: str):
        email = text(email).lower()
        return next((e for e in self.employees() if e["email"] == email), None)

    def by_ib_code(self, code: str):
        code = text(code).upper()
        return next((e for e in self.employees() if e["ib_code"] and e["ib_code"].upper() == code), None) if code else None

    def team(self, manager_email: str) -> list[dict]:
        """Everyone under the manager, direct and indirect (breadth first; a cycle in the data cannot loop)."""
        reports: dict[str, list[dict]] = {}
        for e in self.employees():
            if e["manager_email"]:
                reports.setdefault(e["manager_email"], []).append(e)
        start = text(manager_email).lower()
        out, seen, queue = [], {start}, [start]
        while queue:
            for e in reports.get(queue.pop(0), []):
                if e["email"] not in seen:
                    seen.add(e["email"])
                    out.append(e)
                    queue.append(e["email"])
        return out

    def has_reportees(self, email: str) -> bool:
        email = text(email).lower()
        return bool(email) and any(e["manager_email"] == email for e in self.employees())

    def all(self) -> list[dict]:
        return list(self.employees())

    def units(self) -> dict:
        es = self.employees()
        return {
            "delivery_units": sorted({e["delivery_unit"] for e in es if e["delivery_unit"]}, key=str.lower),
            "departments": sorted({e["department"] for e in es if e["department"]}, key=str.lower),
        }

    def columns(self) -> dict:
        """The table's column names and its row count, nothing else (for the first real run, to fix COLUMN MAPPING)."""
        if self.mock:
            return {"columns": MOCK_COLUMNS, "row_count": len(MOCK_ROWS)}
        names = self.query(
            f"select COLUMN_NAME as name from {quoted(TABLE_DATABASE)}.INFORMATION_SCHEMA.COLUMNS where TABLE_NAME = %s order by ORDINAL_POSITION",
            (TABLE_NAME,),
        )
        count = self.query(f"select count(*) as n from {table()}")
        return {"columns": [text(r["name"]) for r in names], "row_count": int(count[0]["n"]) if count else 0}


# ------------------------------------------------------------------------------------------------------------- the CLI
def run(argv: list[str], db: TeamsDB | None = None):
    """The result of one command (a JSON-able value); TeamsDBError("bad_arguments") for a wrong call."""
    if not argv:
        raise TeamsDBError("bad_arguments")
    command, args = argv[0], argv[1:]
    db = db or TeamsDB()
    one_email = len(args) == 1 and EMAIL.match(args[0].strip())
    if command == "by-email" and one_email:
        return db.by_email(args[0])
    if command == "by-code" and len(args) == 1 and IB_CODE.match(args[0].strip()):
        return db.by_ib_code(args[0])
    if command == "team" and one_email:
        return db.team(args[0])
    if command == "has-reportees" and one_email:
        return {"email": args[0].strip().lower(), "has_reportees": db.has_reportees(args[0])}
    if command == "all" and not args:
        return db.all()
    if command == "units" and not args:
        return db.units()
    if command == "columns" and not args:
        return db.columns()
    raise TeamsDBError("bad_arguments")


def main() -> int:
    try:
        result = run(sys.argv[1:])
    except TeamsDBError as e:
        print(json.dumps({"error": e.code}))
        return 1
    except Exception:
        print(json.dumps({"error": "internal"}))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
