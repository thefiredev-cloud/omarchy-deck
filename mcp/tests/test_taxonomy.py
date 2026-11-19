"""Behavioral tests for taxonomy contract validation."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deck_feeds_mcp import taxonomy


class TaxonomyRuleShapeTests(unittest.TestCase):
    def assert_rule_rejected(self, rule_key: str, message: str) -> None:
        document = json.loads(taxonomy.CONTRACT_PATH.read_text(encoding="utf-8"))
        document[rule_key][0] = "invalid"
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "taxonomy.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            with patch.object(taxonomy, "CONTRACT_PATH", path):
                taxonomy.load.cache_clear()
                try:
                    with self.assertRaisesRegex(taxonomy.ContractError, message):
                        taxonomy.load()
                finally:
                    taxonomy.load.cache_clear()

    def test_keyword_rules_reject_non_object_rows(self):
        self.assert_rule_rejected("keyword_rules", "keyword rule")

    def test_context_rules_reject_non_object_rows(self):
        self.assert_rule_rejected("context_rules", "context rule")


if __name__ == "__main__":
    unittest.main()
