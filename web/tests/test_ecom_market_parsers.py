"""deck-feed-ecom-market parsers against real excerpts of each publisher's answer (saved 2026-11-14 under
tests/fixtures/ecom_market/). No network. Run: python3 -m unittest discover -s tests"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from ecom_market import sources_macro as sm  # noqa: E402
from ecom_market import sources_market as sk  # noqa: E402
from ecom_market.ctx import SourceUnavailable  # noqa: E402

FX = ROOT / "tests" / "fixtures" / "ecom_market"


def raw(name):
    return (FX / name).read_bytes()


def text(name):
    return (FX / name).read_text(encoding="utf8")


def js(name):
    return json.loads(text(name))


class FredTests(unittest.TestCase):
    def test_single_frequency_csv_reads_every_series(self):
        got = sm.parse_fredgraph(raw("fred_bls_cpi.csv"))
        self.assertEqual(len(got), 9)
        self.assertEqual(got["CUSR0000SACL1E"][-1], ("2026-10-01", 168.631))
        self.assertEqual(got["CUSR0000SEEE01"][-2], ("2026-09-01", 38.549))

    def test_mixed_frequencies_arrive_as_a_zip_and_each_member_is_read(self):
        got = sm.parse_fredgraph(raw("fred_mixed.zip"))
        self.assertEqual(got["ECOMPCTSA"][-1], ("2026-04-01", 17.1))
        self.assertEqual(got["RSXFS"][-1], ("2026-09-01", 652115.0))
        self.assertEqual(got["GASDESW"][-1], ("2026-11-09", 6.127))

    def test_quarterly_percent_row_uses_points_and_quarter_periods(self):
        pts = sm.parse_fredgraph(raw("fred_mixed.zip"))["ECOMPCTSA"]
        row = sm.series_row("ecom_share", "Online share of retail", "demand", "pct", "quarterly", pts, "census_ecom")
        self.assertEqual((row["value"], row["period"]), (17.1, "2026-Q2"))
        self.assertEqual(row["change_unit"], "pct_pts")
        self.assertEqual(row["prior"]["period"], "2026-Q1")
        self.assertEqual(row["yoy_unit"], "pct_pts")
        self.assertLessEqual(len(row["hist"]), 36)
        self.assertEqual(row["hist"][-1], ["2026-Q2", 17.1])

    def test_a_missing_year_ago_month_is_null_never_zero(self):
        # BLS published no October 2025 CPI; the year-over-year change must stay unknown
        pts = sm.parse_fredgraph(raw("fred_bls_cpi.csv"))["CUSR0000SACL1E"]
        row = sm.series_row("cpi_core_goods", "Goods prices, core", "prices", "index", "monthly", pts, "bls_cpi")
        self.assertEqual(row["period"], "2026-10")
        self.assertIsNone(row["yoy"])
        self.assertAlmostEqual(row["change"], round((168.631 / 168.361 - 1) * 100, 2))

    def test_weekly_year_ago_uses_the_nearest_week(self):
        pts = sm.parse_fredgraph(raw("fred_mixed.zip"))["GASDESW"]
        row = sm.series_row("diesel", "Diesel price", "freight", "usd_gal", "weekly", pts, "eia_diesel")
        self.assertEqual(row["period"], "2026-11-09")
        self.assertIsNotNone(row["yoy"])

    def test_an_html_error_page_is_not_a_table(self):
        with self.assertRaises(SourceUnavailable):
            sm.parse_fredgraph(b"<html><body>Service unavailable</body></html>")


class PageTests(unittest.TestCase):
    def test_drewry_composite_and_lanes_with_signed_changes(self):
        d = sm.parse_drewry(text("drewry_wci.html"))
        self.assertEqual(d["as_of"], "2026-11-12")
        self.assertEqual(d["wci"], {"value": 4305.0, "change_pct": -2.0})
        self.assertEqual(d["sha_la"], {"value": 7416.0, "change_pct": -2.0})
        self.assertEqual(d["sha_ny"], {"value": 9020.0, "change_pct": -3.0})

    def test_fedex_table_newest_week_first(self):
        weeks = sm.parse_fedex(text("fedex_fuel.html"))
        self.assertEqual(weeks[0], {"week": "2026-11-16", "ground": 30.0, "express": 32.0})
        self.assertEqual(weeks[1]["ground"], 30.5)

    def test_usps_flat_rate_prices_and_effective_date(self):
        d = sm.parse_usps(text("usps_notice123.html"))
        self.assertEqual(d["as_of"], "2026-10-04")
        self.assertEqual(d["prices"], {"usps_priority_env": 13.9, "usps_small_box": 14.65,
                                       "usps_medium_box": 25.8, "usps_large_box": 36.1})

    def test_port_la_month_total_and_imports(self):
        d = sm.parse_port_la(text("port_la.html"))
        self.assertEqual(d["as_of"], "2026-10")
        self.assertEqual(d["total"]["value"], 1026871.65)
        self.assertEqual(d["total"]["change_pct"], 21.03)
        self.assertEqual(d["imports"]["change_pct"], 25.47)

    def test_federal_register_count_and_latest(self):
        d = sm.parse_fedreg(js("fedreg_trade.json"))
        self.assertEqual(d["count"], 17)
        self.assertEqual(d["latest"]["date"], "2026-11-10")

    def test_changed_layouts_raise_instead_of_returning_junk(self):
        for fn in (sm.parse_drewry, sm.parse_fedex, sm.parse_usps, sm.parse_port_la):
            with self.assertRaises(SourceUnavailable, msg=fn.__name__):
                fn("<html><body><p>We moved this page.</p></body></html>")


class RankAndInterestTests(unittest.TestCase):
    def test_app_store_chart_ranks_by_app_id(self):
        d = sk.parse_apple(js("apple_shopping.json"))
        self.assertEqual(d["ranks"]["338137227"], 2)  # Walmart
        self.assertEqual(d["ranks"]["297606951"], 7)  # Amazon Shopping
        self.assertEqual(d["as_of"], "2026-11-14")

    def test_a_short_chart_is_refused(self):
        body = js("apple_shopping.json")
        body["feed"]["entry"] = body["feed"]["entry"][:3]
        with self.assertRaises(SourceUnavailable):
            sk.parse_apple(body)

    def test_tranco_ranks_only_the_asked_domains(self):
        ranks, rows = sk.parse_tranco(str(FX / "tranco_top2000.csv.zip"), ["amazon.com", "ebay.com", "nope.example"])
        self.assertEqual(ranks, {"amazon.com": 29, "ebay.com": 198})
        self.assertEqual(rows, 2000)

    def test_tranco_broken_zip_raises(self):
        bad = FX / "trends_us.xml"
        with self.assertRaises(SourceUnavailable):
            sk.parse_tranco(str(bad), ["amazon.com"])

    def test_trends_rss_items(self):
        items = sk.parse_trends_rss(text("trends_us.xml"))
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["rank"], 1)
        self.assertEqual(items[0]["traffic"], "1000+")
        # the real 2026-11-14 rows are sports and markets searches: none is shopping
        self.assertEqual([(i["title"], i["shopping"], i["shopping_match"]) for i in items],
                         [("north texas vs utsa", False, None), ("sharks vs mammoth", False, None), ("vix", False, None)])

    def test_shopping_rule_matches_whole_words_and_never_guesses(self):
        self.assertEqual(sk.shopping_match("Black Friday deals 2026"), "black friday")
        self.assertEqual(sk.shopping_match("Costco hours"), "costco")
        self.assertEqual(sk.shopping_match("Lowe’s sale"), "lowe's")
        self.assertIsNone(sk.shopping_match("us china trade deal"), "deal alone is not shopping")
        self.assertIsNone(sk.shopping_match("target field weather"), "everyday store words are left out")
        self.assertIsNone(sk.shopping_match("amazonian rainforest"), "whole words only")

    def test_wikipedia_monthly_views(self):
        pts = sk.parse_pageviews(js("wiki_pageviews.json"))
        self.assertEqual(pts[-1], ("2026-10", 735))
        self.assertTrue(all(len(p[0]) == 7 for p in pts))


class CatalogTests(unittest.TestCase):
    def test_shopify_lowest_available_variant_and_compare_at(self):
        offers = sk.parse_shopify(js("shopify_tentree_products.json"), "www.tentree.com", "Tentree", "apparel", "2026-11-14")
        titles = [o["title"] for o in offers]
        self.assertEqual(offers[0]["price"], 58.8)
        self.assertEqual(offers[0]["regular"], 98.0)
        self.assertNotIn("Seaforestation Logo T-Shirt", titles, "a product with no available variant is not for sale")
        self.assertTrue(offers[0]["ext_id"].startswith("shopify:www.tentree.com:"))
        self.assertIsNone(offers[0]["rank"])

    def test_shopify_best_seller_collection_keeps_its_order(self):
        offers = sk.parse_shopify(js("shopify_tentree_best.json"), "www.tentree.com", "Tentree", "apparel", "2026-11-14",
                                  ranked=True)
        self.assertEqual([(o["title"], o["rank"]) for o in offers[:2]],
                         [("Atlas Sweatpant", 1), ("Quilted Colville Overshirt", 2)])

    def test_steam_search_rows_with_sale_price(self):
        rows = sk.parse_steam_search(js("steam_topsellers.json"))
        self.assertEqual(rows[0], {"appid": "2406770", "title": "Bodycam", "price": 26.65, "regular": 33.32,
                                   "discount_pct": 20, "url": "https://store.steampowered.com/app/2406770"})
        self.assertIsNone(rows[1]["regular"])

    def test_reverb_median_skips_accessories_and_bundles(self):
        med, n = sk.parse_reverb(js("reverb_yamaha_p45.json"), "Yamaha", "P-45")
        self.assertEqual((med, n), (449.99, 8))

    def test_scryfall_prices_and_catalog_ids(self):
        offers = sk.parse_scryfall(js("scryfall_edhrec.json"), "2026-11-14")
        self.assertEqual((offers[0]["title"], offers[0]["price"]), ("Sol Ring", 0.91))
        self.assertTrue(offers[0]["ext_id"].startswith("scryfall:"))

    def test_shop_feed_older_than_two_refreshes_is_stale(self):
        body = js("shop_ecom.json")
        out = sk.load_shop(None, body["t"] + 3 * 3600, path=str(FX / "shop_ecom.json"))
        self.assertIn("stale", out)
        fresh = sk.load_shop(None, body["t"] + 600, path=str(FX / "shop_ecom.json"))
        self.assertNotIn("stale", fresh)
        self.assertEqual(fresh["count"], 2)


if __name__ == "__main__":
    unittest.main()
