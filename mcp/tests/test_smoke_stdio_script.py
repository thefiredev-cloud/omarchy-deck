"""Behavior tests for scripts/smoke_stdio.py.

main() talks to a small FastMCP stdio server started as a child process, the same hop the smoke
uses against run.py. RUN and CALLS are swapped for a fake server with known tools, so the tests do
not touch the live feeds.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastmcp.exceptions import ToolError

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "smoke_stdio.py"
SPEC = importlib.util.spec_from_file_location("smoke_stdio", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
smoke_stdio = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke_stdio)

FAKE_SERVER = """
from fastmcp import FastMCP

mcp = FastMCP("fake-deck-feeds")


@mcp.tool
def echo(text: str) -> str:
    return "echo " + text


@mcp.tool
def add(a: int, b: int) -> int:
    return a + b


@mcp.tool
def long_text() -> str:
    return "x" * 2000


if __name__ == "__main__":
    mcp.run(show_banner=False)
"""


class MainTests(unittest.TestCase):
    def run_smoke(self, calls: list[tuple[str, dict]]) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as tmp:
            server = Path(tmp) / "fake_server.py"
            server.write_text(FAKE_SERVER, encoding="utf-8")
            output = io.StringIO()
            with patch.object(smoke_stdio, "RUN", str(server)), \
                    patch.object(smoke_stdio, "CALLS", calls), \
                    contextlib.redirect_stdout(output):
                status = asyncio.run(smoke_stdio.main())
        return status, output.getvalue()

    def test_reports_every_tool_the_server_exposes(self):
        status, output = self.run_smoke([])

        self.assertEqual(status, 0)
        header = output.splitlines()[0]
        self.assertTrue(header.startswith("tool_count 3: "), header)
        self.assertEqual(set(header.removeprefix("tool_count 3: ").split(", ")), {"echo", "add", "long_text"})

    def test_prints_each_call_with_its_arguments_and_result(self):
        status, output = self.run_smoke([("echo", {"text": "hi"}), ("add", {"a": 2, "b": 3})])

        self.assertEqual(status, 0)
        self.assertIn('--- echo({"text": "hi"})\n"echo hi"\n', output)
        self.assertIn('--- add({"a": 2, "b": 3})\n5\n', output)

    def test_truncates_each_printed_result_to_900_characters(self):
        status, output = self.run_smoke([("long_text", {})])

        self.assertEqual(status, 0)
        printed = output.split("--- long_text({})\n", 1)[1].rstrip("\n")
        self.assertEqual(len(printed), 900)
        self.assertEqual(printed, '"' + "x" * 899)

    def test_failed_tool_call_raises_instead_of_printing_a_result(self):
        with self.assertRaises(ToolError):
            self.run_smoke([("no_such_tool", {})])


if __name__ == "__main__":
    unittest.main()
