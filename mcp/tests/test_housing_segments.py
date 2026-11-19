"""housing_segments over the national dataset v2 manifest, and the realestate, cre-deals and national-v2 freshness rows.

Every test writes its own manifest into a temp directory and points the feed registry at it, so results do not depend on
the owner's real status tree.
"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from deck_feeds_mcp import feeds, segments, server

NOW = int(time.time())

FIELDS = {
    "home_value": {"label": "Typical home value", "unit": "usd", "sources": [{"id": "zillow_zhvi", "as_of": "2026-10"}]},
    "gross_yield": {"label": "Gross rent yield", "unit": "pct", "sources": []},
    "zm_zori_mf": {"label": "Multifamily rent index, metro", "unit": "usd",
                   "sources": [{"id": "zillow_metro", "as_of": "2026-10"}]},
    "zm_zori_mf_yoy": {"label": "Multifamily rent change, 1 year", "unit": "pct",
                       "sources": [{"id": "zillow_metro", "as_of": "2026-10"}]},
    "retail_score": {"label": "Retail score", "unit": "score", "sources": []},
}

MANIFEST = {
    "schema": 2,
    "generated_at": NOW - 3600,
    "sources": [{"id": "zillow_metro", "kind": "plugin", "status": "ok", "rows": 99}] * 3,
    "fields": FIELDS,
    "us": {"home_value": 360000, "gross_yield": 6.1, "zips": 39228},
    "states": [
        {"state": "CA", "name": "California", "zips": 1800, "home_value": 780000, "gross_yield": 4.1,
         "zm_zori_mf": 2650, "zm_zori_mf_yoy": 0, "retail_score": None},
        {"state": "WA", "name": "Washington", "zips": 600, "home_value": 610000, "gross_yield": 5.0},
    ],
    "metros": [
        {"cbsa": "31080", "name": "Los Angeles-Long Beach-Anaheim, CA", "zips": 640, "home_value": 950000,
         "gross_yield": 3.6, "zm_zori_mf": 2900, "zm_zori_mf_yoy": 3.2, "retail_score": 71.5},
        {"cbsa": "47900", "name": "Washington-Arlington-Alexandria, DC-VA-MD-WV", "zips": 500, "home_value": 640000},
        {"cbsa": "40140", "name": "Riverside-San Bernardino-Ontario, CA", "zips": 300, "home_value": 590000,
         "zm_zori_mf": None},
    ],
}

SPEC = {"schema": 1, "segments": [
    {"id": "residential", "label": "Residential", "lead": "gross_yield", "fields": ["home_value", "gross_yield", "no_such_field"]},
    {"id": "multifamily", "label": "Multifamily", "lead": "zm_zori_mf_yoy", "fields": ["zm_zori_mf", "zm_zori_mf_yoy"]},
    {"id": "retail", "label": "Retail", "lead": "retail_score", "fields": ["retail_score"]},
]}


class Case(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        patcher = patch.dict(feeds.FEEDS, {name: (self.root,) for name in feeds.ALLOWED_NAMES})
        patcher.start()
        self.addCleanup(patcher.stop)
        spec = self.root / "segments-spec.json"
        spec.write_text(json.dumps(SPEC), encoding="utf-8")
        other = patch.object(segments, "SEGMENTS_FILE", spec)
        other.start()
        self.addCleanup(other.stop)

    def put_manifest(self, manifest=None):
        path = self.root / "national-v2" / "manifest.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(MANIFEST if manifest is None else manifest), encoding="utf-8")
        return path


class FreshnessTests(Case):
    def test_realestate_cre_deals_and_national_v2_ages_are_reported(self):
        (self.root / "realestate.json").write_text(json.dumps({"t": NOW - 600, "refresh": 3600, "errors": []}))
        (self.root / "cre-deals.json").write_text(json.dumps({"t": NOW - 900, "generated_at": NOW - 900, "deals": []}))
        self.put_manifest()

        rows = {row["feed"]: row for row in feeds.freshness()["feeds"]}

        for name, age, refresh in (("realestate", 600, 3600), ("cre-deals", 900, 3600), ("national-v2", 3600, 604800)):
            self.assertTrue(rows[name]["present"], name)
            self.assertAlmostEqual(rows[name]["age_s"], age, delta=5, msg=name)
            self.assertEqual(rows[name]["refresh_s"], refresh, name)
            self.assertFalse(rows[name]["stale"], name)
        self.assertTrue(rows["national-v2"]["file"].endswith("national-v2/manifest.json"))

    def test_an_old_manifest_is_stale_after_three_weekly_cycles(self):
        path = self.put_manifest(dict(MANIFEST, generated_at=NOW - 22 * 86400))

        row = {r["feed"]: r for r in feeds.freshness()["feeds"]}["national-v2"]

        self.assertTrue(row["stale"])
        self.assertEqual(Path(row["file"]), path)

    def test_missing_files_are_listed_as_missing(self):
        report = feeds.freshness()

        for name in ("realestate", "cre-deals", "national-v2"):
            self.assertIn(name, report["missing"])

    def test_epoch_generated_at_is_the_stamp(self):
        self.put_manifest()

        source = feeds.load("national-v2")["source"]

        self.assertEqual(source["generated_at"], datetime.fromtimestamp(NOW - 3600, tz=UTC).isoformat(timespec="seconds"))
        self.assertIsNone(source["feed_src"])  # the manifest's `sources` are per-source rows, not the short list


class FindRowTests(Case):
    def test_state_code_cbsa_code_us_and_names(self):
        manifest = MANIFEST
        self.assertEqual(segments.find_row(manifest, "ca")[1:], ("state", None))
        self.assertEqual(segments.find_row(manifest, "31080")[0]["name"], "Los Angeles-Long Beach-Anaheim, CA")
        self.assertEqual(segments.find_row(manifest, "US")[1], "us")
        self.assertEqual(segments.find_row(manifest, "riverside")[1], "metro")
        self.assertEqual(segments.find_row(manifest, "California")[1], "state")

    def test_an_exact_name_wins_and_a_name_that_fits_several_lists_candidates(self):
        self.assertEqual(segments.find_row(MANIFEST, "washington")[0]["state"], "WA")  # exact state name beats the metro
        row, _, problem = segments.find_row(MANIFEST, "on")
        self.assertIsNone(row)
        self.assertEqual({c["level"] for c in problem["candidates"]}, {"state", "metro"})
        self.assertEqual(segments.find_row(MANIFEST, "Washington-Arlington", "metro")[0]["cbsa"], "47900")
        self.assertEqual(segments.find_row(MANIFEST, "on", "state")[0]["state"], "WA")

    def test_refusals(self):
        self.assertIn("no state or metro matches", segments.find_row(MANIFEST, "Atlantis")[2]["error"])
        self.assertEqual(segments.find_row(MANIFEST, "CA", "zip")[2]["allowed"], ["state", "metro", "us"])
        self.assertIn("geo is empty", segments.find_row(MANIFEST, "  ")[2]["error"])


class ToolTests(Case):
    def test_metro_row_by_segment_with_label_unit_publisher_and_period(self):
        self.put_manifest()

        out = server.housing_segments("31080", "multifamily")

        self.assertTrue(out["ok"], out)
        self.assertEqual((out["level"], out["code"]), ("metro", "31080"))
        self.assertIn("national-v2/manifest.json", out["source"]["file"])
        self.assertEqual(len(out["segments"]), 1)
        seg = out["segments"][0]
        self.assertEqual((seg["id"], seg["lead"], seg["lead_value"]), ("multifamily", "zm_zori_mf_yoy", 3.2))
        self.assertEqual([f["field"] for f in seg["fields"]], ["zm_zori_mf", "zm_zori_mf_yoy"])
        first = seg["fields"][0]
        self.assertEqual((first["label"], first["unit"], first["value"]), ("Multifamily rent index, metro", "usd", 2900))
        self.assertEqual(first["sources"], [{"id": "zillow_metro", "as_of": "2026-10"}])

    def test_a_missing_field_is_unavailable_never_zero_but_a_real_zero_is_kept(self):
        self.put_manifest()

        out = server.housing_segments("CA")

        by_id = {s["id"]: s for s in out["segments"]}
        self.assertEqual([s["id"] for s in out["segments"]], ["residential", "multifamily", "retail"])
        self.assertEqual(by_id["residential"]["unavailable"], ["no_such_field"])
        self.assertEqual(by_id["retail"]["fields"], [])
        self.assertEqual(by_id["retail"]["unavailable"], ["retail_score"])  # null in the row
        self.assertIsNone(by_id["retail"]["lead_value"])
        yoy = next(f for f in by_id["multifamily"]["fields"] if f["field"] == "zm_zori_mf_yoy")
        self.assertEqual(yoy["value"], 0)  # a published zero stays a zero

    def test_null_values_are_unavailable(self):
        self.put_manifest()

        out = server.housing_segments("40140", "multifamily")

        self.assertEqual(out["segments"][0]["fields"], [])
        self.assertEqual(out["segments"][0]["unavailable"], ["zm_zori_mf", "zm_zori_mf_yoy"])

    def test_segment_can_be_named_by_label_and_unknown_segment_lists_ids(self):
        self.put_manifest()

        self.assertEqual(server.housing_segments("CA", "Retail")["segments"][0]["id"], "retail")
        bad = server.housing_segments("CA", "warehouse")
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["allowed"], ["residential", "multifamily", "retail"])

    def test_manifest_segments_block_wins_over_the_file(self):
        block = {"schema": 1, "segments": [{"id": "only", "label": "Only", "lead": "home_value", "fields": ["home_value"]}]}
        self.put_manifest(dict(MANIFEST, segments=block))

        out = server.housing_segments("WA")

        self.assertEqual(out["spec_from"], "manifest")
        self.assertEqual([s["id"] for s in out["segments"]], ["only"])
        self.assertEqual(out["segments"][0]["fields"][0]["value"], 610000)

    def test_missing_feed_and_missing_spec_are_reported(self):
        out = server.housing_segments("CA")
        self.assertFalse(out["ok"])
        self.assertEqual(out["feed"], "national-v2")
        self.assertTrue(out["source"]["tried"][0].endswith("national-v2/manifest.json"))

        self.put_manifest()
        with patch.object(segments, "SEGMENTS_FILE", self.root / "absent.json"):
            gone = server.housing_segments("CA")
        self.assertFalse(gone["ok"])
        self.assertIn("no segment spec", gone["error"])

    def test_bad_geo_keeps_the_source_block(self):
        self.put_manifest()

        out = server.housing_segments("Atlantis")

        self.assertFalse(out["ok"])
        self.assertIn("source", out)


class ShippedSpecTests(unittest.TestCase):
    def test_the_spec_beside_the_module_has_six_segments_with_their_lead_in_their_fields(self):
        document = json.loads(Path(segments.__file__).with_name("segments.json").read_text(encoding="utf-8"))

        self.assertEqual([s["id"] for s in document["segments"]],
                         ["residential", "multifamily", "retail", "office", "industrial", "economy"])
        for spec in document["segments"]:
            self.assertIn(spec["lead"], spec["fields"], spec["id"])
            self.assertEqual(len(spec["fields"]), len(set(spec["fields"])), spec["id"])


if __name__ == "__main__":
    unittest.main()
