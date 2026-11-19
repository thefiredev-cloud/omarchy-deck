"""Behavior tests for scripts/remote_probe.py.

The read() tests use an in-memory stdout. The main() tests run a small fake JSON-RPC server as a
child process through DECK_FEEDS_REMOTE, the same hop the probe uses on a real remote.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import shlex
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "remote_probe.py"
SPEC = importlib.util.spec_from_file_location("remote_probe", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

FAKE_SERVER = """
import json
import sys

MODE = sys.argv[1]
for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        continue
    if message["method"] == "initialize":
        result = {"serverInfo": {"name": "fake-deck-feeds", "version": "0"}}
    elif message["method"] == "tools/list":
        result = {"tools": [{"name": "deck_feeds_status"}]}
    elif MODE == "structured":
        result = {"structuredContent": {"status": "ok", "count": 2}}
    elif MODE == "error":
        reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32000, "message": "boom"}}
        print(json.dumps(reply), flush=True)
        continue
    else:
        result = {"content": [{"type": "text", "text": "status ok"}]}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
"""


class ReadTests(unittest.TestCase):
    def test_skips_log_noise_and_non_jsonrpc_lines_before_the_reply(self):
        proc = SimpleNamespace(stdout=io.StringIO(
            "starting server...\n"
            "{not json\n"
            '{"method": "notice"}\n'
            '{"jsonrpc": "2.0", "id": 1, "result": {}}\n'
        ))

        self.assertEqual(probe.read(proc), {"jsonrpc": "2.0", "id": 1, "result": {}})

    def test_raises_when_server_closes_stdout_before_replying(self):
        proc = SimpleNamespace(stdout=io.StringIO("log line only\n"))

        with self.assertRaisesRegex(RuntimeError, "closed stdout"):
            probe.read(proc)


class MainTests(unittest.TestCase):
    def run_probe(self, mode: str, argv: list[str]) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as tmp:
            server = Path(tmp) / "fake_server.py"
            server.write_text(FAKE_SERVER, encoding="utf-8")
            remote = f"{shlex.quote(sys.executable)} {shlex.quote(str(server))} {mode}"
            output = io.StringIO()
            with patch.dict(os.environ, {"DECK_FEEDS_REMOTE": remote}), contextlib.redirect_stdout(output):
                status = probe.main(["remote_probe.py", *argv])
        return status, output.getvalue()

    def test_prints_tool_text_and_returns_zero_on_success(self):
        status, output = self.run_probe("ok", ["deck_feeds_status", "{}"])

        self.assertEqual(status, 0)
        self.assertIn("tools 1", output)
        self.assertIn("status ok", output)

    def test_prints_structured_result_when_tool_has_no_text_content(self):
        status, output = self.run_probe("structured", ["deck_feeds_status", "{}"])

        self.assertEqual(status, 0)
        self.assertIn('{"structuredContent": {"status": "ok", "count": 2}}', output)

    def test_prints_json_rpc_error_and_returns_one_when_tool_call_fails(self):
        status, output = self.run_probe("error", ["deck_feeds_status", "{}"])

        self.assertEqual(status, 1)
        self.assertIn('error {"code": -32000, "message": "boom"}', output)


if __name__ == "__main__":
    unittest.main()
