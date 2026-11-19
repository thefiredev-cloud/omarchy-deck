"""Behavior tests for run.py, the stdio entrypoint MCP clients launch.

Each test starts run.py as a child process from a directory outside the repo, the way a
client config does, and talks JSON-RPC over its stdin and stdout.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from typing import IO

RUN = Path(__file__).resolve().parents[1] / "run.py"
REPLY_TIMEOUT_S = 30


class StdioServer:
    """One run.py child. Sends a request and waits for the reply with the same id."""

    def __init__(self, cwd: str, env: dict[str, str], stderr: IO[str]):
        self.stderr = stderr
        self.proc = subprocess.Popen(
            [sys.executable, str(RUN)],
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr,
            text=True,
        )
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.stdin: IO[str] = self.proc.stdin
        self.stdout: IO[str] = self.proc.stdout
        self.lines: queue.Queue[str] = queue.Queue()
        self.pump = threading.Thread(target=self._pump_stdout, daemon=True)
        self.pump.start()

    def _pump_stdout(self) -> None:
        for line in self.stdout:
            self.lines.put(line)
        self.lines.put("")

    def send(self, message: dict) -> None:
        self.stdin.write(json.dumps(message) + "\n")
        self.stdin.flush()

    def request(self, message_id: int, method: str, params: dict) -> dict:
        self.send({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params})
        while True:
            try:
                line = self.lines.get(timeout=REPLY_TIMEOUT_S)
            except queue.Empty:
                raise AssertionError(f"no reply to {method} within {REPLY_TIMEOUT_S}s") from None
            if not line:
                self.stderr.seek(0)
                raise AssertionError(f"run.py closed stdout before replying to {method}: {self.stderr.read()}")
            try:
                payload = json.loads(line)
            except ValueError:
                continue
            if isinstance(payload, dict) and payload.get("id") == message_id:
                return payload

    def close(self) -> None:
        self.stdin.close()
        try:
            self.proc.wait(timeout=REPLY_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self.pump.join(REPLY_TIMEOUT_S)
        self.stdout.close()


class RunEntrypointTests(unittest.TestCase):
    def setUp(self):
        stderr = self.enterContext(tempfile.TemporaryFile(mode="w+"))
        feed_root = tempfile.TemporaryDirectory()
        launch_dir = tempfile.TemporaryDirectory()
        self.addCleanup(feed_root.cleanup)
        self.addCleanup(launch_dir.cleanup)
        self.feed_root = feed_root.name
        env = {**os.environ, "DECK_FEEDS_ROOT": self.feed_root}
        self.server = StdioServer(cwd=launch_dir.name, env=env, stderr=stderr)
        self.addCleanup(self.server.close)

    def initialize(self) -> dict:
        reply = self.server.request(1, "initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "run-entrypoint-test", "version": "1"},
        })
        self.server.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return reply

    def test_serves_mcp_initialize_when_launched_from_another_directory(self):
        reply = self.initialize()

        self.assertEqual(reply["result"]["serverInfo"]["name"], "deck-feeds")

    def test_status_tool_reports_the_feed_root_from_the_environment(self):
        self.initialize()

        reply = self.server.request(2, "tools/call", {"name": "deck_feeds_status", "arguments": {}})

        status = json.loads(reply["result"]["content"][0]["text"])
        self.assertEqual(status["status_root"], self.feed_root)
        self.assertEqual(status["deck_dir"], str(Path(self.feed_root) / "deck"))


class RunEntrypointDefaultRootTests(unittest.TestCase):
    """Without DECK_FEEDS_ROOT the server reads ~/.meshvault/status, as the run.py docstring says."""

    def status_for(self, **env_overrides: str) -> dict:
        stderr = self.enterContext(tempfile.TemporaryFile(mode="w+"))
        home = tempfile.TemporaryDirectory()
        launch_dir = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        self.addCleanup(launch_dir.cleanup)
        self.home = home.name
        env = {key: value for key, value in os.environ.items() if key != "DECK_FEEDS_ROOT"}
        env.update({"HOME": self.home, **env_overrides})
        server = StdioServer(cwd=launch_dir.name, env=env, stderr=stderr)
        self.addCleanup(server.close)
        server.request(1, "initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "run-entrypoint-test", "version": "1"},
        })
        server.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        reply = server.request(2, "tools/call", {"name": "deck_feeds_status", "arguments": {}})
        return json.loads(reply["result"]["content"][0]["text"])

    def test_unset_feed_root_falls_back_to_the_home_status_tree(self):
        status = self.status_for()

        expected = Path(self.home) / ".meshvault" / "status"
        self.assertEqual(status["status_root"], str(expected))
        self.assertEqual(status["deck_dir"], str(expected / "deck"))

    def test_empty_feed_root_is_treated_as_unset(self):
        status = self.status_for(DECK_FEEDS_ROOT="")

        self.assertEqual(status["status_root"], str(Path(self.home) / ".meshvault" / "status"))


if __name__ == "__main__":
    unittest.main()
