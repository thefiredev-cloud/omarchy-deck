"""Behavioral tests for feed contract validation."""

from __future__ import annotations

import unittest
from unittest.mock import patch


class LaunchContractTests(unittest.TestCase):
    def test_rejects_non_object_items(self):
        from deck_feeds_mcp import contract

        payload = {
            "items": [
                {"id": "skill:valid", "targets": ["hermes"], "arg": "valid"},
                "not an item object",
            ],
        }
        loaded = {"data": payload, "source": {"age_s": 0}}

        with patch.object(contract.feeds, "load", return_value=loaded):
            result = contract.validate_launch()

        top_level = next(check for check in result["checks"] if check["check"] == "top-level keys")
        self.assertFalse(top_level["ok"])
        self.assertEqual(top_level["malformed"], 1)


if __name__ == "__main__":
    unittest.main()
