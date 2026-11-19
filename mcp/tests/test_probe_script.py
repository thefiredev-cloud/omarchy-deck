"""Behavior tests for scripts/probe.py.

The read() tests use an in-memory stdout. The main() tests point the probe at a small fake
JSON-RPC server that is started as a child process, the same stdio hop the probe uses on the real server.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "probe.py"
SPEC = importlib.util.spec_from_file_location("probe", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

FAKE_SERVER = """
import json
import sys

print("boot log line", flush=True)
for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message:
        continue
    if message["method"] == "initialize":
        result = {"serverInfo": {"name": "fake-deck-feeds", "version": "0"}}
    elif message["method"] == "tools/list":
        result = {"tools": [{"name": "deck_feeds_status"}, {"name": "feed_freshness"}]}
    elif message["params"]["name"] == "broken":
        reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32000, "message": "boom"}}
        print(json.dumps(reply), flush=True)
        continue
    elif message["params"]["name"] == "structured":
        result = {"structuredContent": {"status": "ok", "count": 2}}
    else:
        arguments = message["params"]["arguments"]
        result = {"content": [{"type": "text", "text": "echo " + json.dumps(arguments, sort_keys=True)}]}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
"""


class ReadTests(unittest.TestCase):
    def test_skips_log_noise_and_non_jsonrpc_payloads_before_the_reply(self):
        proc = SimpleNamespace(stdout=io.StringIO(
            "starting server...\n"
            "{not json\n"
            "[1, 2]\n"
            '{"method": "notice"}\n'
            '{"jsonrpc": "2.0", "id": 7, "result": {}}\n'
        ))

        self.assertEqual(probe.read(proc), {"jsonrpc": "2.0", "id": 7, "result": {}})

    def test_raises_when_server_closes_stdout_before_replying(self):
        proc = SimpleNamespace(stdout=io.StringIO("log line only\n"))

        with self.assertRaisesRegex(RuntimeError, "closed stdout"):
            probe.read(proc)


class MainTests(unittest.TestCase):
    def run_probe(self, argv: list[str]) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as tmp:
            server = Path(tmp) / "fake_server.py"
            server.write_text(FAKE_SERVER, encoding="utf-8")
            output = io.StringIO()
            with patch.object(probe, "PY", sys.executable), patch.object(probe, "RUN", str(server)), \
                    contextlib.redirect_stdout(output):
                status = probe.main(["probe.py", *argv])
        return status, output.getvalue()

    def test_lists_server_info_and_tool_names_without_calling_a_tool(self):
        status, output = self.run_probe([])

        self.assertEqual(status, 0)
        self.assertIn('initialize {"name": "fake-deck-feeds", "version": "0"}', output)
        self.assertIn("tools 2 ['deck_feeds_status', 'feed_freshness']", output)
        self.assertNotIn("call ", output)

    def test_calls_named_tool_with_json_arguments_and_prints_its_text(self):
        status, output = self.run_probe(["feed_freshness", '{"limit": 3}'])

        self.assertEqual(status, 0)
        self.assertIn('call feed_freshness {"limit": 3}', output)
        self.assertIn('echo {"limit": 3}', output)

    def test_missing_arguments_default_to_an_empty_object(self):
        status, output = self.run_probe(["deck_feeds_status"])

        self.assertEqual(status, 0)
        self.assertIn("call deck_feeds_status {}", output)
        self.assertIn("echo {}", output)

    def test_prints_structured_result_when_tool_has_no_text_content(self):
        status, output = self.run_probe(["structured", "{}"])

        self.assertEqual(status, 0)
        self.assertIn('{"structuredContent": {"status": "ok", "count": 2}}', output)

    def test_json_rpc_error_on_tool_call_is_reported_and_returns_one(self):
        status, output = self.run_probe(["broken", "{}"])

        self.assertEqual(status, 1)
        self.assertIn('error {"code": -32000, "message": "boom"}', output)


if __name__ == "__main__":
    unittest.main()
