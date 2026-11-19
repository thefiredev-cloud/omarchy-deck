"""Run every source, build the sections and write `ecom-market.json` atomically (mode 600).

Output dir: `--out-dir`, else `$DECK_FEED_DIR` (staging), else the live house-feeds dir. One run stays inside a time
budget (default 270 s): sources still waiting when it ends serve their cached copy or report the budget."""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import tempfile
import time

from . import build, products as prod
from . import sources_keyed as keyed
from . import sources_macro as macro
from . import sources_market as market
from .ctx import Ctx, NeedsKey, SourceUnavailable, short
from .history import History
from .registry import FRED_SOURCES, KEYED_SOURCES, LIVE_SOURCES, PAID_SOURCES, REFUSED_SOURCES, WATCH_CATEGORY
from .util import owner_date

LIVE_DIR = os.path.expanduser("~/.meshvault/status/house-feeds")
OUT_NAME = "ecom-market.json"
REFRESH = 3600

PHASE1 = dict({sid: macro.load_fred(sid) for sid in FRED_SOURCES}, **{
    "apple_chart": market.load_apple, "tranco": market.load_tranco, "google_trends": market.load_trends,
    "shopify_stores": market.load_shopify, "steam_store": market.load_steam, "reverb_api": market.load_reverb,
    "scryfall": market.load_scryfall, "drewry_wci": macro.load_drewry, "fedex_fuel": macro.load_fedex,
    "usps_prices": macro.load_usps, "port_la": macro.load_port_la, "federal_register": macro.load_fedreg,
    "shop_collector": market.load_shop, "bestbuy_api": keyed.load_bestbuy, "etsy_api": keyed.load_etsy,
    "census_api": keyed.load_census, "bls_api": keyed.load_bls, "cloudflare_radar": keyed.load_radar,
})


def run_source(sid, loader, now, deadline, force=False, quiet=False, environ=None, env_file=None, **kw):
    """-> result row {status, reason, as_of, count, data, note, checked_at, requests}. Never raises."""
    ctx = Ctx(sid, force=force, quiet=quiet, deadline=deadline, environ=environ, env_file=env_file)
    res = {"status": "error", "reason": None, "as_of": None, "count": 0, "data": None, "note": None,
           "checked_at": int(now)}
    try:
        out = loader(ctx, now, **kw)
        res.update(status="ok", as_of=out.get("as_of"), count=out.get("count") or 0, data=out.get("data"),
                   note=out.get("note"))
        stale = out.get("stale") or ctx.stale_reason
        if stale:
            res.update(status="stale", reason="served from cache: %s" % stale if ctx.stale_reason else stale)
    except NeedsKey as exc:
        res.update(status="needs_key", reason=str(exc), key_env=exc.envs)
    except SourceUnavailable as exc:
        res.update(reason=short(exc))
    except Exception as exc:  # noqa: BLE001 - one broken source never stops the feed
        res.update(reason="internal error: %s" % short(exc, 120))
    res["requests"] = ctx.requests
    ctx.log("%s %s%s" % (res["status"], res["count"], (" (%s)" % res["reason"]) if res["reason"] else ""))
    return res


def source_rows(results, shop, now):
    rows = []

    def add(sid, name, publisher, kind, group, homepage, key_env=None, **extra):
        r = results.get(sid) or {}
        rows.append(dict({"id": sid, "name": name, "publisher": publisher, "kind": kind, "group": group,
                          "status": r.get("status", "error"), "reason": r.get("reason"), "key_env": key_env,
                          "as_of": r.get("as_of"), "count": r.get("count", 0), "checked_at": r.get("checked_at"),
                          "homepage": homepage}, **extra))
    for sid, spec in FRED_SOURCES.items():
        add(sid, spec["name"], spec["publisher"], "official", "macro", spec["homepage"])
    for sid, (name, pub, kind, group, home) in LIVE_SOURCES.items():
        if sid == "shop_collector" and shop is not None:
            continue  # its lanes are listed one by one below
        add(sid, name, pub, kind, group, home)
    if shop is not None:
        stale = (results.get("shop_collector") or {}).get("status") == "stale"
        for s in (shop.get("coverage") or {}).get("sites") or []:
            site = s.get("site")
            if not site or site == "ebay":  # eBay is the Browse API row
                continue
            st, n = s.get("state") or s.get("status"), s.get("n_24h") or 0
            if st in ("blocked_by_site", "blocked"):
                status, reason = "refused", "Site walls automated reads; the collector backs off and never works around it"
            elif st in ("needs_keys", "never"):
                status, reason = "needs_key", s.get("human") or "needs keys"
            elif st == "ok" and n > 0 and not stale:
                status, reason = "ok", None
            else:
                status, reason = "stale", "no listings read in 24 h" if not stale else "shop collector feed is old"
            rows.append({"id": "shop_" + site, "name": "%s listings" % (s.get("label") or site),
                         "publisher": "%s (owner's shop collector, asking prices)" % (s.get("label") or site),
                         "kind": "collector", "group": "prices", "status": status, "reason": reason, "key_env": None,
                         "as_of": owner_date(s["last_ok"]).isoformat() if s.get("last_ok") else None,
                         "count": n, "checked_at": s.get("t") or results["shop_collector"]["checked_at"],
                         "homepage": None})
    for sid, (name, pub, kind, group, envs, home) in KEYED_SOURCES.items():
        add(sid, name, pub, kind, group, home, key_env=envs)
    for sid, (name, pub, reason, home) in REFUSED_SOURCES.items():
        rows.append({"id": sid, "name": name, "publisher": pub, "kind": "site", "group": "prices", "status": "refused",
                     "reason": reason, "key_env": None, "as_of": None, "count": 0, "checked_at": None, "homepage": home})
    for sid, (name, pub, price, home) in PAID_SOURCES.items():
        rows.append({"id": sid, "name": name, "publisher": pub, "kind": "paid", "group": "prices", "status": "refused",
                     "reason": "Paid service, not bought (%s)" % price, "key_env": None, "as_of": None, "count": 0,
                     "checked_at": None, "homepage": home, "price": price})
    return rows


def build_feed(results, history, now):
    today = owner_date(now).isoformat()
    shop = build._data(results, "shop_collector")
    shop_sites = {s.get("site"): s for s in ((shop or {}).get("coverage") or {}).get("sites") or []}
    labels = {k: (v.get("label") or k) for k, v in shop_sites.items()}
    status_of = lambda sid: (results.get(sid) or {}).get("status")  # noqa: E731

    macro_rows, fred_rows = build.build_macro(results, history)
    board = build.build_platforms(results, history, today, shop_sites, status_of)

    ebay = build._data(results, "ebay_browse") or {}
    watches = build.build_watches(shop, now, today, labels, ebay.get("watch"), build._data(results, "wikimedia"), history)
    build.record_watches(watches["items"], history)

    offers = []
    for sid in ("steam_store", "shopify_stores", "reverb_api", "scryfall", "bestbuy_api", "etsy_api"):
        offers += build._data(results, sid) or []
    offers += ebay.get("offers") or []
    products = prod.build_products(offers, history, today)
    slug_cat = {w.get("slug"): WATCH_CATEGORY.get(w.get("category"), w.get("category")) for w in (shop or {}).get("watch") or []}
    held = {w["slug"]: "trend mover: " + build.reason_class(w["change_7d_reason"])
            for w in watches["items"] if w.get("change_7d_reason")}
    dropped = {}
    shop_movers = prod.shop_mover_rows(shop, labels, today, slug_cat, held, dropped)
    movers = prod.movers(products, history, today, shop_movers, dropped)
    for w in watches["items"]:
        for days in (7, 30):
            why = w.get("change_%dd_reason" % days)
            if why:
                key = "watch %d-day change: %s" % (days, build.reason_class(why))
                dropped[key] = dropped.get(key, 0) + 1
    if dropped:
        print("ecom-market: moves not printed: %s" % ", ".join("%s %d" % kv for kv in sorted(dropped.items())),
              file=sys.stderr, flush=True)
    prod.record(products, history, today)
    categories = build.build_categories(products, history, today, fred_rows, watches["items"])
    best = prod.bestsellers(products)
    history.prune(today)

    sources = source_rows(results, shop, now)
    counts = {s: sum(1 for r in sources if r["status"] == s) for s in ("ok", "stale", "needs_key", "refused", "error")}
    coverage = dict(counts, sources_total=len(sources),
                    ok_keyless=sum(1 for r in sources if r["status"] == "ok" and not r["key_env"]),
                    paid=sum(1 for r in sources if r["kind"] == "paid"),
                    macro_series=sum(1 for r in macro_rows if r["value"] is not None),
                    platforms=len(board), platforms_priced=sum(1 for b in board if b["price_coverage"] == "ok"),
                    bestsellers=len(best), movers=len(movers), products_tracked=len(products),
                    merged_products=sum(1 for p in products if p["platforms_n"] >= 2),
                    categories=sum(1 for c in categories if c["value"] is not None or c["platform_index"]),
                    watches=len(watches["items"]))
    errors = [{"source": r["id"], "reason": r["reason"]} for r in sources if r["status"] in ("error", "stale") and r["reason"]]
    trending = build._data(results, "google_trends") or []
    coverage["trending"] = len(trending)
    coverage["trending_shopping"] = sum(1 for r in trending if r.get("shopping"))
    return {"v": 1, "t": int(time.time()), "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "refresh": REFRESH, "macro": macro_rows, "platforms": board, "bestsellers": best, "movers": movers,
            "categories": categories, "watches": watches, "trending": trending, "sources": sources,
            "coverage": coverage, "errors": errors}


def write_atomic(path, payload):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def collect(now=None, budget=270, force=False, quiet=False, workers=6, environ=None, env_file=None, only=None):
    now = now or time.time()
    deadline = now + budget
    results = {}
    jobs = {sid: fn for sid, fn in PHASE1.items() if not only or sid in only}
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(run_source, sid, fn, now, deadline, force, quiet, environ, env_file): sid for sid, fn in jobs.items()}
        for f in cf.as_completed(futs):
            results[futs[f]] = f.result()
    shop = build._data(results, "shop_collector")
    gtins = [o["gtin"] for o in (build._data(results, "bestbuy_api") or []) if o.get("gtin")]
    phase2 = {"wikimedia": (market.load_wikimedia, {"shop": shop}),
              "ebay_browse": (keyed.load_ebay, {"shop": shop, "gtins": gtins})}
    for sid, (fn, kw) in phase2.items():
        if not only or sid in only:
            results[sid] = run_source(sid, fn, now, deadline, force, quiet, environ, env_file, **kw)
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description="Write the Deck e-commerce market feed (ecom-market.json).")
    ap.add_argument("--out", "--out-dir", dest="out_dir", default=os.environ.get("DECK_FEED_DIR") or LIVE_DIR,
                    help="output dir (default $DECK_FEED_DIR, else the live house-feeds dir)")
    ap.add_argument("--state", default=None, help="history file (default $DECK_ECOM_STATE or ~/.local/state/deck-ecom-market)")
    ap.add_argument("--budget", type=int, default=270, help="seconds for the whole run")
    ap.add_argument("--force", action="store_true", help="ignore cache ages (conditional requests still apply)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    out_dir = os.path.abspath(os.path.expanduser(args.out_dir))
    history = History(args.state)
    # first line, before any work: where this run writes (staged runs check it before trusting the run)
    print("ecom-market: output dir %s; state %s" % (out_dir, history.path), flush=True)
    t0 = time.time()
    results = collect(budget=args.budget, force=args.force, quiet=args.quiet)
    feed = build_feed(results, history, t0)
    history.save()
    path = os.path.join(out_dir, OUT_NAME)
    write_atomic(path, feed)
    c = feed["coverage"]
    print("ecom-market: %s in %.0f s; sources ok %d (keyless %d), stale %d, needs_key %d, refused %d (paid %d), error %d; "
          "macro %d, platforms %d (priced %d), bestsellers %d, movers %d, categories %d, watches %d"
          % (path, time.time() - t0, c["ok"], c["ok_keyless"], c["stale"], c["needs_key"], c["refused"], c["paid"],
             c["error"], c["macro_series"], c["platforms"], c["platforms_priced"], c["bestsellers"], c["movers"],
             c["categories"], c["watches"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
