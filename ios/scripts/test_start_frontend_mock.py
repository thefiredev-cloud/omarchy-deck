#!/usr/bin/env python3
"""Behavior tests for the archived frontend mock launcher."""
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().with_name("start_frontend_mock.mjs")


class FrontendMockLauncherTests(unittest.TestCase):
    def test_imports_mock_from_source_root_and_passes_numeric_port(self):
        with tempfile.TemporaryDirectory(prefix="frontend source ") as temp:
            source_root = Path(temp)
            module = source_root / "qa" / "mock-deck.mjs"
            module.parent.mkdir()
            module.write_text(
                "export async function startMockDeck(port) { console.log(`port=${port};type=${typeof port}`); }\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                ["node", str(SCRIPT), str(source_root), "4312"],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("port=4312;type=number", result.stdout)
        self.assertIn("Synthetic QA backend", result.stdout)


if __name__ == "__main__":
    unittest.main()
