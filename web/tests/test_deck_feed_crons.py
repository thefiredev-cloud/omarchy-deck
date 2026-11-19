"""deck-feed-crons: cron maths, Hermes jobs.json reading (no prompts leave), GitHub result mapping, launchd calendar maths,
and a failing source staying visible instead of reading as zero jobs. Run: python3 -m unittest tests.test_deck_feed_crons"""
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "deck-feed-crons"
_loader = importlib.machinery.SourceFileLoader("deck_feed_crons", str(_PATH))
_spec = importlib.util.spec_from_loader("deck_feed_crons", _loader)
fc = importlib.util.module_from_spec(_spec)
_loader.exec_module(fc)


def utc(*a):
    return int(dt.datetime(*a, tzinfo=dt.timezone.utc).timestamp())


class CronNext(unittest.TestCase):
    def test_daily_and_lists(self):
        self.assertEqual(fc.cron_next("0 9 * * *", utc(2026, 10, 5, 8, 59)), utc(2026, 10, 5, 9, 0))
        self.assertEqual(fc.cron_next("0 9 * * *", utc(2026, 10, 5, 9, 0)), utc(2026, 10, 6, 9, 0))
        self.assertEqual(fc.cron_next("0 6,18 * * *", utc(2026, 10, 5, 7, 0)), utc(2026, 10, 5, 18, 0))

    def test_steps(self):
        self.assertEqual(fc.cron_next("*/30 * * * *", utc(2026, 10, 5, 8, 31)), utc(2026, 10, 5, 9, 0))
        self.assertEqual(fc.cron_next("0 */4 * * *", utc(2026, 10, 5, 8, 1)), utc(2026, 10, 5, 12, 0))
        self.assertEqual(fc.cron_next("20 7,19 * * *", utc(2026, 10, 5, 19, 20)), utc(2026, 10, 6, 7, 20))

    def test_weekday_and_names(self):
        # 2026-10-05 is a Monday
        self.assertEqual(fc.cron_next("0 10 * * 1", utc(2026, 10, 5, 10, 0)), utc(2026, 10, 12, 10, 0))
        self.assertEqual(fc.cron_next("0 9 * * MON-FRI", utc(2026, 10, 3, 12, 0)), utc(2026, 10, 5, 9, 0))
        self.assertEqual(fc.cron_next("0 0 * * 7", utc(2026, 10, 5, 0, 0)), utc(2026, 10, 11, 0, 0))

    def test_day_of_month_or_weekday_when_both_restricted(self):
        self.assertEqual(fc.cron_next("0 0 15 * 1", utc(2026, 10, 6, 0, 0)), utc(2026, 10, 12, 0, 0))

    def test_bad_expressions_raise(self):
        for bad in ("* * * *", "61 * * * *", "*/0 * * * *", "a b c d e"):
            with self.assertRaises(ValueError):
                fc.cron_next(bad, 0)


class Hermes(unittest.TestCase):
    def _jobs(self, rows):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "jobs.json")
        with open(p, "w") as fh:
            json.dump({"jobs": rows}, fh)
        return p

    def test_reads_names_times_and_status_only(self):
        rows = [
            {"id": "a1", "name": "Daily", "prompt": "TOPSECRET", "script": "/home/x/s.py", "skills": ["s"], "deliver": "telegram:1",
             "last_error": "traceback SECRETERR", "schedule_display": "0 7 * * *", "enabled": True, "state": "scheduled",
             "last_status": "ok", "last_run_at": "2026-10-05T07:02:22.725421-07:00", "next_run_at": "2026-10-06T07:00:00-07:00"},
            {"id": "b2", "name": "Bad", "schedule_display": "every 15m", "enabled": True, "state": "scheduled", "last_status": "error",
             "failure_streak": 111, "last_run_at": "2026-10-05T21:59:00-07:00", "next_run_at": "2026-10-05T22:14:00-07:00"},
            {"id": "c3", "name": "New", "schedule_display": "0 6 * * 3", "enabled": True, "state": "scheduled", "last_status": None,
             "next_run_at": "2026-10-07T06:20:00-07:00"},
            {"id": "d4", "name": "Old", "schedule_display": "0 5 * * *", "enabled": False, "state": "paused", "last_status": "ok",
             "last_run_at": "2026-09-01T05:00:00-07:00", "next_run_at": "2026-10-06T05:00:00-07:00"},
        ]
        out = {j["name"]: j for j in fc.hermes_jobs(self._jobs(rows))}
        self.assertEqual(out["Daily"]["result"], "ok")
        self.assertEqual(out["Daily"]["schedule"], "0 7 * * *")
        self.assertEqual(out["Daily"]["next"], fc.iso_epoch("2026-10-06T07:00:00-07:00"))
        self.assertEqual(out["Bad"]["result"], "failed")
        self.assertEqual(out["Bad"]["detail"], "error, 111 in a row")
        self.assertEqual(out["New"]["result"], "never")
        self.assertIsNone(out["New"]["last"])
        self.assertEqual(out["Old"]["result"], "paused")
        self.assertIsNone(out["Old"]["next"])
        self.assertFalse(out["Old"]["enabled"])
        blob = json.dumps(list(out.values()))
        for leak in ("TOPSECRET", "s.py", "telegram", "SECRETERR"):
            self.assertNotIn(leak, blob)

    def test_unreadable_file_is_an_error_not_zero_jobs(self):
        with self.assertRaises(fc.FetchError):
            fc.hermes_jobs("/nonexistent/jobs.json")


class GitHub(unittest.TestCase):
    AT = utc(2026, 10, 5, 12, 0)
    W = {"repo": "thefiredev-cloud/Protocol-Guide", "file": "x.yml", "name": "Probe", "crons": ["0 9 * * *"]}

    def st(self, state="active", status="completed", conclusion="success", ago=3600 * 3):
        return {"state": state, "run": {"status": status, "conclusion": conclusion, "t": self.AT - ago}}

    def test_ok_failed_running_skipped(self):
        self.assertEqual(fc.gha_job(self.W, self.st(), self.AT)["result"], "ok")
        j = fc.gha_job(self.W, self.st(conclusion="failure"), self.AT)
        self.assertEqual((j["result"], j["detail"]), ("failed", "failure"))
        self.assertEqual(fc.gha_job(self.W, self.st(status="in_progress", conclusion=None), self.AT)["result"], "running")
        self.assertEqual(fc.gha_job(self.W, self.st(conclusion="cancelled"), self.AT)["result"], "skipped")

    def test_next_is_utc_cron_and_name_has_repo(self):
        j = fc.gha_job(self.W, self.st(), self.AT)
        self.assertEqual(j["next"], utc(2026, 10, 6, 9, 0))
        self.assertEqual(j["name"], "Protocol-Guide: Probe")
        self.assertTrue(j["schedule"].endswith("UTC"))

    def test_schedule_that_stopped_firing_is_overdue(self):
        w = dict(self.W, crons=["*/5 * * * *"])
        j = fc.gha_job(w, self.st(ago=13 * 86400), self.AT)
        self.assertEqual(j["result"], "overdue")
        self.assertIn("13d", j["detail"])
        self.assertEqual(fc.gha_job(w, self.st(ago=600), self.AT)["result"], "ok")

    def test_unregistered_disabled_never_and_lookup_failure(self):
        j = fc.gha_job(self.W, {"state": "unregistered", "run": None}, self.AT)
        self.assertEqual((j["result"], j["enabled"], j["next"]), ("paused", False, None))
        j = fc.gha_job(self.W, self.st(state="disabled_inactivity"), self.AT)
        self.assertEqual(j["result"], "paused")
        self.assertIn("inactivity", j["detail"])
        self.assertEqual(fc.gha_job(self.W, {"state": "active", "run": None}, self.AT)["result"], "never")
        self.assertEqual(fc.gha_job(self.W, None, self.AT)["result"], "unknown")

    def test_cron_lines_parse_and_comments_are_ignored(self):
        text = "name: Probe\non:\n  schedule:\n    - cron: '*/5 * * * *'\n    # - cron: '0 1 * * *'\n    - cron: \"0 9 * * 1\" # weekly\n"
        self.assertEqual([c.strip() for c in fc.CRON_LINE.findall(text)], ["*/5 * * * *", "0 9 * * 1"])
        self.assertEqual(fc.NAME_LINE.search(text).group(1), "Probe")


class Launchd(unittest.TestCase):
    def setUp(self):
        ns = {}
        exec(fc.LAUNCHD_SCRIPT.split("table = lc_table()")[0], ns)
        self.ns = ns

    def test_human_and_describe(self):
        self.assertEqual(self.ns["human"](3600), "1h")
        self.assertEqual(self.ns["human"](90), "90s")
        self.assertEqual(self.ns["describe"]({"Hour": 4, "Minute": 30}), "04:30")
        self.assertEqual(self.ns["describe"]([{"Weekday": 1, "Hour": 9, "Minute": 0}]), "wd1 09:00")

    def test_next_calendar_is_after_now_and_matches(self):
        import time
        now = time.mktime((2026, 10, 5, 12, 0, 0, 0, 0, -1))
        n = self.ns["next_cal"]({"Hour": 4, "Minute": 30}, now)
        t = time.localtime(n)
        self.assertTrue(n > now and (t.tm_hour, t.tm_min) == (4, 30) and t.tm_mday == 6)
        w = self.ns["next_cal"]({"Weekday": 1, "Hour": 9, "Minute": 0}, now)  # next Monday after Mon 12:00
        tw = time.localtime(w)
        self.assertEqual((tw.tm_wday, tw.tm_hour, tw.tm_mday), (0, 9, 12))


class Assemble(unittest.TestCase):
    def test_failing_source_stays_visible_and_others_survive(self):
        def boom(*a, **k):
            raise fc.FetchError("jobs.json unreadable: nope")
        orig = fc.hermes_jobs
        fc.hermes_jobs = boom
        try:
            errors = []
            groups = fc.build(errors, {"hermes"})
        finally:
            fc.hermes_jobs = orig
        self.assertEqual(len(groups), 1)
        g = groups[0]
        self.assertFalse(g["ok"])
        self.assertEqual(g["jobs"], [])
        self.assertIn("nope", g["error"])
        self.assertEqual(errors[0]["source"], "hermes")
        self.assertEqual(fc.counts(groups)["sources_down"], 1)

    def test_counts(self):
        def mk(r, n=None, en=True):
            return fc.job("g", r + str(n), "h", "k", "s", en, 1, n, r)
        groups = [{"id": "g", "host": "h", "ok": True, "jobs": [mk("ok", 50), mk("failed", 20), mk("overdue", 70), mk("running"), mk("paused", None, False), mk("never", 90)]}]
        c = fc.counts(groups)
        self.assertEqual((c["total"], c["failing"], c["running"], c["paused"], c["never"], c["next_run"]), (6, 2, 1, 1, 1, 20))

    def test_job_fields_are_bounded_and_typed(self):
        j = fc.job("g", "n" * 500, "h", "k", "s" * 500, 1, 1790000000.7, None, "ok", "d" * 500)
        self.assertEqual((len(j["name"]), len(j["schedule"]), len(j["detail"])), (90, 90, 120))
        self.assertEqual((j["last"], j["next"], j["enabled"]), (1790000000, None, True))


class RemoteScripts(unittest.TestCase):
    def test_systemd_script_runs_here_and_reports_typed_rows(self):
        import shutil
        if not shutil.which("systemctl"):
            self.skipTest("no systemctl")
        try:
            rows = fc.run_script(fc.SYSTEMD_SCRIPT, None, 60)
        except fc.FetchError:
            self.skipTest("no user systemd session")
        for r in rows:
            self.assertIn(r["result"], {"ok", "failed", "running", "never", "paused", "unknown"})
            self.assertIsInstance(r["enabled"], bool)
            self.assertIn("started", r)
            if r["result"] != "running":
                self.assertIsNone(r["started"])


def _blocks(rows):
    return "\n\n".join("\n".join("%s=%s" % kv for kv in r.items()) for r in rows) + "\n"


def run_systemd(services, timer_active="active", fired=None):
    """Run SYSTEMD_SCRIPT against canned systemctl output; services = {name: props}. Returns {timer name: row}."""
    import contextlib
    import io
    import subprocess
    from unittest import mock
    fired = fired if fired is not None else 1_790_000_000_000_000
    timers = [{"unit": n + ".timer", "activates": n + ".service", "next": fired + 3_600_000_000, "last": fired} for n in services]

    def fake(cmd, **kw):
        text = ""
        if "list-timers" in cmd:
            text = json.dumps(timers)
        elif "show" in cmd:
            units = cmd[cmd.index("show") + 3:]
            rows = []
            for u in units:
                if u.endswith(".timer"):
                    rows.append({"Id": u, "Description": "d", "ActiveState": timer_active, "UnitFileState": "enabled",
                                 "TimersCalendar": "{ OnCalendar=*-*-* 05:30:00 ; next_elapse=x }"})
                elif u[:-8] in services:
                    rows.append(dict({"Id": u, "LoadState": "loaded"}, **services[u[:-8]]))
            text = _blocks(rows)
        return subprocess.CompletedProcess(cmd, 0, stdout=text, stderr="")

    buf = io.StringIO()
    with mock.patch("subprocess.run", side_effect=fake), contextlib.redirect_stdout(buf):
        exec(compile(fc.SYSTEMD_SCRIPT, "systemd_script", "exec"), {"__name__": "systemd_script"})
    return {r["name"]: r for r in json.loads(buf.getvalue())}


class SystemdRunningState(unittest.TestCase):
    """running = a process exists now; the age is the CURRENT invocation start, never a timer fire or a last success."""
    NOW = "Sun 2026-10-11 21:36:43.912037 UTC"

    def test_oneshot_with_a_live_pid_is_running_and_aged_from_its_own_invocation(self):
        r = run_systemd({"broker": {"ActiveState": "activating", "SubState": "start", "Result": "success", "ExecMainStatus": "0",
                                     "MainPID": "4242", "ControlPID": "0", "InactiveExitTimestamp": self.NOW,
                                     "InactiveEnterTimestamp": "Sun 2026-10-11 12:00:00.000000 UTC"}})["broker"]
        self.assertEqual(r["result"], "running")
        self.assertEqual(r["started"], utc(2026, 10, 11, 21, 36, 43))
        self.assertEqual(r["last"], utc(2026, 10, 11, 12, 0, 0))  # previous run end, not the timer fire time

    def test_a_finished_oneshot_is_not_running_even_when_the_timer_fired_hours_ago(self):
        r = run_systemd({"done": {"ActiveState": "inactive", "SubState": "dead", "Result": "success", "ExecMainStatus": "0",
                                   "MainPID": "0", "ControlPID": "0", "InactiveExitTimestamp": self.NOW,
                                   "InactiveEnterTimestamp": "Sun 2026-10-11 21:36:44.000000 UTC"}})["done"]
        self.assertEqual((r["result"], r["started"]), ("ok", None))
        self.assertEqual(r["last"], utc(2026, 10, 11, 21, 36, 44))

    def test_a_collected_oneshot_with_no_completion_time_is_unknown_not_ok_and_keeps_the_trigger_apart(self):
        r = run_systemd({"gc": {"ActiveState": "inactive", "SubState": "dead", "Result": "success", "ExecMainStatus": "0",
                                 "MainPID": "0", "ControlPID": "0"}}, fired=1_790_000_000_000_000)["gc"]
        self.assertEqual((r["result"], r["detail"], r["last"]), ("unknown", "completion not recorded", None))
        self.assertEqual(r["triggered"], 1_790_000_000)
        never = run_systemd({"n": {"ActiveState": "inactive", "SubState": "dead", "Result": "success", "ExecMainStatus": "0",
                                    "MainPID": "0", "ControlPID": "0"}}, fired=0)["n"]
        self.assertEqual((never["result"], never["triggered"]), ("never", None))

    def test_remain_after_exit_unit_without_a_process_is_not_running(self):
        r = run_systemd({"rae": {"ActiveState": "active", "SubState": "exited", "Result": "success", "ExecMainStatus": "0",
                                  "MainPID": "0", "ControlPID": "0", "InactiveExitTimestamp": self.NOW,
                                  "InactiveEnterTimestamp": "Sun 2026-10-11 10:00:00.000000 UTC"}})["rae"]
        self.assertEqual(r["result"], "ok")
        self.assertIsNone(r["started"])

    def test_active_simple_service_with_a_pid_is_running(self):
        r = run_systemd({"svc": {"ActiveState": "active", "SubState": "running", "Result": "success", "ExecMainStatus": "0",
                                  "MainPID": "77", "ControlPID": "0", "InactiveExitTimestamp": self.NOW}})["svc"]
        self.assertEqual((r["result"], r["started"]), ("running", utc(2026, 10, 11, 21, 36, 43)))

    def test_running_without_launch_metadata_keeps_the_age_unknown(self):
        r = run_systemd({"x": {"ActiveState": "activating", "SubState": "start", "Result": "success", "ExecMainStatus": "0",
                                "MainPID": "5", "ControlPID": "0", "InactiveExitTimestamp": ""}}, fired=1_790_000_000_000_000)["x"]
        self.assertEqual(r["result"], "running")
        self.assertIsNone(r["started"])  # never the timer fire time
        self.assertEqual(r["last"], None)

    def test_activating_without_any_process_is_unknown_not_running(self):
        r = run_systemd({"restart": {"ActiveState": "activating", "SubState": "auto-restart", "Result": "exit-code",
                                      "ExecMainStatus": "1", "MainPID": "0", "ControlPID": "0"}})["restart"]
        self.assertEqual((r["result"], r["detail"]), ("unknown", "waiting to restart"))

    def test_failed_unit_stays_failed_and_unreadable_service_is_unknown(self):
        r = run_systemd({"bad": {"ActiveState": "failed", "SubState": "failed", "Result": "exit-code", "ExecMainStatus": "3",
                                  "MainPID": "0", "ControlPID": "0", "InactiveEnterTimestamp": self.NOW}})["bad"]
        self.assertEqual((r["result"], r["detail"]), ("failed", "exit-code exit 3"))
        import contextlib
        import io
        import subprocess
        from unittest import mock
        def fake(cmd, **kw):
            out = ""
            if "list-timers" in cmd:
                out = json.dumps([{"unit": "q.timer", "activates": "q.service", "next": 1, "last": 1_790_000_000_000_000}])
            elif "q.timer" in cmd:  # the timer reads fine; its service state does not
                out = _blocks([{"Id": "q.timer", "Description": "d", "ActiveState": "active", "UnitFileState": "enabled"}])
            return subprocess.CompletedProcess(cmd, 0, stdout=out, stderr="")
        buf = io.StringIO()
        with mock.patch("subprocess.run", side_effect=fake), contextlib.redirect_stdout(buf):
            exec(compile(fc.SYSTEMD_SCRIPT, "systemd_script", "exec"), {"__name__": "systemd_script"})
        row = json.loads(buf.getvalue())[0]
        self.assertEqual((row["result"], row["detail"]), ("unknown", "service state unreadable"))

    def test_the_collectors_own_run_is_not_published_as_running(self):
        from unittest import mock
        props = {"ActiveState": "activating", "SubState": "start", "Result": "success", "ExecMainStatus": "0", "MainPID": "9", "ControlPID": "0",
                 "InvocationID": "abc123", "InactiveExitTimestamp": self.NOW, "InactiveEnterTimestamp": "Sun 2026-10-11 21:30:00.000000 UTC"}
        with mock.patch.dict(os.environ, {"INVOCATION_ID": "abc123"}):
            mine = run_systemd({"deck-feed-crons": props, "other": dict(props, InvocationID="zzz")})
        self.assertEqual((mine["deck-feed-crons"]["result"], mine["deck-feed-crons"]["started"]), ("ok", None))
        self.assertEqual(mine["deck-feed-crons"]["last"], utc(2026, 10, 11, 21, 30, 0))
        self.assertEqual(mine["other"]["result"], "running")  # another service with a live pid still runs

    def test_a_stopped_timer_is_paused_unless_its_service_is_really_running(self):
        props = {"ActiveState": "inactive", "SubState": "dead", "Result": "success", "ExecMainStatus": "0", "MainPID": "0",
                 "ControlPID": "0", "InactiveEnterTimestamp": self.NOW}
        self.assertEqual(run_systemd({"p": props}, timer_active="inactive")["p"]["result"], "paused")
        live = dict(props, ActiveState="activating", SubState="start", MainPID="9", InactiveExitTimestamp=self.NOW)
        r = run_systemd({"p": live}, timer_active="inactive")["p"]
        self.assertEqual((r["result"], r["enabled"], r["detail"]), ("running", False, "timer stopped"))


class HermesLeases(unittest.TestCase):
    def _db(self, rows):
        import sqlite3
        p = os.path.join(tempfile.mkdtemp(), "executions.db")
        c = sqlite3.connect(p)
        c.execute("CREATE TABLE executions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, source TEXT NOT NULL, process_id TEXT NOT NULL, "
                  "pid INTEGER NOT NULL, process_started_at INTEGER, status TEXT NOT NULL, claimed_at TEXT NOT NULL, started_at TEXT, "
                  "finished_at TEXT, error TEXT)")
        for i, (job_id, pid, fp, status, claimed, started) in enumerate(rows):
            c.execute("INSERT INTO executions (id, job_id, source, process_id, pid, process_started_at, status, claimed_at, started_at) "
                      "VALUES (?,?,?,?,?,?,?,?,?)", (str(i), job_id, "direct", "p", pid, fp, status, claimed, started))
        c.commit()
        c.close()
        return p

    def test_only_claimed_or_running_rows_with_a_live_owner_are_leases(self):
        me = os.getpid()
        fp = fc._proc_start(me)
        self.assertIsNotNone(fp)
        p = self._db([
            ("live", me, fp, "running", "2026-10-11T10:00:00-07:00", "2026-10-11T10:00:05-07:00"),
            ("claimed", me, fp, "claimed", "2026-10-11T10:01:00-07:00", None),
            ("gone", 2 ** 22 + 12345, 99, "running", "2026-10-11T09:00:00-07:00", "2026-10-11T09:00:05-07:00"),
            ("recycled", me, fp + 999, "running", "2026-10-11T09:00:00-07:00", "2026-10-11T09:00:05-07:00"),
            ("done", me, fp, "completed", "2026-10-11T08:00:00-07:00", "2026-10-11T08:00:05-07:00"),
        ])
        leases = fc.hermes_leases(p)
        self.assertEqual(set(leases), {"live", "claimed"})
        self.assertEqual(leases["live"], fc.iso_epoch("2026-10-11T10:00:05-07:00"))
        self.assertEqual(leases["claimed"], fc.iso_epoch("2026-10-11T10:01:00-07:00"))

    def test_unreadable_lease_table_raises_so_running_state_is_unknown_not_idle(self):
        with self.assertRaises(fc.FetchError):
            fc.hermes_leases("/nonexistent/executions.db")

    def test_jobs_with_a_lease_run_now_and_a_missing_table_marks_nothing_running(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "jobs.json")
        rows = [{"id": "a1", "name": "Live", "schedule_display": "every 5m", "enabled": True, "state": "scheduled", "last_status": "ok",
                 "last_run_at": "2026-10-11T08:00:00-07:00", "next_run_at": "2026-10-11T10:05:00-07:00"},
                {"id": "b2", "name": "Parked", "schedule_display": "every 5m", "enabled": False, "state": "paused", "last_status": "ok"}]
        with open(p, "w") as fh:
            json.dump({"jobs": rows}, fh)
        out = {j["name"]: j for j in fc.hermes_jobs(p, {"a1": 1790000000, "b2": None})}
        self.assertEqual((out["Live"]["result"], out["Live"]["started"]), ("running", 1790000000))
        self.assertEqual(out["Parked"]["result"], "running")  # a manual run of a paused job is still real work
        self.assertEqual(out["Parked"]["lifecycle"], "paused")
        self.assertIsNone(out["Parked"]["started"])  # lease start unknown: age unknown, never guessed
        idle = {j["name"]: j for j in fc.hermes_jobs(p, {})}
        self.assertEqual((idle["Live"]["result"], idle["Parked"]["result"]), ("ok", "paused"))
        unknown = {j["name"]: j for j in fc.hermes_jobs(p, None)}
        self.assertEqual(unknown["Live"]["result"], "ok")

    def test_retired_jobs_stay_as_history_rows_marked_retired_and_are_not_listed_twice(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "jobs.json")
        rows = [{"id": "aaaaaaaaaaaa", "name": "Old brief", "schedule_display": "0 7 * * *", "enabled": False, "state": "paused", "last_status": "ok"},
                {"id": "bbbbbbbbbbbb", "name": "Gone job", "schedule_display": "0 8 * * *", "enabled": False, "state": "paused", "last_status": "ok"},
                {"id": "cccccccccccc", "name": "Survivor", "schedule_display": "0 9 * * *", "enabled": True, "state": "scheduled", "last_status": "ok"}]
        with open(p, "w") as fh:
            json.dump({"jobs": rows}, fh)
        merged = [{"old": "Old brief", "new": "Survivor", "old_id": "aaaaaaaaaaaa", "new_id": "cccccccccccc", "at": 1790000000},
                  {"old": "Gone job", "new": "obsolete", "old_id": "bbbbbbbbbbbb", "new_id": "obsolete", "at": 1790000000},
                  {"old": "Deleted", "new": "x", "old_id": "dddddddddddd", "new_id": "timer:batch-a", "at": 1790000000}]
        used = set()
        out = {j["name"]: j for j in fc.hermes_jobs(p, {}, merged, used)}
        self.assertEqual((out["Old brief"]["lifecycle"], out["Old brief"]["about"]), ("retired", "merged into Survivor"))
        self.assertEqual((out["Gone job"]["lifecycle"], out["Gone job"]["about"]), ("retired", "retired as obsolete"))
        self.assertEqual(out["Survivor"]["lifecycle"], "active")
        self.assertEqual(len(used), 2)  # the third merge row has no registry row: it becomes a group-level retired entry
        self.assertEqual(fc.merge_outcome(merged[2]), "moved to timer batch-a")

    def test_group_notes_that_running_state_is_unknown_when_the_lease_table_is_unreadable(self):
        orig = fc.hermes_leases
        fc.hermes_leases = lambda *a, **k: (_ for _ in ()).throw(fc.FetchError("executions.db missing"))
        origj = fc.hermes_jobs
        fc.hermes_jobs = lambda *a, **k: []
        try:
            _jobs, meta = fc.hermes_group()
        finally:
            fc.hermes_leases, fc.hermes_jobs = orig, origj
        self.assertIn("running state unknown", meta["notes"][0])


class Batches(unittest.TestCase):
    def jobs(self):
        return [fc.job("g", "batch-hourly", "pc-desktop", "systemd", "hourly", True, 1790000000, 1790003600, "ok")]

    MANIFEST = {"version": 1, "batches": [{"timer": "batch-hourly.timer", "members": [{"name": "alpha", "service": "alpha.service"},
                {"name": "beta", "service": "beta.service"}, {"name": "gamma", "service": "gamma.service"}],
                "retired": [{"name": "old-alpha", "merged_into": "batch-hourly", "at": 1790000100}]}]}

    def test_failed_member_is_shown_inside_its_real_batch_and_fails_the_batch(self):
        jobs = self.jobs()
        receipt = {"batches": {"batch-hourly": {"members": {"alpha": {"status": "ok", "started_at": 1790000000, "finished_at": 1790000010, "exit": 0},
                                                            "beta": {"status": "failed", "finished_at": 1790000020, "exit": 4, "command": "SECRET"}}}}}
        retired = fc.apply_batches(jobs, self.MANIFEST, receipt)
        j = jobs[0]
        self.assertEqual(j["result"], "failed")
        self.assertEqual(j["detail"], "1 of 3 members failed: beta")
        self.assertEqual([(m["name"], m["status"]) for m in j["members"]], [("alpha", "ok"), ("beta", "failed"), ("gamma", "unknown")])
        self.assertEqual(j["members"][1]["exit"], 4)
        self.assertNotIn("SECRET", json.dumps(j))
        self.assertEqual(retired, [{"name": "old-alpha", "merged_into": "batch-hourly", "outcome": "merged into batch-hourly", "at": 1790000100, "host": "pc-desktop"}])

    def test_a_batch_systemd_has_not_run_yet_takes_its_last_time_from_the_receipt(self):
        jobs = [fc.job("g", "batch-hourly", "pc-desktop", "systemd", "hourly", True, None, None, "never")]
        receipt = {"batches": {"batch-hourly": {"finished_at": 1790000500, "members": {"beta": {"status": "failed", "exit": 1}}}}}
        fc.apply_batches(jobs, self.MANIFEST, receipt)
        self.assertEqual((jobs[0]["result"], jobs[0]["last"]), ("failed", 1790000500))
        newer = [fc.job("g", "batch-hourly", "pc-desktop", "systemd", "hourly", True, 1790009999, None, "ok")]
        fc.apply_batches(newer, self.MANIFEST, receipt)
        self.assertEqual(newer[0]["last"], 1790009999)  # a later systemd finish is never replaced by an older receipt time

    def test_member_states_pending_unknown_overdue_and_overrun_pass_through_and_pending_stays_neutral(self):
        jobs = self.jobs()
        receipt = {"batches": {"batch-hourly": {"members": {
            "alpha": {"status": "pending"}, "beta": {"status": "running", "overrun": True, "started_at": 1790000000},
            "gamma": {"status": "ok", "overdue": True, "finished_at": 1790000010, "exit": 0}}}}}
        fc.apply_batches(jobs, self.MANIFEST, receipt)
        m = {x["name"]: x for x in jobs[0]["members"]}
        self.assertEqual((m["alpha"]["status"], m["beta"]["status"], m["beta"]["overrun"], m["gamma"]["overdue"]), ("pending", "running", True, True))
        self.assertEqual(jobs[0]["result"], "ok")  # pending, overrun and overdue are shown, not failures
        self.assertEqual(fc.counts([{"id": "g", "host": "h", "ok": True, "jobs": jobs}])["member_failures"], 0)

    def test_a_batch_with_a_recorded_ok_completion_is_ok_not_unknown(self):
        jobs = [fc.job("g", "batch-hourly", "pc-desktop", "systemd", "hourly", True, None, None, "unknown", "completion not recorded", triggered=1790000000)]
        receipt = {"batches": {"batch-hourly": {"status": "ok", "finished_at": 1790000500, "members": {"alpha": {"status": "ok", "overdue": False, "due_at": 1790000400, "deferred_since": 1790000100}}}}}
        fc.apply_batches(jobs, self.MANIFEST, receipt)
        self.assertEqual((jobs[0]["result"], jobs[0]["last"], jobs[0]["detail"]), ("ok", 1790000500, ""))
        self.assertEqual((jobs[0]["members"][0]["due"], jobs[0]["members"][0]["deferred_since"]), (1790000400, 1790000100))

    def test_standalone_retired_timers_get_their_reason_as_the_outcome(self):
        jobs = self.jobs()
        manifest = {"batches": [], "retired": [{"name": "dead-oneshot.timer", "merged_into": None, "at": 1790000200, "reason": "one-shot already fired"}]}
        retired = fc.apply_batches(jobs, manifest, None)
        self.assertEqual(retired, [{"name": "dead-oneshot", "merged_into": "", "outcome": "one-shot already fired", "at": 1790000200, "host": "pc-desktop"}])
        stopped = [fc.job("g", "dead-oneshot", "pc-desktop", "systemd", "once", False, 1, None, "paused")]
        self.assertEqual(fc.apply_batches(stopped, manifest, None), [])  # still a loaded, stopped row: it is the history row
        self.assertEqual((stopped[0]["lifecycle"], stopped[0]["about"]), ("retired", "one-shot already fired"))

    def test_a_running_batch_keeps_running_and_a_missing_receipt_is_unknown_members_not_ok(self):
        jobs = [fc.job("g", "batch-hourly", "pc-desktop", "systemd", "hourly", True, None, None, "running", started=1790000000)]
        fc.apply_batches(jobs, self.MANIFEST, {"batches": {"batch-hourly": {"members": {"beta": {"status": "failed"}}}}})
        self.assertEqual(jobs[0]["result"], "running")
        self.assertEqual(jobs[0]["started"], 1790000000)
        fresh = self.jobs()
        fc.apply_batches(fresh, self.MANIFEST, None)
        self.assertEqual({m["status"] for m in fresh[0]["members"]}, {"unknown"})
        self.assertEqual(fresh[0]["result"], "ok")

    def test_counts_report_failed_members_retired_and_unknown_hosts_separately_from_active(self):
        jobs = self.jobs()
        fc.apply_batches(jobs, self.MANIFEST, {"batches": {"batch-hourly": {"members": {"beta": {"status": "failed"}}}}})
        groups = [{"id": "pc", "host": "pc-desktop", "ok": True, "jobs": jobs, "retired": [{"name": "old"}]},
                  {"id": "dell-systemd", "host": "dell", "ok": False, "jobs": []}]
        c = fc.counts(groups)
        self.assertEqual((c["total"], c["active"], c["history"], c["member_failures"], c["retired"], c["failing"]), (1, 1, 0, 1, 1, 1))
        self.assertEqual((c["unknown_hosts"], c["unknown_sources"], c["complete"], c["scope"]), (["dell"], ["dell-systemd"], False, "observed"))

    def test_running_age_unknown_is_counted_not_guessed(self):
        j = [fc.job("g", "a", "h", "k", "s", True, 1790000000, None, "running"),
             fc.job("g", "b", "h", "k", "s", True, 1790000000, None, "running", started=1790000500)]
        c = fc.counts([{"id": "g", "host": "h", "ok": True, "jobs": j}])
        self.assertEqual((c["running"], c["running_age_unknown"]), (2, 1))

    def test_a_down_source_carries_its_last_known_count_forward_labelled_with_its_age(self):
        prev = {"t": 1790000000, "groups": [{"id": "dell-systemd", "ok": True, "jobs": [{"enabled": True}, {"enabled": False}, {"enabled": True}]}]}
        down = [{"id": "dell-systemd", "ok": False, "jobs": []}]
        fc.carry_last_known(down, prev)
        self.assertEqual(down[0]["last_known"], {"n": 3, "active": 2, "t": 1790000000})
        again = [{"id": "dell-systemd", "ok": False, "jobs": []}]
        fc.carry_last_known(again, {"t": 1790000300, "groups": down})  # still down: the older reading is kept, not refreshed
        self.assertEqual(again[0]["last_known"]["t"], 1790000000)
        none = [{"id": "dell-systemd", "ok": False, "jobs": []}]
        fc.carry_last_known(none, None)
        self.assertNotIn("last_known", none[0])


class OwnerWaits(unittest.TestCase):
    """~/ops/state/owner-waits.json: a failure only Tanner can clear reads `waiting`, never failing, until its `until` passes."""

    AT = utc(2026, 11, 2, 19, 0)

    def path(self, doc):
        p = os.path.join(tempfile.mkdtemp(), "owner-waits.json")
        with open(p, "w") as fh:
            fh.write(doc if isinstance(doc, str) else json.dumps(doc))
        return p

    def groups(self):
        def mk(name, res, host="pc-desktop", g="pc-desktop-systemd"):
            return dict(fc.job(g, name, host, "systemd", "every 5min", True, 1, 2, res, "exit-code exit 1"))
        return [{"id": "pc-desktop-systemd", "host": "pc-desktop", "ok": True,
                 "jobs": [mk("nest-bridge", "failed"), mk("asc-watch", "failed"), mk("calm", "ok"), mk("gmail-autolabel-personal", "ok")]},
                {"id": "github", "host": "github", "ok": True,
                 "jobs": [mk("Protocol-Guide: Protocol Refresh (30-day)", "failed", "github", "github")]}]

    def test_live_items_turn_matching_failures_into_waiting_and_counts_split(self):
        p = self.path({"items": [
            {"job": "pc-desktop-systemd:nest-bridge", "host": "pc-desktop", "reason": "Nest consent expired", "action": "Redo consent", "until": "2026-11-09"},
            {"job": "github:Protocol-Guide: Protocol Refresh (30-day)", "host": "github", "reason": "Secret missing", "action": "Add it",
             "link": "https://github.com/o/r/settings/secrets/actions", "until": "2026-11-09"},
            {"job": "pc-desktop-systemd:gmail-autolabel-personal", "reason": "Link expired", "mailbox": "personal", "until": "2026-11-09"}]})
        waits = fc.read_owner_waits(p, self.AT)
        self.assertEqual(len(waits), 3)
        groups = self.groups()
        fc.apply_owner_waits(groups, waits)
        by = {j["name"]: j for g in groups for j in g["jobs"]}
        nest = by["nest-bridge"]
        self.assertEqual((nest["result"], nest["detail"]), ("waiting", "Waiting on you: Nest consent expired"))
        self.assertEqual(nest["owner_wait"]["action"], "Redo consent")
        self.assertEqual(by["Protocol-Guide: Protocol Refresh (30-day)"]["owner_wait"]["link"], "https://github.com/o/r/settings/secrets/actions")
        # a real failure with no owner wait stays failed; a job that recovered stays ok even with a live item
        self.assertEqual(by["asc-watch"]["result"], "failed")
        self.assertEqual(by["gmail-autolabel-personal"]["result"], "ok")
        self.assertNotIn("owner_wait", by["gmail-autolabel-personal"])
        c = fc.counts(groups)
        self.assertEqual((c["failing"], c["waiting"]), (1, 2))

    def test_expired_wrong_host_and_incomplete_items_never_hide_a_failure(self):
        p = self.path([
            {"job": "pc-desktop-systemd:nest-bridge", "reason": "old", "until": "2026-11-01"},  # ended at the end of Nov 1, local
            {"job": "pc-desktop-systemd:asc-watch", "host": "dell", "reason": "wrong host", "until": "2026-11-09"},
            {"job": "github:Protocol-Guide: Protocol Refresh (30-day)", "reason": "no until"},
            {"job": "", "reason": "no job", "until": "2026-11-09"},
            {"job": "pc-desktop-systemd:calm", "until": "2026-11-09"},
            {"job": "pc-desktop-systemd:nest-bridge", "reason": "ended", "until": "2026-11-02T12:00:00Z"}])
        waits = fc.read_owner_waits(p, self.AT)
        self.assertEqual([w["reason"] for w in waits], ["wrong host"])  # the timed item ended at 12:00Z, before AT (19:00Z)
        groups = self.groups()
        fc.apply_owner_waits(groups, waits)
        self.assertEqual(fc.counts(groups)["waiting"], 0)
        self.assertEqual(fc.counts(groups)["failing"], 3)
        live = fc.read_owner_waits(self.path([{"job": "x", "reason": "r", "link": "javascript:alert(1)", "until": "2026-11-09"}]), self.AT)
        self.assertNotIn("link", live[0])

    def test_missing_file_is_quiet_and_a_broken_file_is_an_error_not_a_wait(self):
        errors = []
        self.assertEqual(fc.read_owner_waits(os.path.join(tempfile.mkdtemp(), "none.json"), self.AT, errors), [])
        self.assertEqual(errors, [])
        self.assertEqual(fc.read_owner_waits(self.path("{not json"), self.AT, errors), [])
        self.assertEqual(fc.read_owner_waits(self.path({"items": "nope"}), self.AT, errors), [])
        self.assertEqual([e["source"] for e in errors], ["owner-waits", "owner-waits"])

    def test_a_long_reason_is_cut_at_a_word_with_an_ellipsis_never_mid_word(self):
        reason = "Your desktop Chromium (running since 2026-11-11) holds the Profile 2 lock, so headless CDP 9333 cannot start"
        live = fc.read_owner_waits(self.path([{"job": "x", "reason": reason, "until": "2026-11-09"}]), self.AT)[0]["reason"]
        self.assertLessEqual(len(live), 100)
        self.assertTrue(live.endswith("9333\u2026"), live)
        self.assertEqual(fc.word_clip("short", 100), "short")
        self.assertEqual(fc.word_clip("a" * 120, 100), "a" * 99 + "\u2026")

    def test_a_date_runs_to_the_end_of_that_local_day(self):
        end = fc.wait_until("2026-11-09")
        self.assertEqual(dt.datetime.fromtimestamp(end).strftime("%Y-%m-%d %H:%M"), "2026-11-10 00:00")
        self.assertIsNone(fc.wait_until("next week"))
        self.assertIsNone(fc.wait_until(None))



if __name__ == "__main__":
    unittest.main()
