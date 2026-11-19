"""scripts/deck-feed-housing-national runs one at a time: a second run names the holder and exits 0 without touching any output.

Throwaway HOME and output dir; the lock is held by this test process with the same flock the collector takes.
Run: python3 -m unittest tests/test_national_lock.py -v
"""
import fcntl
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "deck-feed-housing-national"


class NationalLock(unittest.TestCase):
    def test_a_second_run_reports_the_holder_and_leaves_everything_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, out = Path(tmp) / "home", Path(tmp) / "out"
            cache = home / ".cache" / "deck-housing-national"
            cache.mkdir(parents=True)
            lock_path = cache / ".run.lock"
            holder = "pid 4242 since 2026-11-17T05:20:00-0800"
            with open(lock_path, "w") as held:
                held.write(holder)
                held.flush()
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                env = {"HOME": str(home), "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
                run = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out)], env=env, capture_output=True, text=True,
                                     timeout=120)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertIn("another run holds the lock (%s); exiting" % holder, run.stdout)
            self.assertNotIn("started pid", run.stdout)
            self.assertEqual(lock_path.read_text(), holder)  # the loser did not truncate the holder's note
            self.assertFalse(out.exists())  # no output tree was created

    def test_the_run_that_takes_the_lock_writes_its_pid_and_says_so(self):
        # an unknown --only id makes the run end right after it takes the lock: no source runs, no network
        with tempfile.TemporaryDirectory() as tmp:
            home, out = Path(tmp) / "home", Path(tmp) / "out"
            env = {"HOME": str(home), "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
            run = subprocess.run([sys.executable, str(SCRIPT), "--out", str(out), "--only", "no_such_source"], env=env,
                                 capture_output=True, text=True, timeout=300)
            lock_path = home / ".cache" / "deck-housing-national" / ".run.lock"
            self.assertIn("started pid", run.stdout, run.stdout + run.stderr)
            self.assertRegex(lock_path.read_text(), r"^pid \d+ since 20\d\d-")
            # the flock is gone with the process: a new run can take it
            with open(lock_path, "a+") as probe:
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)


if __name__ == "__main__":
    unittest.main()
