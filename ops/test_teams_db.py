"""
Purpose: unit tests for ops/teams_db.py with fake connections and fictional rows (no SQL Server needed).
Run: npm run test:teams-db   (python3 -m unittest discover -s ops -p "test_teams_db.py")
"""
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import teams_db  # noqa: E402
from teams_db import COLUMNS, TeamsDB, TeamsDBError, run, select_sql  # noqa: E402

ENV = {"TEAMS_SQL_HOST": "sql.invalid", "TEAMS_SQL_USER": "reader", "TEAMS_SQL_PASSWORD": "not-a-real-password"}


def row(code, email, name, manager="", status="Active", unit="Unit A", dept="Dept A", role="Engineer", lead=""):
    """A fictional row as the query returns it (keyed by our field names: the SELECT aliases them)."""
    return {"ib_code": code, "email": email, "full_name": name, "role": role, "delivery_unit": unit, "department": dept,
            "status": status, "lead": lead, "manager": manager}


class FakeConnection:
    def __init__(self, results):
        self.results = list(results)
        self.executed = []
        self.closed = False

    def cursor(self):
        conn = self

        class Cursor:
            def execute(self, sql, params=()):
                conn.executed.append((sql, params))

            def fetchall(self):
                return conn.results.pop(0)

        return Cursor()

    def close(self):
        self.closed = True


def fake_db(rows, env=ENV):
    calls = {}

    def connect(**kwargs):
        calls.update(kwargs)
        calls["conn"] = FakeConnection([rows])
        return calls["conn"]

    return TeamsDB(env=env, connect=connect), calls


ROWS = [
    row("IB1", "Boss@Example.test ", "Fictional Boss"),
    row("IB2", "lead@example.test", "Fictional Lead", manager="boss@example.test", unit="Unit B"),
    row("IB3", "dev@example.test", "Fictional Dev", lead="LEAD@example.test", manager="boss@example.test", dept="Dept B"),
    row("", "nocode@example.test", "Fictional Nocode", manager="lead@example.test"),
    row("IB4", "gone@example.test", "Fictional Gone", manager="lead@example.test", status=" EXIT "),
    row("IB5", "lead@example.test", "Duplicate Email"),
    row("IB6", "", "No Email"),
]


class Query(unittest.TestCase):
    def test_selects_only_the_mapped_columns_and_excludes_exit(self):
        sql = select_sql()
        self.assertNotIn("*", sql)
        for ours, theirs in COLUMNS.items():
            self.assertIn(f"[{theirs}] as [{ours}]", sql)
        self.assertIn("from [InfoBeansMD]..[TeamMemberList]", sql)
        self.assertEqual(COLUMNS, {
            "ib_code": "TeamMemberCode", "email": "Email", "full_name": "FullName", "role": "Designation",
            "delivery_unit": "DeliveryUnit", "department": "Department", "status": "EmploymentStatus",
            "lead": "LeadEmail", "manager": "ManagerEmail",
        })
        self.assertEqual(sql.count(" as ["), len(COLUMNS), "only the mapped columns")
        self.assertIn("not in ('exit')", sql)

    def test_a_column_name_that_is_not_a_plain_name_is_refused(self):
        with self.assertRaises(TeamsDBError):
            teams_db.quoted("Email]; drop table x --")


class Connection(unittest.TestCase):
    def test_encrypted_read_only_with_timeouts(self):
        db, calls = fake_db(ROWS)
        db.employees()
        self.assertEqual(calls["encryption"], "require")
        self.assertTrue(calls["read_only"])
        self.assertLessEqual(calls["login_timeout"] + 0, 5)
        self.assertEqual(calls["port"], "1433")
        self.assertEqual(calls["database"], "", "TEAMS_SQL_DATABASE may be empty")
        self.assertTrue(calls["conn"].closed)

    def test_settings(self):
        with self.assertRaises(TeamsDBError) as e:
            fake_db(ROWS, env={**ENV, "TEAMS_SQL_ENCRYPT": "maybe"})[0].employees()
        self.assertEqual(e.exception.code, "bad_encrypt_setting")
        with self.assertRaises(TeamsDBError) as e:
            fake_db(ROWS, env={"TEAMS_SQL_HOST": "sql.invalid"})[0].employees()
        self.assertEqual(e.exception.code, "not_configured")

    def test_a_driver_error_becomes_a_code_and_nothing_secret_is_printed(self):
        def failing(**kwargs):
            raise RuntimeError(f"login failed for {kwargs['user']} with {kwargs['password']} at {kwargs['server']}")

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                run(["units"], TeamsDB(env=ENV, connect=failing))
            except TeamsDBError as e:
                print(json.dumps({"error": e.code}))
        printed = out.getvalue()
        self.assertEqual(json.loads(printed), {"error": "connect_failed"})
        for secret in ENV.values():
            self.assertNotIn(secret, printed)


class Data(unittest.TestCase):
    def setUp(self):
        self.db, _ = fake_db(ROWS)

    def test_cleaning(self):
        emails = [e["email"] for e in self.db.employees()]
        self.assertEqual(emails, ["boss@example.test", "lead@example.test", "dev@example.test", "nocode@example.test"])
        self.assertNotIn("gone@example.test", emails, "employment status Exit is excluded (any case, trimmed)")
        self.assertEqual(set(self.db.employees()[0]), {"ib_code", "email", "name", "role", "delivery_unit", "department", "lead_email", "manager_email"})
        self.assertEqual(self.db.by_email("dev@example.test")["lead_email"], "lead@example.test")
        self.assertIsNone(self.db.by_email("nocode@example.test")["ib_code"])

    def test_lookups(self):
        self.assertEqual(self.db.by_email(" DEV@example.test")["name"], "Fictional Dev")
        self.assertEqual(self.db.by_ib_code("ib3")["email"], "dev@example.test")
        self.assertIsNone(self.db.by_ib_code("IB4"), "people who have left are not found")
        self.assertIsNone(self.db.by_ib_code(""))

    def test_team_direct_and_indirect_and_reportees(self):
        self.assertEqual([e["email"] for e in self.db.team("boss@example.test")], ["lead@example.test", "dev@example.test", "nocode@example.test"])
        self.assertEqual([e["email"] for e in self.db.team("lead@example.test")], ["dev@example.test", "nocode@example.test"])
        self.assertEqual(self.db.team("dev@example.test"), [])
        self.assertTrue(self.db.has_reportees("LEAD@example.test"))
        self.assertFalse(self.db.has_reportees("dev@example.test"))
        self.assertEqual(self.db.units(), {"delivery_units": ["Unit A", "Unit B"], "departments": ["Dept A", "Dept B"]})

    def test_a_reporting_cycle_does_not_loop(self):
        db, _ = fake_db([row("IB1", "a@example.test", "A", manager="b@example.test"), row("IB2", "b@example.test", "B", manager="a@example.test")])
        self.assertEqual([e["email"] for e in db.team("a@example.test")], ["b@example.test"])

    def test_team_through_lead_or_manager(self):
        db, _ = fake_db([
            row("IB1", "boss@example.test", "Boss"),
            row("IB2", "lead@example.test", "Lead", manager="boss@example.test"),
            row("IB3", "a@example.test", "A", lead="lead@example.test", manager="boss@example.test"),
            row("IB4", "b@example.test", "B", lead="a@example.test"),
            row("IB5", "self@example.test", "Self", lead="self@example.test", manager="self@example.test"),
        ])
        self.assertEqual([e["email"] for e in db.team("lead@example.test")], ["a@example.test", "b@example.test"], "through LeadEmail")
        self.assertEqual([e["email"] for e in db.team("boss@example.test")], ["lead@example.test", "a@example.test", "b@example.test"], "no duplicates")
        self.assertTrue(db.has_reportees("a@example.test"), "a lead through LeadEmail only")
        self.assertFalse(db.has_reportees("self@example.test"), "reporting to oneself does not make a lead")
        self.assertEqual(db.team("self@example.test"), [])

    def test_statuses_reads_values_and_counts_only(self):
        conns = []

        def connect(**k):
            conns.append(FakeConnection([[{"status": "Active", "n": 5}, {"status": None, "n": 1}]]))
            return conns[-1]

        out = TeamsDB(env=ENV, connect=connect).statuses()
        self.assertEqual(out, [{"status": "Active", "count": 5}, {"status": None, "count": 1}])
        sql = conns[0].executed[0][0]
        self.assertIn("group by [EmploymentStatus]", sql)
        for col in ("FullName", "Email]", "TeamMemberCode"):
            self.assertNotIn(col, sql)

    def test_columns_reads_names_and_count_only(self):
        results =[[{"name": "EmployeeCode"}, {"name": "EmailId"}], [{"n": 42}]]
        conns = []

        def connect(**k):
            conns.append(FakeConnection([results.pop(0)]))
            return conns[-1]

        out = TeamsDB(env=ENV, connect=connect).columns()
        self.assertEqual(out, {"columns": ["EmployeeCode", "EmailId"], "row_count": 42})
        sqls = [c.executed[0][0] for c in conns]
        self.assertIn("INFORMATION_SCHEMA.COLUMNS", sqls[0])
        self.assertTrue(all("*" not in s.replace("count(*)", "") for s in sqls), "no select *")


class Mock(unittest.TestCase):
    def setUp(self):
        self.db = TeamsDB(env={"TEAMS_DB_MODE": "mock"})

    def test_mock_people(self):
        emails = {e["email"] for e in self.db.all()}
        self.assertNotIn("ex.employee@example.test", emails)
        self.assertTrue(all(e.endswith("@example.test") for e in emails), "fictional addresses only")
        team = self.db.team("manager@example.test")
        self.assertEqual({e["delivery_unit"] for e in team}, {"Delivery Unit Alpha", "Delivery Unit Beta"})
        self.assertEqual({e["department"] for e in team}, {"Engineering", "Quality Assurance"})
        self.assertIn("member@example.test", {e["email"] for e in team}, "an indirect reportee (through the lead)")
        self.assertTrue(self.db.has_reportees("lead@example.test"))
        self.assertIsNone(self.db.by_email("sam.nocode@example.test")["ib_code"])

    def test_cli_arguments_are_validated(self):
        for argv in ([], ["by-email"], ["by-email", "not an email"], ["by-code", "IB1; drop"], ["units", "extra"], ["delete", "x"]):
            with self.assertRaises(TeamsDBError):
                run(argv, self.db)
        self.assertEqual(run(["by-code", "IB9002"], self.db)["email"], "lead@example.test")
        self.assertEqual(run(["statuses"], self.db), [{"status": "Active", "count": 9}, {"status": "Exit", "count": 1}])
        with self.assertRaises(TeamsDBError):
            run(["statuses", "extra"], self.db)


if __name__ == "__main__":
    unittest.main()
