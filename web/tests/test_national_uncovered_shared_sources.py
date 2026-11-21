"""Behavioral tests for previously uncovered FRED and Census tract helpers."""
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "national"))
sys.path.insert(0, str(ROOT / "scripts" / "national" / "sources"))

import _fred  # noqa: E402
import _tract_universe  # noqa: E402
from ctx import SourceUnavailable  # noqa: E402


class FredReaderTests(unittest.TestCase):
    def test_read_points_ignores_empty_values_and_monthly_last_keeps_final_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "series.csv"
            path.write_text(
                "observation_date,TEST\n"
                "2024-01-02,1.5\n"
                "2024-01-30,2.5\n"
                "not-a-date,9\n"
                "2024-02-01,\n",
                encoding="utf-8",
            )

            points = _fred.read_points(path, "TEST")

        self.assertEqual(points, [["2024-01-02", 1.5], ["2024-01-30", 2.5]])
        self.assertEqual(_fred.monthly_last(points), [["2024-01", 2.5]])

    def test_read_points_rejects_a_different_series_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "series.csv"
            path.write_text("observation_date,OTHER\n2024-01-01,3\n", encoding="utf-8")

            with self.assertRaisesRegex(SourceUnavailable, "unexpected header"):
                _fred.read_points(path, "TEST")


class TractUniverseTests(unittest.TestCase):
    def test_parse_gazetteer_sorts_valid_tract_ids_and_ignores_malformed_rows(self):
        expected = [f"{tract:011d}" for tract in range(50_000)]
        rows = "USPS|GEOID|NAME\n" + "".join(
            f"CA|{geoid}|Tract\n" for geoid in reversed(expected)
        )
        rows += "CA|1234567890|Short\nCA|1234567890A|Nonnumeric\n"

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracts.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("tracts.txt", rows)

            geoids = _tract_universe.parse_gazetteer(path)

        self.assertEqual(len(geoids), len(expected))
        self.assertEqual(geoids[0], expected[0])
        self.assertEqual(geoids[-1], expected[-1])

    def test_parse_gazetteer_rejects_a_dataset_below_the_minimum_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracts.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("tracts.txt", "USPS|GEOID|NAME\nCA|06001000100|Tract\n")

            with self.assertRaisesRegex(SourceUnavailable, "had only 1 tracts"):
                _tract_universe.parse_gazetteer(path)

    def test_parse_gazetteer_rejects_a_header_without_geoid(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracts.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("tracts.txt", "USPS|ID|NAME\nCA|06001000100|Tract\n")

            with self.assertRaisesRegex(SourceUnavailable, "header has no GEOID"):
                _tract_universe.parse_gazetteer(path)


if __name__ == "__main__":
    unittest.main()
