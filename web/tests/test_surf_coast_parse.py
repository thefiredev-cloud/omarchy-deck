"""Coast surf feed: parsers against real source excerpts (captured 2026-11-15 00:40-01:20Z) and the fetch cache."""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from surf_coast import collect, parse  # noqa: E402
from surf_coast.fetch import Fetcher  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures", "surf_coast")


def fixture(name):
    with open(os.path.join(FIX, name)) as f:
        return f.read()


class NdbcTest(unittest.TestCase):
    def test_latest_obs_keeps_measured_values_and_turns_mm_into_none(self):
        obs = parse.ndbc_latest(fixture("latest_obs.txt"))
        b = obs["46224"]
        self.assertEqual((b["wvht_m"], b["dpd_s"], b["apd_s"], b["mwd"], b["wtmp_c"]), (1.5, 15.0, 8.1, 219.0, 23.6))
        self.assertIsNone(b["wspd_kt"])  # a CDIP wave buoy has no anemometer: MM, never 0
        self.assertEqual(b["at"], parse.iso_epoch("2026-11-15T00:26:00Z"))
        shore = obs["LJAC1"]
        self.assertAlmostEqual(shore["wspd_kt"], 2.6 * 1.943844, places=3)
        self.assertIsNone(shore["wvht_m"])
        self.assertIn("22101", obs)  # every station in one file; the box filter is the inventory's job

    def test_spec_gives_swell_and_wind_wave_parts_with_compass_words_as_degrees(self):
        sp = parse.ndbc_spec(fixture("46224.spec"))
        self.assertEqual((sp["swh_m"], sp["swp_s"], sp["swd"]), (1.1, 15.4, 225.0))
        self.assertEqual((sp["wwh_m"], sp["wwp_s"], sp["wwd"]), (1.1, 9.9, 270.0))
        self.assertEqual(sp["steepness"], "swell")

    def test_bad_bodies_raise_parse_errors(self):
        with self.assertRaises(parse.ParseError):
            parse.ndbc_latest("<html>busy</html>")
        with self.assertRaises(parse.ParseError):
            parse.coops_hilo({"error": {"message": "No Predictions data was found."}})


class TideAndModelTest(unittest.TestCase):
    def test_coops_hilo_is_sorted_epochs_with_types(self):
        ev = parse.coops_hilo(fixture("coops_hilo_9410580.json"))
        self.assertEqual(ev[0], {"type": "L", "at": parse.iso_epoch("2026-11-14T02:10:00Z"), "ft": 0.3})  # 0.301 ft
        self.assertEqual([e["type"] for e in ev[:4]], ["L", "H", "L", "H"])
        self.assertEqual(ev, sorted(ev, key=lambda e: e["at"]))

    def test_open_meteo_marine_two_locations_in_one_body(self):
        docs = parse.open_meteo(fixture("om_marine.json"))
        self.assertEqual(len(docs), 2)
        cabo = docs[1]
        self.assertEqual(cabo["times"][0], 1794700800)  # 2026-11-15T00:00 GMT
        self.assertEqual(cabo["times"][1] - cabo["times"][0], 3600)
        self.assertEqual(cabo["hourly"]["wave_height"][0], 1.94)
        self.assertEqual(cabo["hourly"]["sea_surface_temperature"][0], 29.4)

    def test_mop_ascii_has_80_three_hourly_steps(self):
        m = parse.mop_ascii(fixture("mop_OC172.txt"))
        self.assertEqual(len(m["times"]), 80)
        self.assertEqual(m["times"][1] - m["times"][0], 10800)
        self.assertAlmostEqual(m["hs_m"][0], 0.7192363, places=6)
        # a direction runs to 360: the 99 cap on heights and periods used to turn every direction into None
        self.assertAlmostEqual(m["dp"][0], 237.82712, places=4)
        self.assertEqual(len(m["tp_s"]), 80)


class AlertsTest(unittest.TestCase):
    def test_what_line_and_zones(self):
        items = parse.nws_alerts(fixture("nws_alerts.json"))
        hsa = next(a for a in items if a["event"] == "High Surf Advisory")
        self.assertIn("CAZ552", hsa["ugc"])
        self.assertTrue(hsa["what"].startswith("Large breaking waves") or "breaking waves" in hsa["what"])
        self.assertEqual(hsa["end"], parse.iso_epoch("2026-11-15T10:00:00-08:00"))

    def test_surf_alerts_map_to_regions_and_others_are_dropped(self):
        inv = collect.inventories()
        reg_by = {r["id"]: r for r in inv["regions"]}
        items = parse.nws_alerts(fixture("nws_alerts.json"))
        now = parse.iso_epoch("2026-11-15T01:30:00Z")
        out = collect.build_alerts(items, inv["spots"], reg_by, now)
        events = [a["event"] for a in out]
        self.assertNotIn("Wind Advisory", events)  # inland wind is not a surf alert
        hsa = next(a for a in out if a["event"] == "High Surf Advisory")
        self.assertEqual(hsa["regions"], ["san-diego", "orange-county"])
        self.assertTrue(hsa["text"].startswith("High surf advisory until Sun 10 am."), hsa["text"])
        cfa = next(a for a in out if a["event"] == "Coastal Flood Advisory")
        # a combined statement keeps only the words for its own event
        self.assertNotIn("High Surf Warning", cfa["text"])
        self.assertIn("run up beaches", cfa["text"])
        # once it has ended it is gone
        later = collect.build_alerts(items, inv["spots"], reg_by, parse.iso_epoch("2026-11-20T00:00:00Z"))
        self.assertEqual(later, [])

    def test_single_zone_alerts_reach_spots_listed_under_a_zone_group(self):
        # inventory zones like 'CAZ349-350' (Santa Barbara) and 'CAZ340-346' (San Luis Obispo) once matched no alert
        inv = collect.inventories()
        reg_by = {r["id"]: r for r in inv["regions"]}
        now = parse.iso_epoch("2026-11-15T01:30:00Z")
        items = [{"id": z, "event": "High Surf Advisory", "status": "Actual", "severity": "Minor", "what": None,
                  "ugc": [z], "start": now - 3600, "end": now + 3600} for z in ("CAZ362", "CAZ350", "CAZ346")]
        out = collect.build_alerts(items, inv["spots"], reg_by, now)
        self.assertEqual(sorted(r for a in out for r in a["regions"]), ["los-angeles", "san-luis-obispo", "santa-barbara"])


class ErddapTest(unittest.TestCase):
    def test_pier_reading_skips_missing_values(self):
        rows = parse.erddap_csv(fixture("cencoos_newport.csv"))
        at, c = collect.pier_latest(rows, ["sea_water_temperature_ctd", "sea_water_temperature"])
        self.assertEqual(at, parse.iso_epoch("2026-11-15T01:09:22Z"))
        self.assertAlmostEqual(c, 23.4484)

    def test_satellite_cell_is_the_nearest_valid_one(self):
        rows = parse.erddap_csv(fixture("mur_oc.csv"))
        c, at = collect.mur_at(rows, 33.3, -118.15)
        self.assertAlmostEqual(c, 24.089)
        self.assertEqual(at, parse.iso_epoch("2026-11-13T09:00:00Z"))
        self.assertIsNone(collect.mur_at(rows, 20.0, -110.0))  # nothing within reach: no value, not a guess
        masked = [dict(r, analysed_sst=None) if r["longitude"] == -118.15 else r for r in rows]
        c2, _ = collect.mur_at(masked, 33.3, -118.15)
        self.assertAlmostEqual(c2, 24.103)  # land-masked cell skipped, neighbour used


class SurfZoneForecastTest(unittest.TestCase):
    SGX_ISSUED = parse.iso_epoch("2026-11-14T21:36:00Z")

    def test_sgx_zone_surf_height_sets_rip_and_validity(self):
        z = parse.nws_srf(fixture("srf_SGX.txt"), self.SGX_ISSUED)
        oc = z["CAZ552"]
        # ".THIS AFTERNOON THROUGH SUNDAY" says "4 to 7 feet ... today. 3 to 6 feet Sunday.": one period per day
        self.assertEqual([(p["period"], p["end"], p["surf"], p["rip"]) for p in oc["periods"]], [
            ("Today", parse.iso_epoch("2026-11-15T02:00:00Z"), [{"ft": [4, 7], "sets_ft": 8}], "high"),
            ("Sunday", parse.iso_epoch("2026-11-16T02:00:00Z"), [{"ft": [3, 6]}], "high"),
            ("Monday", parse.iso_epoch("2026-11-17T02:00:00Z"), [{"ft": [4, 7], "sets_ft": 8}], "high"),
        ])
        self.assertEqual(oc["name"], "Orange County Coastal Areas")
        self.assertEqual(oc["until"], parse.iso_epoch("2026-11-15T11:30:00Z"))  # the product's own expiry
        self.assertEqual(z["CAZ043"]["periods"][0]["surf"][0]["ft"], [6, 8])

    def test_period_ends_follow_the_nws_day_and_night_periods(self):
        sat_435pm = parse.iso_epoch("2026-11-15T00:35:00Z")
        sun_1am = parse.iso_epoch("2026-11-15T09:00:00Z")
        cases = [("Rest of today", sat_435pm, "2026-11-15T02:00:00Z"), ("Tonight", sat_435pm, "2026-11-15T14:00:00Z"),
                 ("Rest of tonight", sun_1am, "2026-11-15T14:00:00Z"), ("Today", sun_1am, "2026-11-16T02:00:00Z"),
                 ("This morning", sun_1am, "2026-11-15T20:00:00Z"), ("Sunday", sat_435pm, "2026-11-16T02:00:00Z"),
                 ("Monday night", sat_435pm, "2026-11-17T14:00:00Z"), ("Saturday", sat_435pm, "2026-11-22T02:00:00Z"),
                 ("This afternoon through Monday", sat_435pm, "2026-11-17T02:00:00Z")]
        for words, issued, end in cases:
            self.assertEqual(parse.period_end(words, issued), parse.iso_epoch(end), words)
        self.assertIsNone(parse.period_end("Extended outlook", sat_435pm))  # never a guessed end
        self.assertIsNone(parse.period_end("Today", None))

    def test_continuation_lines_join_their_statement(self):
        text = ("CAZ362-160230-\nMalibu Coast-\n503 AM PST Sun Nov 15 2026\n\n.TODAY...\n"
                "Surf Height...................Northwest Facing Beaches - 10 to 15 feet\n"
                "  with local sets to 20 feet.\n"
                "                              South Facing Beaches - 6 to 9 feet.\n"
                "Rip Current Risk*.............Moderate.\n\n$$\n")
        z = parse.nws_srf(text, parse.iso_epoch("2026-11-15T13:03:00Z"))
        p = z["CAZ362"]["periods"][0]
        self.assertEqual([(x["facing"], x["ft"], x.get("sets_ft")) for x in p["surf"]],
                         [("Northwest", [10, 15], 20), ("South", [6, 9], None)])
        self.assertEqual((p["period"], p["rip"]), ("Today", "moderate"))

    def test_mtr_splits_by_beach_facing_and_has_no_rip_line(self):
        z = parse.nws_srf(fixture("srf_MTR.txt"), parse.iso_epoch("2026-11-15T00:35:00Z"))
        sf = z["CAZ509"]["periods"][0]
        self.assertEqual([(p["facing"], p["facing_deg"], p["ft"]) for p in sf["surf"]],
                         [("Northwest", 315, [14, 18]), ("South", 180, [6, 10])])
        self.assertIsNone(sf["rip"])

    def test_single_number_and_zone_ranges(self):
        z = parse.nws_srf(fixture("srf_MFR.txt"), parse.iso_epoch("2026-11-14T22:40:00Z"))
        self.assertEqual(z["ORZ021"]["periods"][0]["surf"], [{"ft": [24, 24]}])
        self.assertEqual(parse._ugc_list("CAZ362-364"), ["CAZ362", "CAZ364"])
        self.assertEqual(parse._ugc_list("ORZ001>003-005"), ["ORZ001", "ORZ002", "ORZ003", "ORZ005"])
        self.assertEqual(parse.surf_ft("1 foot or less"), (0, 1, None))
        self.assertIsNone(parse.surf_ft("Missing."))

    def test_spot_takes_the_facing_part_closest_to_its_break(self):
        mtr = parse.nws_srf(fixture("srf_MTR.txt"), parse.iso_epoch("2026-11-15T00:35:00Z"))
        now = parse.iso_epoch("2026-11-15T01:00:00Z")
        west = {"facing_deg": 280, "surf_zone": "CAZ509"}
        south = {"facing_deg": 190, "surf_zone": "CAZ509"}
        fc, rip = collect.spot_forecast(west, mtr, "America/Los_Angeles", now)
        self.assertEqual((fc["ft"], fc["facing"], rip), ([14, 18], "Northwest", None))
        self.assertEqual(collect.spot_forecast(south, mtr, "America/Los_Angeles", now)[0]["ft"], [6, 10])
        self.assertEqual(fc["name"], "San Francisco and San Mateo County Coastal Areas")
        # Baja has no NWS surf zone: no forecaster, no rip, nothing made up
        self.assertEqual(collect.spot_forecast({"facing_deg": 225, "surf_zone": None}, mtr, "America/Mazatlan", now), (None, None))
        # combined zone ids in the inventory still resolve
        self.assertEqual(collect.spot_zones({"surf_zone": "CAZ340-346"}), ["CAZ340", "CAZ346"])

    def test_an_ended_period_is_never_chosen(self):
        sgx = parse.nws_srf(fixture("srf_SGX.txt"), self.SGX_ISSUED)
        salt = {"facing_deg": 248, "surf_zone": "CAZ552"}
        tzname = "America/Los_Angeles"
        # Sat 5:20 pm: today's period still runs to 6 pm
        fc, rip = collect.spot_forecast(salt, sgx, tzname, parse.iso_epoch("2026-11-15T01:20:00Z"))
        self.assertEqual((fc["period"], fc["ft"], fc["end"], fc["end_label"]),
                         ("Today", [4, 7], parse.iso_epoch("2026-11-15T02:00:00Z"), "Sat 6 pm"))
        self.assertEqual(rip["risk"], "high")
        # Sat 7:11 pm, an hour after today ended: Sunday's number, never today's
        fc, _ = collect.spot_forecast(salt, sgx, tzname, parse.iso_epoch("2026-11-15T03:11:00Z"))
        self.assertEqual((fc["period"], fc["ft"], fc["end_label"]), ("Sunday", [3, 6], "Sun 6 pm"))
        self.assertGreater(fc["end"], parse.iso_epoch("2026-11-15T03:11:00Z"))
        # Sunday 7 pm: Monday
        self.assertEqual(collect.spot_forecast(salt, sgx, tzname, parse.iso_epoch("2026-11-16T03:00:00Z"))[0]["period"], "Monday")
        # every period over: no forecaster line and no rip risk at all
        self.assertEqual(collect.spot_forecast(salt, sgx, tzname, parse.iso_epoch("2026-11-17T03:00:00Z")), (None, None))

    def test_an_expired_cached_product_is_asked_for_again(self):
        body = json.dumps({"productText": fixture("srf_SGX.txt"), "issuanceTime": "2026-11-14T21:36:00Z"})
        self.assertFalse(collect.srf_expired(body, parse.iso_epoch("2026-11-15T11:00:00Z")))
        self.assertTrue(collect.srf_expired(body, parse.iso_epoch("2026-11-15T11:30:00Z")))
        self.assertFalse(collect.srf_expired("not json", 0))


class FetchCacheTest(unittest.TestCase):
    def test_failed_fetch_keeps_last_good_body_marked_not_fresh(self):
        with tempfile.TemporaryDirectory() as root:
            old = Fetcher(root, now=1_000_000)
            old._store("ndbc", "latest_obs", "http://x", "BODY", {})
            f = Fetcher(root, now=1_000_000 + 7200)
            r = f.get("ndbc", "latest_obs", "http://127.0.0.1:9/latest_obs.txt", ttl=1500, timeout=2)
            self.assertEqual((r.body, r.fresh, r.at), ("BODY", False, 1_000_000))
            self.assertTrue(r.error)
            # within the TTL the cache answers without a request
            r2 = Fetcher(root, now=1_000_000 + 60).get("ndbc", "latest_obs", "http://127.0.0.1:9/x", ttl=1500)
            self.assertEqual((r2.body, r2.fresh, r2.requested), ("BODY", True, False))
            mode = os.stat(os.path.join(root, "surf_ndbc", "latest_obs.body")).st_mode & 0o777
            self.assertEqual(mode, 0o600)

    def test_due_takes_cold_keys_then_the_oldest_up_to_the_cap(self):
        with tempfile.TemporaryDirectory() as root:
            for i, age in enumerate([100, 5000, 9000, 7000]):
                Fetcher(root, now=10_000 - age)._store("mop", "k%d" % i, "u", "x", {})
            due = Fetcher(root, now=10_000).due("mop", ["k0", "k1", "k2", "k3", "cold"], ttl=4000, cap=2)
            self.assertEqual(due, ["cold", "k2", "k3"])

    def test_ledger_marks_old_cache_stale_and_missing_unavailable(self):
        from surf_coast.fetch import Result
        L = collect.Ledger(now=100_000)
        L.note("ndbc-latest", Result("x", 100_000 - 600, True))
        L.note("coastwatch-mur", Result(None, None, False, "waiting for the daily satellite run"))
        L.note("cdip-mop", Result("x", 100_000 - 13 * 3600, True))
        src = {s["id"]: s for s in collect.build_sources(L.rows, {"ndbc-latest": 80}, 100_000)}
        self.assertEqual((src["ndbc-latest"]["status"], src["ndbc-latest"]["count"]), ("ok", 80))
        self.assertEqual(src["coastwatch-mur"]["status"], "unavailable")
        self.assertEqual(src["cdip-mop"]["status"], "stale")  # older than twice its 6 h tier
        self.assertEqual(src["nws-alerts"]["status"], "unavailable")


class InventoryTest(unittest.TestCase):
    def test_committed_inventories_cover_the_coast(self):
        inv = collect.inventories()
        self.assertEqual(len(inv["spots"]), 246)
        self.assertEqual([r["id"] for r in inv["regions"]][0], "baja-sur")
        self.assertEqual([r["id"] for r in inv["regions"]][-1], "oregon-north")
        self.assertEqual(sum(r["spots"] for r in inv["regions"]), 246)
        ids = {s["id"] for s in inv["spots"]}
        for pin in collect.PINNED:
            self.assertIn(pin, ids)
        with open(os.path.join(ROOT, "scripts", "surf_coast", "regions.json")) as f:
            regions = json.load(f)["regions"]
        self.assertEqual([r["order"] for r in regions], list(range(1, 15)))

    def test_server_region_list_matches_the_collector(self):
        # /api/surf-coast/region/<id> refuses ids outside rust/src/surf.rs REGIONS; the two lists must agree
        import re
        with open(os.path.join(ROOT, "rust", "src", "surf.rs")) as f:
            src = f.read()
        block = src[src.index("pub const REGIONS"):]
        block = block[:block.index("];")]
        self.assertEqual(re.findall(r'"([a-z-]+)"', block), [r["id"] for r in collect.inventories()["regions"]])


if __name__ == "__main__":
    unittest.main()
