"""deck-feed-ecom-market: one product per real item across platforms, movers against stored prices, the matched-panel
category index, its comparison with the official series and the watches' best price. No network.
Run: python3 -m unittest discover -s tests"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from ecom_market import build, products  # noqa: E402
from ecom_market.history import History  # noqa: E402
from ecom_market.sources_keyed import gtin14  # noqa: E402

TODAY = "2026-11-14"


def offer(**kw):
    base = {"platform": "X", "site": "x", "title": "Thing", "brand": None, "model": None, "gtin": None, "ext_id": None,
            "price": 10.0, "regular": None, "rank": None, "url": None, "category": None, "source": "src", "as_of": TODAY}
    base.update(kw)
    return base


class TmpHistory(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.hist = History(str(Path(self.tmp.name) / "h.json"))


class IdentityTests(unittest.TestCase):
    def test_gtin_check_digit_and_padding(self):
        self.assertEqual(gtin14("885909950805"), "00885909950805")  # valid UPC-A (Apple)
        self.assertIsNone(gtin14("885909950806"), "a wrong check digit is not an identity")
        self.assertIsNone(gtin14("12345"))

    def test_identity_order(self):
        self.assertEqual(products.identity(offer(gtin="885909950805", brand="Apple", model="MX123")),
                         ("gtin:00885909950805", "gtin"))
        self.assertEqual(products.identity(offer(steam_appid="730")), ("steam:730", "steam"))
        self.assertEqual(products.identity(offer(brand="Fender", model="Player Stratocaster")),
                         ("bm:fender:playerstratocaster", "brand_model"))
        self.assertEqual(products.identity(offer(ext_id="shopify:kith.com:1")), ("shopify:kith.com:1", "catalog_id"))
        self.assertEqual(products.identity(offer(title="The Big Thing, 2-Pack")), ("title:big-thing-2-pack", "title"))

    def test_model_that_repeats_the_brand_still_matches(self):
        self.assertEqual(products.brand_model_key("Fender", "Fender Player Stratocaster"),
                         products.brand_model_key("FENDER", "Player Stratocaster"))


class MergeTests(TmpHistory):
    def test_brand_model_offer_joins_the_gtin_product_of_the_same_item(self):
        rows = [offer(platform="Best Buy", gtin="885909950805", brand="Shure", model="SM58", price=99.0, rank=3),
                offer(platform="Reverb", brand="Shure", model="SM-58", price=89.0),
                offer(platform="eBay", gtin="00885909950805", price=95.0)]
        got = products.build_products(rows, self.hist, TODAY)
        self.assertEqual(len(got), 1)
        p = got[0]
        self.assertEqual((p["gid"], p["platforms_n"], p["rank"]), ("gtin:00885909950805", 3, 3))
        self.assertEqual(p["price"], {"median": 95.0, "low": 89.0, "high": 99.0})
        self.assertEqual({o["platform"] for o in p["detail"]["offers"]}, {"Best Buy", "Reverb", "eBay"})

    def test_same_title_in_two_stores_stays_two_products(self):
        rows = [offer(platform="Kith", ext_id="shopify:kith.com:1", title="Hoodie"),
                offer(platform="Allbirds", ext_id="shopify:www.allbirds.com:9", title="Hoodie")]
        self.assertEqual(len(products.build_products(rows, self.hist, TODAY)), 2)

    def test_one_price_per_platform_uses_its_lowest_offer(self):
        rows = [offer(platform="Steam", steam_appid="1", price=20.0), offer(platform="Steam", steam_appid="1", price=15.0)]
        p = products.build_products(rows, self.hist, TODAY)[0]
        self.assertEqual((p["platforms_n"], p["price"]["low"]), (1, 15.0))

    def test_rank_change_against_the_last_stored_day(self):
        self.hist.put_rank("steam:1", "2026-11-13", 9)
        p = products.build_products([offer(steam_appid="1", rank=2)], self.hist, TODAY)[0]
        self.assertEqual(p["rank_change"], 7)
        best = products.bestsellers([p])
        self.assertEqual(best[0]["kind"], "bestseller")
        self.assertEqual(best[0]["variants_n"], 1)

    def test_colourways_of_one_product_take_one_bestseller_row_with_a_variant_count(self):
        tt = "https://www.tentree.com/products/"
        hoodie = [(1, 4, "mens-juniper-hoodie-meteorite-black-heather"), (2, 2, "mens-juniper-hoodie-forest-green"),
                  (3, 9, "mens-juniper-hoodie-white")]
        rows = [offer(platform="Tentree", ext_id="shopify:www.tentree.com:%d" % i, brand="tentree", title="Juniper Hoodie",
                      rank=r, price=88.0, url=tt + h) for i, r, h in hoodie]
        rows += [offer(platform="Tentree", ext_id="shopify:www.tentree.com:4", brand="tentree", title="Juniper Hoodie",
                       rank=6, url=tt + "womens-juniper-hoodie-meteorite-black-heather"),  # a women's hoodie: another product
                 offer(platform="Kith", ext_id="shopify:kith.com:7", brand="Kith", title="Juniper Hoodie", rank=3,
                       url="https://kith.com/products/juniper-hoodie-black"),
                 offer(platform="Tentree", ext_id="shopify:www.tentree.com:8", brand="tentree", title="Juniper T-Shirt",
                       rank=5, url=tt + "mens-juniper-tshirt-white"),
                 offer(steam_appid="1", title="Bodycam", rank=7), offer(steam_appid="2", title="Bodycam", rank=8)]
        best = products.bestsellers(products.build_products(rows, self.hist, TODAY))
        self.assertEqual([(b["brand"], b["title"], b["rank"], b["variants_n"]) for b in best],
                         [("tentree", "Juniper Hoodie", 2, 3), ("Kith", "Juniper Hoodie", 3, 1),
                          ("tentree", "Juniper T-Shirt", 5, 1), ("tentree", "Juniper Hoodie", 6, 1),
                          (None, "Bodycam", 7, 1), (None, "Bodycam", 8, 1)])
        for key in ("gid", "price", "platforms_n", "rank_change", "detail"):  # the page's fields keep their shape
            self.assertIn(key, best[0])


class MoverTests(TmpHistory):
    def test_price_drop_against_the_stored_price_a_week_ago(self):
        self.hist.put_price("steam:1", "2026-11-07", 40.0)
        self.hist.put_price("steam:2", "2026-11-07", 10.0)
        ps = products.build_products([offer(steam_appid="1", price=30.0), offer(steam_appid="2", price=10.2)],
                                     self.hist, TODAY)
        rows = products.movers(ps, self.hist, TODAY)
        self.assertEqual([(r["gid"], r["kind"], r["change_pct"]) for r in rows], [("steam:1", "price_drop", -25.0)])
        self.assertEqual(rows[0]["period"], "2026-11-07 to 2026-11-14")

    def test_first_day_has_no_invented_price_moves(self):
        ps = products.build_products([offer(steam_appid="1", price=30.0)], self.hist, TODAY)
        self.assertEqual(products.movers(ps, self.hist, TODAY), [])

    def test_sale_needs_ten_percent_off_the_platforms_regular_price(self):
        ps = products.build_products([offer(steam_appid="1", price=8.0, regular=10.0),
                                      offer(steam_appid="2", price=9.5, regular=10.0)], self.hist, TODAY)
        rows = products.movers(ps, self.hist, TODAY)
        self.assertEqual([(r["gid"], r["kind"], r["change_pct"]) for r in rows], [("steam:1", "on_sale", -20.0)])

    def test_shop_collector_movers_keep_their_meaning(self):
        shop = json.loads((ROOT / "tests/fixtures/ecom_market/shop_ecom.json").read_text())
        shop["movers"].append({"slug": "fishing-crankbait-lure", "query": "fishing crankbait lure", "chg7": 0.125,
                               "kind": "trend", "site": None, "price": 8.96, "url": None})
        rows = products.shop_mover_rows(shop, {"walmart": "Walmart"}, TODAY, {"fishing-crankbait-lure": "outdoors"})
        kinds = [r["kind"] for r in rows]
        self.assertEqual(kinds.count("under_median"), 4)
        self.assertEqual(rows[-1]["kind"], "price_rise", "a rising watch trend is not a drop")
        self.assertEqual(rows[-1]["category"], "outdoors")
        self.assertEqual(rows[-1]["detail"]["offers"][0]["source"], "shop_collector")
        self.assertEqual(len({r["gid"] for r in rows}), len(rows), "two listings of one watch are two movers")


def cat_items(gids, category, platform="Steam"):
    return [{"gid": g, "category": category, "price": {"median": 1.0}, "platforms_n": 1,
             "detail": {"offers": [{"platform": platform}]}} for g in gids]


class IndexTests(TmpHistory):
    def fill(self, gid, prices, start="2026-11-01"):
        for i, p in enumerate(prices):
            if p is not None:
                self.hist.put_price(gid, build.shift_day(start, i), p)

    def cpi(self, key="cpi_computers", series="CUSR0000SEEE01", change=0.55):
        return {key: {"source": "bls_cpi", "series": series, "label": "Consumer prices",
                      "value": 38.761, "period": "2026-10", "change": change, "yoy": None, "hist": []}}

    def test_index_is_matched_against_its_base_and_skips_broken_prices(self):
        for i in range(10):
            self.fill("p%d" % i, [10, 10, 11])
        self.fill("broken", [5, 5, 50])  # a tenfold jump is a broken price, not inflation
        idx = build.platform_index(self.hist, ["p%d" % i for i in range(10)] + ["broken"], "2026-11-03")
        self.assertEqual(idx["base_period"], "2026-11-01")
        self.assertEqual(idx["value"], 110.0)
        self.assertEqual(idx["hist"][1], ["2026-11-02", 100.0])

    def test_fewer_than_ten_products_build_no_index(self):
        for i in range(9):
            self.fill("p%d" % i, [10, 11])
        self.assertIsNone(build.platform_index(self.hist, ["p%d" % i for i in range(9)], "2026-11-02"))

    def test_products_that_come_and_go_never_move_the_7_day_change(self):
        # D6: three search medians jump 20 % mid-week, then 168 new products arrive flat for the last two days.
        # The chained index read that as +21 % in 7 days; only 3 products are priced at both ends, so there is no value.
        for g in "abc":
            self.fill(g, [44.0, 44.0, 53.0, 53.0, 53.0, 53.0, 53.0, 44.9], start="2026-11-07")
        new = ["n%d" % i for i in range(168)]
        for g in new:
            self.fill(g, [20.0, 19.98], start="2026-11-13")
        idx = build.platform_index(self.hist, list("abc") + new, TODAY)
        self.assertIsNone(idx["change_7d"])
        self.assertEqual(idx["panel_7d"], {"from": "2026-11-07", "to": TODAY, "n": 3})
        self.assertEqual(idx["base_period"], "2026-11-13", "the index starts on the first day with 10 products")
        cat = next(c for c in build.build_categories(cat_items(list("abc") + new, "computers"), self.hist, TODAY,
                                                     self.cpi(change=0.22), []) if c["key"] == "computers")
        self.assertEqual((cat["value"], cat["basis"]), (0.22, "official_mom"))
        self.assertIn("171 products, 3 priced at both ends of 7 days; a change needs 10", cat["confidence"]["reasons"])

    def test_7_day_change_is_the_matched_panel_mean(self):
        panel = ["m%d" % i for i in range(12)]
        for g in panel:
            self.fill(g, [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 102.0], start="2026-11-07")
        for i in range(40):  # products only priced at the end, at any price, change nothing
            self.fill("late%d" % i, [500.0 + i], start=TODAY)
        idx = build.platform_index(self.hist, panel + ["late%d" % i for i in range(40)], TODAY)
        self.assertEqual((idx["change_7d"], idx["panel_7d"]["n"]), (2.0, 12))
        cat = next(c for c in build.build_categories(cat_items(panel, "games"), self.hist, TODAY, {}, [])
                   if c["key"] == "games")
        self.assertEqual((cat["basis"], cat["value"], cat["period"]), ("platforms", 2.0, "2026-11-07 to 2026-11-14"))
        self.assertEqual((cat["parts"][0]["measure"], cat["parts"][0]["n_products"]), ("change_7d", 12))

    def home_with_store_move(self, last_price, official):
        panel = ["m%d" % i for i in range(40)]
        sites = [{"gid": g, "category": "home", "price": {"median": 1.0}, "platforms_n": 4,
                  "detail": {"offers": [{"platform": s} for s in ("A", "B", "C", "D")]}} for g in panel]
        for g in panel:
            self.fill(g, [100.0] * 7 + [last_price], start="2026-11-07")
        fred = self.cpi("cpi_home", "CUSR0000SAH3", official)
        return next(c for c in build.build_categories(sites, self.hist, TODAY, fred, []) if c["key"] == "home")

    def test_store_move_many_times_the_official_one_is_never_high(self):
        # +2 % in 7 days is +8.99 % a month: compared with the official month only at that one pace
        home = self.home_with_store_move(102.0, 0.22)
        self.assertEqual(home["confidence"]["label"], "low", home["confidence"])
        self.assertIn("store +2.00% in 7 days, +8.99% a month; official +0.22% in 2026-10, 36 times apart",
                      home["confidence"]["reasons"])
        self.assertEqual(self.home_with_store_move(102.0, 9.0)["confidence"]["label"], "high", "one pace, within 1 point")
        self.assertEqual(self.home_with_store_move(102.0, 4.0)["confidence"]["label"], "medium", "same way, 2.2 times apart")
        self.assertEqual(self.home_with_store_move(98.0, 0.5)["confidence"]["label"], "low", "opposite ways")

    def test_a_printed_change_covers_one_period_never_a_blend(self):
        # red team on D6: "Home +10.21%" was 0.7 x a 7-day change + 0.3 x a monthly change
        home = self.home_with_store_move(102.0, 0.22)
        self.assertEqual((home["value"], home["basis"], home["period"]), (2.0, "platforms", "2026-11-07 to 2026-11-14"))
        self.assertEqual((home["official"]["mom"], home["official"]["period"]), (0.22, "2026-10"), "official keeps its own month")
        for cat in build.build_categories([], self.hist, TODAY, self.cpi(), []) + [home]:
            carried = [p for p in cat["parts"] if p["weight"]]
            self.assertLessEqual(len({p["period"] for p in carried}), 1, cat["key"])
            if carried:
                self.assertEqual((cat["value"], cat["period"]), (carried[0]["value"], carried[0]["period"]), cat["key"])

    def test_red_team_fixture_14_49_over_7_days_and_0_22_a_month_print_no_blend_and_read_low(self):
        home = self.home_with_store_move(114.49, 0.22)
        self.assertEqual((home["value"], home["basis"]), (14.49, "platforms"), "the 7-day change alone, never 10.21")
        self.assertNotEqual(home["value"], round(0.7 * 14.49 + 0.3 * 0.22, 2))
        self.assertEqual([p["kind"] for p in home["parts"]], ["platforms"])
        self.assertEqual(home["confidence"]["label"], "low")

    def test_method_text_states_the_rule_and_its_thresholds(self):
        cat = build.build_categories([], self.hist, TODAY, {}, [])[0]
        self.assertLessEqual(len(cat["method"]), 400, "the server cuts text at 400 characters")
        for words in ("both ends", "0.5 to 2", "under 10", "Never blended", "monthly rate", "within 1 point",
                      "under 3 times"):
            self.assertIn(words, cat["method"])

    def test_value_from_cpi_alone_carries_the_cpi_month_never_a_30_day_label(self):
        cat = next(c for c in build.build_categories([], self.hist, TODAY, self.cpi(), []) if c["key"] == "computers")
        self.assertEqual((cat["value"], cat["basis"], cat["period"]), (0.55, "official_mom", "2026-10"))
        self.assertEqual(cat["parts"][0]["measure"], "mom")

    def test_30_day_label_only_when_the_30_day_panel_holds(self):
        gids = ["g%d" % i for i in range(12)]
        for g in gids:
            for i in range(32):
                self.hist.put_price(g, build.shift_day("2026-10-14", i), 10 * (1 + 0.002 * i))
        cat = next(c for c in build.build_categories(cat_items(gids, "games"), self.hist, TODAY, {}, [])
                   if c["key"] == "games")
        self.assertEqual(cat["basis"], "platforms")
        self.assertEqual(cat["period"], "30 days to 2026-11-14")
        self.assertEqual(cat["parts"][0]["measure"], "change_30d")
        self.assertAlmostEqual(cat["value"], cat["platform_index"]["change_30d"])

    def test_category_without_any_part_is_null_not_zero(self):
        cat = next(c for c in build.build_categories([], self.hist, TODAY, {}, []) if c["key"] == "games")
        self.assertIsNone(cat["value"])
        self.assertIsNone(cat["basis"])
        self.assertIsNone(cat["period"])
        self.assertEqual(cat["parts"], [])


class WatchBestTests(unittest.TestCase):
    LABELS = {"newegg": "Newegg", "amazon": "Amazon"}

    def shop(self, query, best, by_site=None):
        return {"t": 1794783472, "watch": [{"slug": "w", "query": query, "category": "computer", "t": 1794783472,
                                            "by_site": by_site or [{"site": "newegg", "median": 3372.53, "min": 1949.99, "n": 11}],
                                            "best": best, "spark": []}]}

    def item(self, query, best, by_site=None):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            out = build.build_watches(self.shop(query, best, by_site), 1794783472, TODAY, self.LABELS)["items"][0]
        self.log = err.getvalue()
        return out

    def test_a_used_listing_never_fills_best(self):
        # D7: rtx 5090 "Best $1,949.99 at Newegg" was a used card; best is new only, the used one is best_used
        used = {"site": "newegg", "title": "GIGABYTE AORUS GeForce RTX 5090 32GB", "price": 1949.99,
                "url": "https://www.newegg.com/p/x", "condition": "used", "vs_median": None}
        w = self.item("rtx 5090", used)
        self.assertIsNone(w["best"])
        self.assertEqual(w["best_used"], {"price": 1949.99, "platform": "Newegg", "condition": "used",
                                          "title": "GIGABYTE AORUS GeForce RTX 5090 32GB", "url": "https://www.newegg.com/p/x"})
        self.assertEqual(w["best_reason"], "no new listing passed the price checks; the lowest is used")
        self.assertEqual(w["detail"]["by_platform"][0]["low"], 1949.99)
        self.assertIn('watch w: "GIGABYTE AORUS GeForce RTX 5090 32GB" at Newegg, $1949.99 is used, kept as best_used',
                      self.log, "a listing kept out of best is logged with its title")

    def test_a_new_listing_fills_best_with_its_title_and_condition(self):
        new = {"site": "amazon", "title": "Fire Blanket 40 x 40 in", "price": 12.95, "url": None, "condition": "new"}
        w = self.item("fire blanket", new)
        self.assertEqual(w["best"], {"price": 12.95, "platform": "Amazon", "condition": "new",
                                     "title": "Fire Blanket 40 x 40 in", "url": None})
        self.assertIsNone(w["best_used"])
        self.assertIsNone(w["best_reason"])

    def test_another_size_than_the_watch_names_is_not_a_match(self):
        oil = {"site": "amazon", "title": "Palestinian Extra Virgin Olive Oil - 250ml/8.45 Fl Oz", "price": 18.99,
               "url": None, "condition": "new"}
        w = self.item("palestinian olive oil 1 l", oil)
        self.assertIsNone(w["best"])
        self.assertIsNone(w["best_used"])
        self.assertEqual(w["best_reason"], 'the lowest listing, "Palestinian Extra Virgin Olive Oil - 250ml/8.45 Fl Oz" at'
                                           ' Amazon, $18.99, is another size than the watch names')
        self.assertIn("watch w: refused \"Palestinian Extra Virgin Olive Oil - 250ml/8.45 Fl Oz\"", self.log)
        self.assertEqual(self.item("palestinian olive oil 1 litre", dict(oil, title="Olive Oil (1L)"))["best"]["price"], 18.99)
        self.assertEqual(self.item("palestinian olive oil 1 l", dict(oil, title="Olive Oil tin"))["best"]["price"], 18.99,
                         "a title that states no size is kept")
        self.assertEqual(self.item("palestinian olive oil", oil)["best"]["price"], 18.99, "a query without a size refuses nothing")
        self.assertIsNotNone(self.item("canned water 12 pack", dict(oil, title="Hint Canned Water (12 pack)"))["best"])
        self.assertIsNone(self.item("canned water 12 pack", dict(oil, title="Canned Water, 24 Pack of 16 oz"))["best"])

    def test_no_listing_is_null_with_a_reason(self):
        w = self.item("dgx spark", None)
        self.assertEqual((w["best"], w["best_used"], w["best_reason"]), (None, None, "no listing passed the price checks"))


class MoveEvidenceTests(TmpHistory):
    """A change the evidence cannot carry is null with a reason: never printed, never capped."""
    T0 = 1794783472  # 2026-11-15 in PST

    def watch(self, chg7, by_site, groups=(), t=None):
        t = t or self.T0
        return {"t": t, "watch": [{"slug": "canned-water", "query": "canned water", "category": "grocery", "t": t,
                                   "chg7": chg7, "by_site": by_site, "groups": list(groups), "spark": [], "best": None}]}

    def item(self, shop, history=None):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            out = build.build_watches(shop, shop["t"], TODAY, {"amazon": "Amazon", "walmart": "Walmart"}, history=history)
        self.log = err.getvalue()
        return out["items"][0]

    def test_canned_water_186_percent_on_six_listings_is_not_printed(self):
        # live 2026-11-15 17:06: +185.8 % in 7 days from 5 two-day-old Amazon rows and 1 Walmart row
        w = self.item(self.watch(1.858, [{"site": "amazon", "median": 19.99, "min": 14.99, "n": 5},
                                         {"site": "walmart", "median": 39.99, "min": 39.99, "n": 1}]))
        self.assertIsNone(w["change_7d"])
        self.assertEqual(w["change_7d_reason"], "6 listings now; a change needs 10")
        self.assertIn("watch canned-water: 7-day change +185.8% not printed: 6 listings now", self.log)
        busy = [{"site": "walmart", "median": 30.0, "min": 12.5, "n": 40}]
        w = self.item(self.watch(1.858, busy))
        self.assertIsNone(w["change_7d"], "never capped to 50 %")
        self.assertEqual(w["change_7d_reason"], "moved +186% in 7 days, more than a median of asking prices can carry (50%)")
        self.assertEqual(self.item(self.watch(-0.143, busy))["change_7d"], -14.3, "a move the evidence carries prints")

    def test_a_changed_pack_or_too_few_listings_a_week_ago_hold_the_change(self):
        busy = [{"site": "walmart", "median": 30.0, "min": 12.5, "n": 40}]
        week_ago = self.T0 - 7 * 86400
        twelve = [{"title": "Hint Canned Water (12 pack)", "count": 30}]
        self.item(self.watch(0.0, busy, twelve, t=week_ago), self.hist)  # stores n 40 and pack 12 for 2026-11-08
        bulk = [{"title": "NEA Canned Spring Water, 16.9 Fl Oz, 72can-Pack", "count": 20},
                {"title": "Open Water Still Canned Water 24 pack", "count": 25}]
        w = self.item(self.watch(0.3, busy, bulk), self.hist)
        self.assertIsNone(w["change_7d"])
        self.assertEqual(w["change_7d_reason"], "the sample's typical pack count changed (12 to 24)")
        self.assertEqual(self.hist.get("watch_n", "canned-water"), {"2026-11-08": 40, "2026-11-15": 40})
        thin = History(str(Path(self.tmp.name) / "thin.json"))
        self.item(self.watch(0.0, [{"site": "walmart", "median": 30.0, "min": 12.5, "n": 4}], t=week_ago), thin)
        w = self.item(self.watch(0.1, busy), thin)
        self.assertEqual(w["change_7d_reason"], "4 listings 7 days ago; a change needs 10")

    def test_movers_leave_out_what_the_evidence_cannot_carry_and_count_it(self):
        self.hist.put_price("steam:1", "2026-11-07", 40.0, platforms_n=1)
        self.hist.put_price("steam:2", "2026-11-07", 10.0, platforms_n=2)  # two platforms then, one now
        self.hist.put_price("steam:3", "2026-11-07", 10.0, platforms_n=1)
        ps = products.build_products([offer(steam_appid="1", price=30.0), offer(steam_appid="2", price=6.0),
                                      offer(steam_appid="3", price=1.0)], self.hist, TODAY)
        shop = {"movers": [{"slug": "canned-water", "query": "canned water", "kind": "trend", "chg7": 1.858, "price": 29.99,
                            "site": None, "url": None},
                           {"slug": "fire-blanket", "query": "fire blanket", "kind": "drop", "chg7": -0.85, "price": 3.0,
                            "site": "walmart", "url": "https://www.walmart.com/ip/1"}]}
        dropped = {}
        rows = products.shop_mover_rows(shop, {}, TODAY, {}, {"canned-water": "trend mover: too few listings"}, dropped)
        rows = products.movers(ps, self.hist, TODAY, rows, dropped)
        self.assertEqual([(r["gid"], r["change_pct"]) for r in rows], [("steam:1", -25.0)])
        self.assertEqual(dropped, {"platform mix changed": 1, "beyond the bound": 2, "trend mover: too few listings": 1})

    def test_a_category_resting_on_the_official_month_says_so_and_has_no_score(self):
        cpi = {"cpi_apparel": {"source": "bls_cpi", "series": "CPIAPPSL", "label": "Consumer prices, apparel",
                               "value": 136.985, "period": "2026-10", "change": 0.08, "yoy": 1.0, "hist": []}}
        cat = next(c for c in build.build_categories([], self.hist, TODAY, cpi, []) if c["key"] == "apparel")
        self.assertEqual((cat["basis"], cat["confidence"]["score"], cat["confidence"]["label"]), ("official_mom", None, "official"))
        self.assertEqual(cat["confidence"]["reasons"][0], "official monthly figure; store prices too few to cross-check it")
        none = next(c for c in build.build_categories([], self.hist, TODAY, {}, []) if c["key"] == "games")
        self.assertEqual((none["confidence"]["score"], none["confidence"]["label"]), (None, None))


if __name__ == "__main__":
    unittest.main()
