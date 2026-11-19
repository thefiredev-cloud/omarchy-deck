"""deck-feed-ecom-market source states (ok, stale, needs_key, refused, error), the key-gated parsers against the
APIs' documented examples, and the assembled feed file. No network: key-gated loaders must stop before any request,
and the stale test points at a closed local port. Run: python3 -m unittest discover -s tests"""
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from ecom_market import run, sources_keyed as keyed, sources_market as sk  # noqa: E402
from ecom_market.ctx import Ctx, SourceUnavailable, read_env_file  # noqa: E402
from ecom_market.history import History  # noqa: E402
from ecom_market.registry import KEYED_SOURCES, PAID_SOURCES, REFUSED_SOURCES  # noqa: E402

FX = ROOT / "tests" / "fixtures" / "ecom_market"
NOW = 1794720000


class KeyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env_file = str(Path(self.tmp.name) / "env")

    def test_every_key_gated_source_reports_needs_key_and_sends_nothing(self):
        loaders = {"bestbuy_api": keyed.load_bestbuy, "etsy_api": keyed.load_etsy, "census_api": keyed.load_census,
                   "bls_api": keyed.load_bls, "cloudflare_radar": keyed.load_radar, "ebay_browse": keyed.load_ebay}
        self.assertEqual(set(loaders), set(KEYED_SOURCES))
        for sid, fn in loaders.items():
            res = run.run_source(sid, fn, NOW, None, quiet=True, environ={}, env_file=self.env_file)
            self.assertEqual(res["status"], "needs_key", sid)
            self.assertEqual(res["key_env"], KEYED_SOURCES[sid][4], sid)
            self.assertEqual(res["requests"], 0, "%s must not call the network without its key" % sid)
            for env in KEYED_SOURCES[sid][4]:
                self.assertIn(env, res["reason"])

    def test_keys_come_from_the_owner_env_file_and_values_never_reach_the_result(self):
        Path(self.env_file).write_text("export EBAY_CLIENT_ID='id-SECRET-1'\nEBAY_CLIENT_SECRET=sec-SECRET-2\n")
        self.assertEqual(read_env_file(self.env_file)["EBAY_CLIENT_ID"], "id-SECRET-1")
        ctx = Ctx("t", quiet=True, environ={}, env_file=self.env_file, cache_root=self.tmp.name)
        self.assertEqual(ctx.need_key("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"), ["id-SECRET-1", "sec-SECRET-2"])
        res = run.run_source("bestbuy_api", keyed.load_bestbuy, NOW, None, quiet=True, environ={}, env_file=self.env_file)
        self.assertNotIn("SECRET", json.dumps(res))

    def test_one_missing_key_of_a_pair_names_only_that_one(self):
        ctx = Ctx("t", quiet=True, environ={"EBAY_CLIENT_ID": "x"}, env_file=self.env_file, cache_root=self.tmp.name)
        with self.assertRaises(SourceUnavailable) as cm:
            ctx.need_key("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET")
        self.assertEqual(str(cm.exception), "needs EBAY_CLIENT_SECRET")


class StateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_a_failed_refresh_serves_the_cached_copy_as_stale(self):
        url = "http://127.0.0.1:9/feed.json"  # discard port: nothing listens
        ctx = Ctx("t", quiet=True, cache_root=self.tmp.name)
        os.makedirs(ctx.cache_dir)
        Path(ctx.cache_dir, "f.json").write_text('{"ok": 1, "pad": "xxxxxxxx"}')
        Path(ctx.cache_dir, "f.json.meta.json").write_text(json.dumps({"url": url, "checked_at": 1}))
        self.assertEqual(ctx.get_json(url, "f.json")["ok"], 1)
        self.assertIsNotNone(ctx.stale_reason)

        def loader(c, now):
            c.cache_dir = ctx.cache_dir
            return {"as_of": "2026-11-14", "count": 1, "data": c.get_json(url, "f.json")}
        res = run.run_source("t", loader, NOW, None, quiet=True)
        self.assertEqual(res["status"], "stale")
        self.assertTrue(res["reason"].startswith("served from cache"))

    def test_no_copy_and_no_answer_is_an_error_with_a_reason(self):
        def loader(c, now):
            c.cache_dir = self.tmp.name
            return c.get_json("http://127.0.0.1:9/x.json", "x.json")
        res = run.run_source("t", loader, NOW, None, quiet=True)
        self.assertEqual(res["status"], "error")
        self.assertIn("127.0.0.1", res["reason"])

    def test_a_crashing_source_never_stops_the_feed(self):
        def loader(c, now):
            raise KeyError("boom")
        res = run.run_source("t", loader, NOW, None, quiet=True)
        self.assertEqual((res["status"], res["reason"]), ("error", "internal error: 'boom'"))

    def test_refused_and_paid_sources_are_listed_but_never_called(self):
        rows = {r["id"]: r for r in run.source_rows({}, None, NOW)}
        for sid in REFUSED_SOURCES:
            self.assertEqual(rows[sid]["status"], "refused")
            self.assertTrue(rows[sid]["reason"])
            self.assertNotIn(sid, run.PHASE1)
        for sid, (_, _, price, _) in PAID_SOURCES.items():
            self.assertEqual((rows[sid]["status"], rows[sid]["kind"], rows[sid]["price"]), ("refused", "paid", price))
            self.assertNotIn(sid, run.PHASE1)


class KeyedParserTests(unittest.TestCase):
    """Shapes from each API's documentation (no key exists yet to capture a live answer)."""

    def test_ebay_item_summaries(self):
        body = {"total": 2, "itemSummaries": [
            {"itemId": "v1|1|0", "title": "Shure SM58", "price": {"value": "89.00", "currency": "USD"},
             "condition": "New", "itemWebUrl": "https://www.ebay.com/itm/1"},
            {"itemId": "v1|2|0", "title": "SM58 GBP", "price": {"value": "70.00", "currency": "GBP"}}]}
        rows = keyed.parse_ebay_search(body)
        self.assertEqual([(r["price"], r["condition"]) for r in rows], [(89.0, "New")])
        with self.assertRaises(SourceUnavailable):
            keyed.parse_ebay_search({"errors": [{"errorId": 1001}]})

    def test_bestbuy_products_rank_by_position_and_upc_identity(self):
        body = {"products": [{"sku": 6505727, "name": "Shure SM58", "upc": "042406054324", "salePrice": 89.99,
                              "regularPrice": 99.99, "manufacturer": "Shure", "modelNumber": "SM58-LC",
                              "url": "https://api.bestbuy.com/click/-/6505727/pdp"}]}
        o = keyed.parse_bestbuy(body, "electronics", "2026-11-14")[0]
        self.assertEqual((o["rank"], o["price"], o["regular"], o["gtin"]), (1, 89.99, 99.99, "00042406054324"))

    def test_etsy_price_divisor(self):
        body = {"count": 2, "results": [{"price": {"amount": 2500, "divisor": 100, "currency_code": "USD"}},
                                        {"price": {"amount": 1999, "divisor": 100, "currency_code": "EUR"}}]}
        self.assertEqual(keyed.parse_etsy(body), [25.0])

    def test_census_marts_table(self):
        body = [["cell_value", "data_type_code", "category_code", "seasonally_adj", "time", "us"],
                ["124283", "SM", "454", "yes", "2026-09", "1"], ["123925", "SM", "454", "yes", "2026-08", "1"]]
        self.assertEqual(keyed.parse_census_marts(body), [("2026-08-01", 123925.0), ("2026-09-01", 124283.0)])

    def test_bls_v2_skips_annual_averages(self):
        body = {"status": "REQUEST_SUCCEEDED", "Results": {"series": [{"seriesID": "APU0000708111", "data": [
            {"year": "2026", "period": "M10", "value": "3.12"}, {"year": "2025", "period": "M13", "value": "4.00"}]}]}}
        self.assertEqual(keyed.parse_bls(body), {"APU0000708111": [("2026-10-01", 3.12)]})
        with self.assertRaises(SourceUnavailable):
            keyed.parse_bls({"status": "REQUEST_NOT_PROCESSED", "message": ["daily threshold"]})

    def test_radar_domain_rank(self):
        self.assertEqual(keyed.parse_radar({"success": True, "result": {"details_0": {"rank": 12}}}), 12)


class FeedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def results(self):
        shop = json.loads((FX / "shop_ecom.json").read_text())
        now = shop["t"] + 600
        ok = lambda data, as_of="2026-11-14": {"status": "ok", "data": data, "as_of": as_of, "count": 1,  # noqa: E731
                                              "checked_at": now, "reason": None}
        steam = [{"platform": "Steam", "site": "steam", "title": "Bodycam", "steam_appid": "1", "ext_id": "steam:1",
                  "price": 26.65, "regular": 33.32, "rank": 1, "url": None, "category": "games",
                  "source": "steam_store", "as_of": "2026-11-14"}]
        res = {"shop_collector": ok(shop), "steam_store": ok(steam),
               "apple_chart": ok(sk.parse_apple(json.loads((FX / "apple_shopping.json").read_text()))),
               "tranco": ok({"as_of": "2026-11-14", "ranks": {"amazon.com": 29, "walmart.com": 482}}),
               "ebay_browse": {"status": "needs_key", "reason": "needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET",
                               "key_env": ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"], "checked_at": now, "count": 0}}
        return res, now

    def test_feed_has_every_section_counts_and_periods(self):
        res, now = self.results()
        feed = run.build_feed(res, History(str(Path(self.tmp.name) / "h.json")), now)
        for key in ("v", "t", "generated_at", "refresh", "macro", "platforms", "bestsellers", "movers", "categories",
                    "watches", "trending", "sources", "coverage", "errors"):
            self.assertIn(key, feed)
        c = feed["coverage"]
        self.assertEqual(c["sources_total"], len(feed["sources"]))
        self.assertEqual(c["ok"] + c["stale"] + c["needs_key"] + c["refused"] + c["error"], c["sources_total"])
        self.assertGreaterEqual(c["needs_key"], 1)
        board = {b["name"]: b for b in feed["platforms"]}
        self.assertEqual(board["Walmart"]["price_coverage"], "ok")
        self.assertEqual(board["Amazon"]["price_coverage"], "blocked")
        self.assertEqual(board["eBay"]["price_coverage"], "needs_key")
        self.assertEqual(board["Walmart"]["signals"]["app_rank"], 2)
        self.assertEqual(feed["bestsellers"][0]["gid"], "steam:1")
        self.assertTrue(any(m["kind"] == "on_sale" for m in feed["movers"]))
        w = feed["watches"]["items"][0]
        self.assertEqual(w["slug"], "rtx-4080")
        self.assertEqual(w["sites_ok"], len(w["detail"]["by_platform"]))
        self.assertTrue(w["period"].endswith("2026-11-14"))
        lanes = {r["id"]: r for r in feed["sources"] if r["id"].startswith("shop_")}
        self.assertEqual(lanes["shop_amazon"]["status"], "refused")
        self.assertNotIn("shop_ebay", lanes, "eBay is reported once, as the Browse API row")

    def test_first_line_names_the_output_dir_and_the_file_lands_there(self):
        out, state = Path(self.tmp.name) / "staged", Path(self.tmp.name) / "state" / "h.json"
        buf = StringIO()
        with mock.patch.object(run, "collect", return_value={}), redirect_stdout(buf):
            self.assertEqual(run.main(["--out", str(out), "--state", str(state), "--quiet"]), 0)
        first = buf.getvalue().splitlines()[0]
        self.assertEqual(first, "ecom-market: output dir %s; state %s" % (out, state))
        self.assertTrue((out / "ecom-market.json").is_file())

    def test_write_is_atomic_and_private(self):
        path = Path(self.tmp.name) / "out" / "ecom-market.json"
        run.write_atomic(str(path), {"v": 1})
        self.assertEqual(json.loads(path.read_text()), {"v": 1})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual([p.name for p in path.parent.iterdir()], ["ecom-market.json"])

    def test_history_round_trip_and_prune(self):
        h = History(str(Path(self.tmp.name) / "s" / "h.json"))
        h.put_price("g", "2026-09-01", 5.0)
        h.put_price("g", "2026-11-13", 6.0)
        h.prune("2026-11-14")
        h.save()
        again = History(h.path)
        self.assertEqual(again.price_days("g"), {"2026-11-13": 6.0})
        self.assertEqual(stat.S_IMODE(os.stat(h.path).st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
