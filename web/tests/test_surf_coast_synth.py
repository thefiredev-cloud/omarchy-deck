"""Coast surf feed: blend math, wind quality, rating, tide and water rules with synthetic numbers, and an
end-to-end assembly on real excerpts that covers the Baja model-only path and a spot with no data at all."""
import math
import os
import stat
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from surf_coast import collect, geo, parse, synth  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures", "surf_coast")
H = 3600


def fixture(name):
    with open(os.path.join(FIX, name)) as f:
        return f.read()


class BlendTest(unittest.TestCase):
    BUOY = {"id": "A", "km": 0.0, "age_min": 30, "hs_m": 2.0, "period_s": 14, "dir": 220}
    MOP = {"hs_m": 1.0, "tp_s": 12, "dp": 230, "id": "OC1"}
    OM = {"hs_m": 3.0, "swell_period_s": 10.2, "swell_dir": 250}

    def test_buoy_weight_decays_with_distance_age_and_island_shadow(self):
        self.assertAlmostEqual(synth.buoy_weight(0, 30), 1.0)
        self.assertAlmostEqual(synth.buoy_weight(40, 30), math.exp(-1))
        self.assertAlmostEqual(synth.buoy_weight(0, 120), 0.5)
        self.assertEqual(synth.buoy_weight(0, 180), 0.0)
        self.assertAlmostEqual(synth.buoy_weight(0, 30, "46025"), 0.5)
        self.assertEqual(synth.buoy_weight(151, 10), 0.0)

    def test_buoy_mop_and_corrected_global_model_weighted_mean(self):
        b = synth.blend_waves([self.BUOY], self.MOP, self.OM, 0.5)
        # buoy 1.0, MOP 0.3, OM 0.3 (buoy under 30 km); OM corrected 3.0 x 0.5 = 1.5
        self.assertAlmostEqual(b["hs_m"], (2.0 + 0.3 + 0.45) / 1.6)
        # OM swell period reads 0.85 of a peak period: 10.2 / 0.85 = 12
        self.assertAlmostEqual(b["period_s"], (14 + 0.3 * 12 + 0.3 * 12) / 1.6)
        self.assertFalse(b["model_only"])
        om = next(p for p in b["parts"] if p["kind"] == "global model")
        self.assertEqual((om["raw_m"], om["hs_m"], om["bias"]), (3.0, 1.5, 0.5))
        c = synth.confidence(b)
        self.assertEqual((c["level"], c["sources"], c["score"]), ("high", 3, 0.87))

    def test_farther_buoy_gives_models_more_weight(self):
        far = dict(self.BUOY, km=60.0)
        b = synth.blend_waves([far], self.MOP, self.OM, 1.0)
        w = {p["kind"]: p["weight"] for p in b["parts"]}
        self.assertEqual((w["nearshore model"], w["global model"]), (0.35, 0.4))
        self.assertAlmostEqual(w["buoy"], round(math.exp(-60 / 40.0), 3))

    def test_no_buoy_is_model_only_with_low_confidence(self):
        b = synth.blend_waves([], self.MOP, self.OM, None)
        self.assertAlmostEqual(b["hs_m"], 1.0 * 0.6 + 3.0 * 0.4)
        self.assertTrue(b["model_only"])
        self.assertEqual(synth.confidence(b)["level"], "low")
        only = synth.blend_waves([dict(self.BUOY, km=400.0)], None, self.OM, None)
        self.assertEqual((only["hs_m"], only["n"]), (3.0, 1))
        self.assertEqual(synth.confidence(only), {"level": "low", "score": 0.3, "sources": 1, "model_only": True})

    def test_a_zero_model_cell_is_a_hole_not_flat_water(self):
        self.assertIsNone(synth.blend_waves([], None, {"hs_m": 0.0}, None))
        self.assertIsNone(synth.blend_waves([dict(self.BUOY, hs_m=None)], None, None, None))
        self.assertEqual(synth.confidence(None)["level"], None)

    def test_bias_ratio_needs_three_pairs_and_is_clamped(self):
        self.assertIsNone(synth.bias_ratio([(1.0, 1.0)] * 2))
        self.assertEqual(synth.bias_ratio([(0.9, 1.0)] * 3), 0.9)
        self.assertEqual(synth.bias_ratio([(2.0, 1.0)] * 3), 1.4)
        self.assertEqual(synth.bias_ratio([(0.1, 1.0)] * 3), 0.7)

    def test_region_bias_falls_back_to_neighbour_then_coast_but_never_invents_one_for_baja_sur(self):
        regions = collect.inventories()["regions"]
        hist = [{"region": "san-diego", "obs": 1.1, "model": 1.0}] * 3 + [{"region": "oregon-north", "obs": 0.8, "model": 1.0}] * 3
        b = collect.region_bias(hist, regions)
        self.assertEqual(b["san-diego"][:2], (1.1, "san-diego"))
        self.assertEqual(b["baja-norte"][:2], (1.1, "san-diego"))
        self.assertEqual(b["oregon-central"][:2], (0.8, "oregon-north"))
        self.assertEqual(b["monterey-santa-cruz"][:2], (0.95, "coast"))
        self.assertEqual(b["baja-sur"], (None, None, 0))

    def test_surf_range_adds_a_long_period_allowance(self):
        self.assertEqual(synth.surf_range_ft(1.5, 14), [5, 6])
        self.assertEqual(synth.surf_range_ft(1.5, 8), [5, 5])
        self.assertEqual(synth.surf_range_ft(0.1, 10), [0, 1])
        self.assertIsNone(synth.surf_range_ft(None, 10))

    def test_mop_scale_is_the_ratio_of_medians_and_needs_three_agreeing_spots(self):
        # blended 1.5 m everywhere, MOP 1.0, 0.8 and 0.2: the median of factor x MOP is the median blend
        k = synth.mop_scale([(1.5, 1.0), (1.5, 0.8), (1.5, 0.2)])
        self.assertAlmostEqual(k, 1.5 / 0.8)
        self.assertAlmostEqual(geo.median([k * m for m in (1.0, 0.8, 0.2)]), 1.5)
        self.assertIsNone(synth.mop_scale([(1.5, 1.0), (1.5, 0.8)]))  # two points are no shape
        self.assertIsNone(synth.mop_scale([(1.5, 0.1), (1.5, 0.1), (1.5, 0.1)]))  # factor 15: model and buoys disagree
        self.assertIsNone(synth.mop_scale([(1.5, 0.0)] * 3))
        self.assertIsNone(synth.mop_scale([(None, 1.0), (1.5, None), (1.5, 1.0)]))

    def test_spot_height_follows_the_scaled_mop_or_says_region(self):
        hs, basis = synth.spot_height(1.5, 0.2, 2.25)
        self.assertEqual((round(hs, 6), basis), (0.45, "spot"))
        self.assertEqual(synth.spot_height(1.5, None, 2.25), (1.5, "region"))  # no MOP point: the area's height
        self.assertEqual(synth.spot_height(1.5, 0.2, None), (1.5, "region"))  # no region factor
        self.assertEqual(synth.spot_height(None, 0.2, 2.25), (None, None))

    def test_a_sensor_at_the_break_overrules_a_disagreeing_model_by_rule(self):
        ft = 1 / geo.M_TO_FT
        # Scripps Pier on 2026-11-15: MOP scaled to 2.9 ft, the pier sensor (0.0 km) reads 4.6 ft: the sensor prints
        self.assertEqual(synth.checked_height(5.3 * ft, 2.9 * ft, {"hs_m": 4.6 * ft, "km": 0.0}, None),
                         (4.6 * ft, "sensor", "sensor_disagrees"))
        # the same disagreement 1.5 km off: the sensor is not at the break, so the area's blend
        self.assertEqual(synth.checked_height(5.3 * ft, 2.9 * ft, {"hs_m": 4.6 * ft, "km": 1.5}, None),
                         (5.3 * ft, "region", "sensor_disagrees"))
        # within 1 ft or within 20% of the sensor: the scaled height stands (Leucadia 5.7 vs 6.2, Doheny 5.3 vs 4.9)
        self.assertEqual(synth.checked_height(6.1 * ft, 5.7 * ft, {"hs_m": 6.2 * ft, "km": 0.9}, None)[1:], ("spot", None))
        self.assertEqual(synth.checked_height(4.4 * ft, 5.3 * ft, {"hs_m": 4.9 * ft, "km": 1.8}, None)[1:], ("spot", None))
        self.assertFalse(synth.sensor_disagrees(2.0, 2.9))  # 0.9 ft: under the 1 ft floor even at 31%
        self.assertTrue(synth.sensor_disagrees(5.8, 7.9))  # Del Mar: 2.1 ft and 27%

    def test_the_forecaster_band_sends_far_off_model_heights_to_the_area(self):
        self.assertEqual(synth.outside_band(14.4, [4, 6]), "above")  # over 1.5 x 6
        self.assertIsNone(synth.outside_band(9.0, [4, 6]))
        self.assertIsNone(synth.outside_band(10.5, [4, 6], sets_ft=7))  # sets lift the top
        self.assertEqual(synth.outside_band(0.7, [4, 7]), "below")  # under a fifth of 4
        self.assertIsNone(synth.outside_band(1.8, [4, 7]))  # Newport Pier today: sheltered, still believed
        ft = 1 / geo.M_TO_FT
        hs, basis, why = synth.checked_height(9.2 * ft, 14.4 * ft, None, {"ft": [4, 6]})
        self.assertEqual((round(hs * geo.M_TO_FT, 6), basis, why), (9.2, "region", "outside_forecaster_band"))


class WindAndRatingTest(unittest.TestCase):
    def test_wind_quality_against_the_break_facing(self):
        self.assertEqual(synth.wind_quality(70, 250), "offshore")
        self.assertEqual(synth.wind_quality(250, 250), "onshore")
        self.assertEqual(synth.wind_quality(160, 250), "cross-shore")
        self.assertEqual(synth.wind_quality(170, 350), "offshore")  # across the 0/360 line
        self.assertEqual(synth.wind_quality(10, 350), "onshore")
        self.assertIsNone(synth.wind_quality(None, 250))
        self.assertEqual(synth.wind_word(3, "onshore"), "calm")
        self.assertEqual(synth.wind_word(8, "offshore"), "light offshore")
        self.assertEqual(synth.wind_word(20, "onshore"), "strong onshore")

    def test_rating_scale_and_words(self):
        score, r, word = synth.rate(4.9, 15, 6, "offshore", "rising")
        self.assertEqual((score, r, word), (9.65, 10, "Good"))  # a top day at home: the old feed's ceiling word
        self.assertEqual(synth.rate(3.0, 9, 12, "onshore", "falling")[1:], (3, "Poor"))
        self.assertEqual(synth.rate(4.0, 13, 8, "cross-shore", "falling")[1:], (6, "Fair"))

    def test_word_mapping_boundaries_are_the_fitted_cuts(self):
        # fitted against the old 7-spot feed: docs/surf-coast.md rule 9
        self.assertEqual(synth.WORD_CUTS, (5.0, 7.5, 9.75))
        cases = [(1.0, "Poor"), (4.99, "Poor"), (5.0, "Fair"), (7.49, "Fair"), (7.5, "Good"),
                 (9.5, "Good"), (9.7, "Good"), (9.75, "Great"), (10.0, "Great")]
        for score, word in cases:
            self.assertEqual(synth.rating_word(score, 5.0), word, score)
        self.assertEqual(synth.rating_word(6.0, 0.8), "Flat")  # flat wins over the score under 1 ft
        self.assertIsNone(synth.rating_word(None, 5.0))
        # an ordinary small clean morning is not the top word: 3 ft at 11 s, offshore, rising
        self.assertEqual(synth.rate(3.0, 11, 6, "offshore", "rising")[2], "Fair")
        # a good day at home reads Good; the top word needs the long-period swell and a good tide together
        self.assertEqual(synth.rate(4.9, 15, 6, "offshore", "falling")[2], "Good")
        self.assertEqual(synth.rate(5.0, 16, 2, "offshore", "rising")[2], "Great")

    def test_strong_onshore_caps_at_4_and_under_a_foot_is_flat(self):
        # 20 kt onshore is blown out: the cap is 4, and 4 now reads Poor
        self.assertEqual(synth.rate(5.0, 15, 20, "onshore", "rising")[1:], (4, "Poor"))
        self.assertEqual(synth.rate(0.6, 15, 2, "offshore", "rising")[1:], (1, "Flat"))
        self.assertEqual(synth.rate(None, 15, 2, "offshore", "rising"), (None, None, None))

    def test_reason_is_one_plain_line(self):
        self.assertEqual(synth.reason(4.9, 14.6, 225, 6, "offshore", "rising"),
                         "5 ft at 15 s from SW, light offshore wind, rising tide")
        self.assertEqual(synth.reason(None, None, None, None, None, None), "No wave reading here right now.")


class TideWaterTest(unittest.TestCase):
    EV = [{"type": "L", "at": 0, "ft": 0.0}, {"type": "H", "at": 6 * H, "ft": 4.0}, {"type": "L", "at": 12 * H, "ft": 1.0}]

    def test_tide_state_and_cosine_height(self):
        self.assertEqual(synth.tide_state(self.EV, 3 * H), "rising")
        self.assertEqual(synth.tide_state(self.EV, 6 * H - 600), "high")
        self.assertEqual(synth.tide_state(self.EV, 9 * H), "falling")
        self.assertIsNone(synth.tide_state(self.EV, 13 * H))
        self.assertAlmostEqual(synth.tide_height(self.EV, 3 * H), 2.0)
        self.assertAlmostEqual(synth.tide_height(self.EV, 0), 0.0)

    def test_model_tide_drops_wiggles_and_alternates(self):
        vals = [0, 1, 2, 3, 2.95, 3.5, 4, 3, 2, 1, 0, 1, 2]
        ev = synth.extrema_from_series([i * H for i in range(len(vals))], vals)
        self.assertEqual([e["type"] for e in ev], ["H", "L"])
        self.assertEqual((ev[0]["ft"], ev[1]["ft"], ev[1]["at"]), (4.02, 0, 10 * H))

    def test_model_tide_keeps_a_small_real_pair_six_hours_apart(self):
        vals = [1, 2, 3, 4, 3.5, 3, 2.5, 2, 1.5, 1.0, 1.03, 1.07, 1.1, 1.15, 1.18, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2, 0.0, 0.5]
        ev = synth.extrema_from_series([i * H for i in range(len(vals))], vals)
        self.assertEqual([e["type"] for e in ev], ["H", "L", "H", "L"])

    def test_water_is_the_median_with_its_spread(self):
        w = synth.water_blend([{"kind": "buoy", "f": 74.7}, {"kind": "satellite", "f": 73.9}, {"kind": "model", "f": 75.1},
                               {"kind": "pier", "f": None}])
        self.assertEqual(w, {"value": 74.7, "spread": 1.2, "n": 3})
        self.assertIsNone(synth.water_blend([]))

    def test_best_window_is_daylight_only(self):
        scores = {3: 9.0, 4: 9.0, 8: 6.0, 9: 7.0, 10: 5.0}
        hours = [{"at": h * H, "score": scores.get(h, 2.0)} for h in range(24)]
        start, end, s = synth.best_window(hours, [(6 * H, 18 * H)])
        self.assertEqual((start, end, s), (8 * H, 10 * H, 6.5))
        self.assertIsNone(synth.best_window(hours, [(30 * H, 31 * H)]))

    def test_water_confidence_rises_with_observed_readings_that_agree(self):
        model_only = synth.water_confidence([{"kind": "model", "f": 74.0}])
        self.assertEqual(model_only, {"level": "low", "score": 0.25})
        sat_model = synth.water_confidence([{"kind": "model", "f": 74.0}, {"kind": "satellite", "f": 73.0}])
        self.assertEqual(sat_model, {"level": "low", "score": 0.4})
        two_buoys = synth.water_confidence([{"kind": "buoy", "f": 74.6}, {"kind": "pier", "f": 74.2},
                                            {"kind": "model", "f": 74.6}])
        self.assertEqual(two_buoys, {"level": "high", "score": round(0.5 + 0.3 + 0.2 * 0.9, 2)})
        split = synth.water_confidence([{"kind": "buoy", "f": 58.0}, {"kind": "satellite", "f": 64.0}])
        self.assertEqual(split, {"level": "medium", "score": 0.65})
        self.assertIsNone(synth.water_confidence([]))

    def test_upwelling_is_readings_more_than_two_celsius_apart(self):
        self.assertTrue(synth.upwelling([55.0, 59.0]))
        self.assertFalse(synth.upwelling([55.0, 58.5]))
        self.assertFalse(synth.upwelling([55.0, None]))

    def test_day_confidence_by_lead_capped_by_the_spot_sources(self):
        self.assertEqual(synth.day_confidence(0, {"score": 0.9}), {"level": "high", "score": 0.8})
        self.assertEqual(synth.day_confidence(3, {"score": 0.9}), {"level": "medium", "score": 0.6})
        self.assertEqual(synth.day_confidence(6, {"score": 0.9}), {"level": "low", "score": 0.4})
        self.assertEqual(synth.day_confidence(0, {"score": 0.3}), {"level": "low", "score": 0.3})

    def test_buoy_hours_roll_and_bin_by_hour(self):
        now = 100 * H + 1200
        hist = {"46224": [[now - 30 * H, 1.0], [now - 5 * H, 1.2]]}
        latest = {"46224": {"at": now - 600, "wvht_m": 1.5}, "LJAC1": {"at": now - 600, "wvht_m": None}}
        rows = collect.buoy_heights(hist, latest, now)
        self.assertEqual(rows, {"46224": [[now - 5 * H, 1.2], [now - 600, 1.5]]})  # 30 h old reading dropped
        self.assertEqual(collect.buoy_heights(rows, latest, now)["46224"], rows["46224"])  # same reading not doubled
        h = collect.hours_ft(rows["46224"], now)
        self.assertEqual((h["start"], h["step"], len(h["ft"])), (77 * H, H, 24))
        self.assertEqual((h["ft"][-1], h["ft"][-6], h["ft"][0]), (round(1.5 * geo.M_TO_FT, 1), round(1.2 * geo.M_TO_FT, 1), None))


class GeoTest(unittest.TestCase):
    def test_compass_and_labels(self):
        self.assertEqual(geo.compass(225), "SW")
        self.assertEqual(geo.compass(248, 16), "WSW")
        self.assertEqual(geo.compass(359), "N")
        at = parse.iso_epoch("2026-11-15T15:00:00Z")
        self.assertEqual(geo.window_label(at, at + 2 * H, "America/Los_Angeles"), "7-9 am")
        self.assertEqual(geo.window_label(at + 4 * H, at + 6 * H, "America/Los_Angeles"), "11 am-1 pm")
        # Baja Sur keeps UTC-7 all year
        self.assertEqual(geo.clock(at, "America/Mazatlan"), "8 am")

    def test_sunrise_is_close_to_the_almanac(self):
        import datetime as dt
        sun = geo.sun_times(dt.date(2026, 11, 15), 33.477, -117.723, "America/Los_Angeles")
        # Open-Meteo gave 6:22 am PST for this point on 2026-11-15
        self.assertLess(abs(sun["sunrise"] - parse.iso_epoch("2026-11-15T14:22:00Z")), 180)
        self.assertLess(sun["first_light"], sun["sunrise"])
        self.assertLess(sun["sunset"], sun["last_light"])


class AssembleTest(unittest.TestCase):
    NOW = parse.iso_epoch("2026-11-15T01:20:00Z")

    def setUp(self):
        full = collect.inventories()
        keep = {"salt-creek", "cabo-falso", "seaside-cove"}
        self.inv = {"spots": [s for s in full["spots"] if s["id"] in keep], "regions": full["regions"],
                    "ndbc": [s for s in full["ndbc"] if s["id"] in ("46285", "46224", "46277", "LJAC1", "46232")],
                    "coops": full["coops"]}
        by = {s["id"]: s for s in self.inv["spots"]}
        marine = parse.open_meteo(fixture("om_marine.json"))
        wind = parse.open_meteo(fixture("om_wind.json"))
        self.raw = {
            "latest": parse.ndbc_latest(fixture("latest_obs.txt")),
            "spec": {"46224": parse.ndbc_spec(fixture("46224.spec"))},
            "mop": {"OC172": dict(parse.mop_ascii(fixture("mop_OC172.txt")), at=self.NOW - 3600)},
            "marine": {collect.cell_key(*by["salt-creek"]["om"]): marine[0], collect.cell_key(*by["cabo-falso"]["om"]): marine[1]},
            "wind": {collect.cell_key(*collect.wind_cell(by["salt-creek"])): wind[0],
                     collect.cell_key(*collect.wind_cell(by["cabo-falso"])): wind[1]},
            "tides": {"9410580": parse.coops_hilo(fixture("coops_hilo_9410580.json"))},
            "sealevel": {}, "piers": [], "mur": {}, "alerts": parse.nws_alerts(fixture("nws_alerts.json")), "om_buoys": {},
            "srf": parse.nws_srf(fixture("srf_SGX.txt"), parse.iso_epoch("2026-11-14T21:36:00Z")),
        }
        self.ov, self.regions, self.state = collect.assemble(self.inv, self.raw, {}, self.NOW, {})
        self.spots = {s["id"]: s for s in self.ov["spots"]}

    def test_home_spot_blends_buoy_and_models_and_comes_first(self):
        self.assertEqual(self.ov["spots"][0]["id"], "salt-creek")
        s = self.spots["salt-creek"]
        self.assertEqual(s["pinned"], collect.PINNED.index("salt-creek") + 1)
        n = s["now"]
        self.assertFalse(n["confidence"]["model_only"])
        self.assertIn(n["confidence"]["level"], ("high", "medium"))
        parts = self.regions["orange-county"]["spots"][0]["parts"]["hs"]
        kinds = [p["kind"] for p in parts]
        self.assertIn("buoy", kinds)
        self.assertIn("nearshore model", kinds)
        lo, hi = min(p["ft"] for p in parts), max(p["ft"] for p in parts)
        self.assertTrue(lo - 0.1 <= n["hs_ft"] <= hi + 0.1, (n["hs_ft"], parts))
        self.assertEqual(s["buoy"]["id"], "46285")
        # Newport predictions: high 18:52Z on the 14th, low 03:08Z on the 15th; at 01:20Z the tide is falling
        self.assertEqual(n["tide"]["next"], {"type": "L", "at": parse.iso_epoch("2026-11-15T03:08:00Z"), "ft": 0.5,
                                             "label": "7:08 pm"})
        self.assertEqual(n["tide"]["state"], "falling")
        self.assertEqual(n["swell"][0]["src"], "buoy")  # 46224 spectrum is within 50 km
        self.assertIsNotNone(n["rating"])
        self.assertTrue(n["reason"].startswith("%d ft" % int(math.floor(n["hs_ft"] + 0.5))))
        self.assertEqual(len(s["days"]), 7)

    def test_baja_sur_is_model_only_and_says_so(self):
        s = self.spots["cabo-falso"]
        n = s["now"]
        self.assertTrue(n["confidence"]["model_only"])
        self.assertEqual(n["confidence"]["level"], "low")
        # raw Open-Meteo at 01:20Z (no buoys anywhere near to correct it): 1.94 m
        self.assertEqual(n["hs_ft"], round(1.94 * geo.M_TO_FT, 1))
        self.assertIsNone(s["buoy"])
        self.assertIn("No wave buoy within 150 km. Height is from models.", s["gaps"])
        self.assertIn("No official surf alerts cover Mexico.", s["gaps"])
        self.assertIn("No tide station within 60 km. Tide times are from a model.", s["gaps"])
        self.assertEqual(n["water_f"]["n"], 1)  # the model vote only, no buoy invented
        reg = next(r for r in self.ov["regions"] if r["id"] == "baja-sur")
        self.assertIn("No wave buoys here. Heights are from models.", reg["gaps"])
        self.assertEqual(self.ov["method"]["bias"]["baja-sur"]["factor"], None)

    def test_a_spot_with_no_data_says_so_instead_of_inventing_numbers(self):
        s = self.spots["seaside-cove"]
        n = s["now"]
        self.assertEqual((n["hs_ft"], n["wave_ft"], n["rating"], n["word"]), (None, None, None, None))
        self.assertEqual(n["reason"], "No wave reading here right now.")
        self.assertIn("No wave reading here right now.", s["gaps"])
        self.assertEqual((self.ov["coverage"]["spots"], self.ov["coverage"]["spots_with_data"]), (3, 2))
        reg = next(r for r in self.ov["regions"] if r["id"] == "oregon-north")
        self.assertEqual((reg["rating"], reg["line"]), (None, "No wave reading here right now."))

    def test_region_files_carry_hourly_series_and_curves(self):
        oc = self.regions["orange-county"]
        sp = oc["spots"][0]
        self.assertEqual(len(sp["hours"]["hs_ft"]), 72)
        self.assertEqual(sp["hours"]["step"], 3600)
        self.assertEqual(oc["tides"][0]["id"], "9410580")
        self.assertEqual(len(oc["tides"][0]["curve"]["ft"]), 48)
        self.assertEqual(oc["region"]["id"], "orange-county")
        self.assertTrue(all(r in self.regions for r in [x["id"] for x in self.inv["regions"]]))

    def test_buoy_rows_and_alerts(self):
        ids = [b["id"] for b in self.ov["buoys"]]
        self.assertIn("46224", ids)
        b = next(b for b in self.ov["buoys"] if b["id"] == "46224")
        self.assertEqual((b["wave_ft"], b["owner"], b["wind"]), (round(1.5 * geo.M_TO_FT, 1), "CDIP", None))
        self.assertEqual(b["swell"]["dir"], "SW")
        self.assertEqual(b["lat"], sorted(x["lat"] for x in self.ov["buoys"])[ids.index("46224")])
        oc = next(r for r in self.ov["regions"] if r["id"] == "orange-county")
        self.assertGreaterEqual(oc["alerts"], 1)

    def test_outputs_are_written_atomically_mode_600(self):
        with tempfile.TemporaryDirectory() as d:
            path = collect.write_outputs(d, self.ov, self.regions)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(len(os.listdir(os.path.join(d, "surf-coast"))), 14)
            self.assertFalse([f for f in os.listdir(d) if f.endswith(".tmp")])

    def test_forecaster_rip_water_confidence_and_day_dots(self):
        s = self.spots["salt-creek"]
        self.assertEqual(s["forecaster"]["ft"], [4, 7])
        self.assertEqual((s["forecaster"]["sets_ft"], s["forecaster"]["zone"]), (8, "CAZ552"))
        self.assertEqual(s["rip"], {"risk": "high", "zone": "CAZ552", "name": "Orange County Coastal Areas"})
        oc = next(r for r in self.ov["regions"] if r["id"] == "orange-county")
        self.assertEqual((oc["forecaster"]["ft"], oc["rip"]["risk"]), ([4, 7], "high"))
        self.assertIn(s["now"]["water_f"]["confidence"]["level"], ("high", "medium"))
        self.assertIn("confidence", oc["water_f"])
        self.assertNotIn("upwelling", s["now"]["water_f"])  # not an upwelling coast: the key is left out
        self.assertEqual([d["confidence"]["level"] for d in s["days"][:2]], ["high", "high"])
        # Baja: no NWS zone, so no forecaster or rip keys; model-only day dots stay low
        cabo = self.spots["cabo-falso"]
        self.assertNotIn("forecaster", cabo)
        self.assertNotIn("rip", cabo)
        self.assertNotIn("forecaster", next(r for r in self.ov["regions"] if r["id"] == "baja-sur"))
        self.assertTrue(all(d["confidence"] is None or d["confidence"]["level"] == "low" for d in cabo["days"]))
        self.assertEqual(cabo["now"]["water_f"]["confidence"], {"level": "low", "score": 0.25})
        # a spot with no data has no day dots
        self.assertTrue(all(d["confidence"] is None for d in self.spots["seaside-cove"]["days"]))

    def test_buoy_sparkline_comes_from_the_remembered_readings(self):
        b = next(b for b in self.ov["buoys"] if b["id"] == "46224")
        self.assertEqual(len(b["hours_ft"]["ft"]), 24)
        self.assertEqual(b["hours_ft"]["ft"][-2], round(1.5 * geo.M_TO_FT, 1))  # 00:26Z reading, the hour before 01:20Z
        self.assertEqual(self.state["buoys"]["46224"], [[parse.iso_epoch("2026-11-15T00:26:00Z"), 1.5]])
        shore = next(b for b in self.ov["buoys"] if b["id"] == "LJAC1")
        self.assertIsNone(shore["hours_ft"])  # no wave sensor: no sparkline


class SpotHeightAssembleTest(unittest.TestCase):
    """Orange County on one swell: the same buoys feed every spot, the nearshore model (MOP) tells them apart."""
    NOW = parse.iso_epoch("2026-11-15T01:20:00Z")
    MOP_SHARE = {"salt-creek": 1.0, "strands": 0.95, "doheny-state-beach": 0.8, "newport-pier": 0.3}

    def assemble(self, now, fetched=None, on=True):
        """`fetched`: {spot id: epoch} of its MOP fetch; one hour before `now` when not named. `on`: the switch."""
        full = collect.inventories()
        keep = set(self.MOP_SHARE) | {"calafia-beach"}
        inv = {"spots": [s for s in full["spots"] if s["id"] in keep], "regions": full["regions"],
               "ndbc": [s for s in full["ndbc"] if s["id"] in ("46285", "46224", "46277", "46232")], "coops": full["coops"]}
        by = {s["id"]: s for s in inv["spots"]}
        mop = parse.mop_ascii(fixture("mop_OC172.txt"))
        raw = {
            "latest": parse.ndbc_latest(fixture("latest_obs.txt")), "spec": {},
            "mop": {by[sid]["mop"]: dict(mop, hs_m=[None if v is None else v * f for v in mop["hs_m"]],
                                         at=(fetched or {}).get(sid, now - 3600))
                    for sid, f in self.MOP_SHARE.items()},
            "marine": {collect.cell_key(*by["salt-creek"]["om"]): parse.open_meteo(fixture("om_marine.json"))[0]},
            "wind": {}, "tides": {"9410580": parse.coops_hilo(fixture("coops_hilo_9410580.json"))},
            "sealevel": {}, "piers": [], "mur": {}, "alerts": [], "om_buoys": {},
            "srf": parse.nws_srf(fixture("srf_SGX.txt"), parse.iso_epoch("2026-11-14T21:36:00Z")),
        }
        ov, regions, _ = collect.assemble(inv, raw, {}, now, {}, spot_height=on)
        detail = {s["id"]: s for s in regions["orange-county"]["spots"]}
        return ov, {s["id"]: s for s in ov["spots"]}, detail

    def test_the_switch_turns_break_heights_off_without_a_code_change(self):
        on_ov, on_spots, _ = self.assemble(self.NOW)
        ov, spots, detail = self.assemble(self.NOW, on=False)
        self.assertEqual(ov["method"]["spot_height"], "off")
        self.assertEqual(on_ov["method"]["spot_height"], "on")
        for sid, s in spots.items():
            self.assertEqual(s["now"]["height_basis"], "region")
            self.assertIsNone(detail[sid]["parts"]["scale"])
            self.assertFalse([g for g in s["gaps"] if "nearshore model" in g])
        # off prints the area's blend: what the feed printed before break heights
        blend = sum(p["ft"] * p["weight"] for p in detail["newport-pier"]["parts"]["hs"]) / sum(p["weight"] for p in detail["newport-pier"]["parts"]["hs"])
        self.assertAlmostEqual(spots["newport-pier"]["now"]["hs_ft"], blend, delta=0.15)
        self.assertLess(on_spots["newport-pier"]["now"]["hs_ft"], spots["newport-pier"]["now"]["hs_ft"])
        env = os.environ.get("DECK_SURF_SPOT_HEIGHT")
        try:
            for v, want in (("off", False), ("0", False), ("No", False), ("on", True), ("", True)):
                os.environ["DECK_SURF_SPOT_HEIGHT"] = v
                self.assertEqual(collect.spot_height_on(), want, v)
        finally:
            if env is None:
                os.environ.pop("DECK_SURF_SPOT_HEIGHT", None)
            else:
                os.environ["DECK_SURF_SPOT_HEIGHT"] = env

    def test_only_a_fresh_nearshore_sensor_within_2_km_checks_a_break(self):
        spot = {"lat": 32.867, "lon": -117.257}
        stations = {"NEAR": {"coast_km": 3}, "OFF": {"coast_km": 7}, "FAR": {"coast_km": 1}, "OLD": {"coast_km": 1}}
        obs = [{"id": "OFF", "kind": "buoy", "lat": 32.867, "lon": -117.257, "wvht_m": 2.0, "age_min": 30},  # 7 km out to sea
               {"id": "FAR", "kind": "buoy", "lat": 32.89, "lon": -117.257, "wvht_m": 2.0, "age_min": 30},  # 2.6 km away
               {"id": "OLD", "kind": "buoy", "lat": 32.867, "lon": -117.257, "wvht_m": 2.0, "age_min": 200},
               {"id": "NEAR", "kind": "shore station", "lat": 32.8675, "lon": -117.257, "wvht_m": 1.4, "age_min": 95}]
        got = collect.near_sensor(spot, obs, stations)
        self.assertEqual((got["id"], got["hs_m"]), ("NEAR", 1.4))
        self.assertLess(got["km"], 0.1)
        self.assertIsNone(collect.near_sensor(spot, obs[:3], stations))

    def test_a_stale_mop_fetch_never_stands_for_now(self):
        # Newport's MOP was fetched 13 h ago (over twice its 6 h tier): not used, the area's height instead
        ov, spots, detail = self.assemble(self.NOW, fetched={"newport-pier": self.NOW - 13 * 3600})
        newport = spots["newport-pier"]
        self.assertEqual(newport["now"]["height_basis"], "region")
        self.assertNotIn("nearshore model", [p["kind"] for p in detail["newport-pier"]["parts"]["hs"]])
        self.assertIn("The nearshore model is too old or has no value for now, so the height is the area's, not the break's own.",
                      newport["gaps"])
        # the fresh ones keep their own height, and carry the age of the forecast they used
        salt = detail["salt-creek"]
        self.assertEqual((salt["now"]["height_basis"], salt["parts"]["scale"]["mop_age_min"]), ("spot", 60))
        self.assertEqual(next(p for p in salt["parts"]["hs"] if p["kind"] == "nearshore model")["age_min"], 60)
        self.assertIsNone(collect.usable_mop({"times": [], "hs_m": []}, self.NOW))  # undated: refused

    def test_a_break_far_below_its_buoys_prints_its_scaled_mop_not_the_region(self):
        ov, spots, detail = self.assemble(self.NOW)
        newport, salt = spots["newport-pier"], spots["salt-creek"]
        sc = detail["newport-pier"]["parts"]["scale"]
        self.assertEqual(newport["now"]["height_basis"], "spot")
        self.assertAlmostEqual(newport["now"]["hs_ft"], sc["factor"] * sc["mop_ft"], delta=0.15)
        self.assertLess(newport["now"]["hs_ft"], 0.6 * sc["blend_ft"])  # the buoy level would have hidden it
        self.assertLess(newport["now"]["hs_ft"], salt["now"]["hs_ft"] / 2)
        self.assertEqual(newport["now"]["wave_ft"][0], int(math.floor(newport["now"]["hs_ft"] + 0.25)))
        # the order of the model holds: Salt Creek > Strands > Doheny > Newport Pier
        hs = [spots[s]["now"]["hs_ft"] for s in ("salt-creek", "strands", "doheny-state-beach", "newport-pier")]
        self.assertEqual(hs, sorted(hs, reverse=True))
        # the level stays the buoys': the median over the scaled spots is the median of their blends
        scaled = [s for s in detail.values() if s["parts"]["scale"]]
        self.assertEqual(len(scaled), 4)
        self.assertAlmostEqual(geo.median([s["now"]["hs_ft"] for s in scaled]),
                               geo.median([s["parts"]["scale"]["blend_ft"] for s in scaled]), delta=0.1)
        self.assertEqual(ov["method"]["mop_scale"]["orange-county"], {"factor": sc["factor"], "spots": 4})
        self.assertEqual(ov["method"]["mop_scale"]["baja-sur"], {"factor": None, "spots": 0})
        self.assertEqual((ov["coverage"]["spots_height_spot"], ov["coverage"]["spots_height_region"]), (4, 1))

    def test_a_break_without_a_mop_point_is_marked_region(self):
        _, spots, detail = self.assemble(self.NOW)
        cal = spots["calafia-beach"]
        self.assertEqual(cal["now"]["height_basis"], "region")
        self.assertIsNotNone(cal["now"]["hs_ft"])  # today's fields stay filled for the current page
        self.assertIsNotNone(cal["now"]["wave_ft"])
        self.assertIsNone(detail["calafia-beach"]["parts"]["scale"])
        self.assertIn("No nearshore model point for this break, so the height is the area's, not the break's own.", cal["gaps"])

    def test_an_expired_forecaster_period_is_never_written(self):
        later = parse.iso_epoch("2026-11-15T03:11:00Z")  # Sat 7:11 pm: today's NWS period ended at 6 pm
        ov, spots, _ = self.assemble(later)
        fc = spots["salt-creek"]["forecaster"]
        self.assertEqual((fc["period"], fc["ft"], fc["end_label"]), ("Sunday", [3, 6], "Sun 6 pm"))
        for s in ov["spots"] + ov["regions"]:
            if s.get("forecaster"):
                self.assertGreater(s["forecaster"]["end"], later)


if __name__ == "__main__":
    unittest.main()
