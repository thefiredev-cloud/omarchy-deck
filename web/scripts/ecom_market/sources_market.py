"""Market sources with no key: rank lists (App Store chart, Tranco), interest (Google Trends RSS, Wikipedia views),
public catalogs (Shopify stores, Reverb, Scryfall) and the owner's shop collector feed.

Product sources return offers: {platform, site, title, brand, model, gtin, ext_id, price, regular, rank, url,
category, source, as_of}. Parsers are pure and raise SourceUnavailable on a broken body."""
import csv
import datetime as dt
import email.utils
import io
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

from .ctx import SourceUnavailable
from .registry import PLATFORMS, REVERB_MODELS, SHOPIFY_BEST_HANDLES, SHOPIFY_STORES, WATCH_WIKI
from .util import median, num, owner_date

SHOP_FEED = os.path.expanduser(os.environ.get("DECK_SHOP_FEED", "~/.kodros/status/house-feeds/ecom.json"))


def _day(now):
    return owner_date(now).isoformat()


# ---------------------------------------------------------------- App Store top free shopping chart
def parse_apple(body):
    """iTunes RSS JSON -> {"as_of": "2026-11-14", "ranks": {app_id: rank}, "names": {app_id: name}}."""
    try:
        feed = body["feed"]
        entries = feed["entry"]
    except (KeyError, TypeError):
        raise SourceUnavailable("App Store chart answered no entries")
    if isinstance(entries, dict):
        entries = [entries]
    ranks, names = {}, {}
    for i, e in enumerate(entries, 1):
        aid = ((e.get("id") or {}).get("attributes") or {}).get("im:id")
        if aid:
            ranks[aid] = i
            names[aid] = ((e.get("im:name") or {}).get("label") or "")[:80]
    if len(ranks) < 10:
        raise SourceUnavailable("App Store chart had %d apps" % len(ranks))
    updated = ((feed.get("updated") or {}).get("label") or "")[:10] or None
    return {"as_of": updated, "ranks": ranks, "names": names}


def load_apple(ctx, now):
    url = "https://itunes.apple.com/us/rss/topfreeapplications/limit=100/genre=6024/json"
    data = parse_apple(ctx.get_json(url, "top-free-shopping.json", min_age=50 * 60))
    return {"as_of": data["as_of"] or _day(now), "count": len(data["ranks"]), "data": data}


# ---------------------------------------------------------------- Tranco
def parse_tranco(path, domains):
    """Ranks of `domains` from the Tranco top-1m zip (rank,domain rows), streamed; stops once all are found."""
    want = set(domains)
    found, rows = {}, 0
    try:
        with zipfile.ZipFile(path) as zf:
            with zf.open(zf.namelist()[0]) as fh:
                for row in csv.reader(io.TextIOWrapper(fh, encoding="utf8", errors="replace")):
                    rows += 1
                    if len(row) >= 2 and row[1] in want:
                        found[row[1]] = int(row[0])
                        if len(found) == len(want):
                            break
    except (zipfile.BadZipFile, OSError, ValueError, IndexError) as exc:
        raise SourceUnavailable("Tranco list unreadable (%s)" % str(exc)[:80])
    if rows < 1000 and len(found) < len(want):
        raise SourceUnavailable("Tranco list too short (%d rows)" % rows)
    return found, rows


def load_tranco(ctx, now):
    domains = [p[1] for p in PLATFORMS if p[1]]
    path, meta = ctx.fetch("https://tranco-list.eu/top-1m.csv.zip", "top-1m.csv.zip", min_age=20 * 3600,
                           timeout=120, min_bytes=100000)
    ranks, rows = parse_tranco(path, domains)
    as_of = None
    if meta.get("last_modified"):
        try:
            as_of = email.utils.parsedate_to_datetime(meta["last_modified"]).date().isoformat()
        except (TypeError, ValueError):
            as_of = None
    as_of = as_of or owner_date(meta.get("checked_at") or now).isoformat()
    return {"as_of": as_of, "count": rows, "data": {"as_of": as_of, "ranks": ranks}}


# ---------------------------------------------------------------- Google Trends RSS
HT = "{https://trends.google.com/trending/rss}"

# A trending search is shopping when its title contains one of these as whole words (case-insensitive): shopping
# events and deal words, or a store name that is not also an everyday word ("target" and "shop" are left out).
# Anything else stays false: no guessing. "deal" alone is out ("trade deal"); so is "sales" ("home sales").
SHOPPING_TERMS = (
    "black friday", "cyber monday", "prime day", "prime big deal days", "deals", "sale", "coupon", "coupons",
    "promo code", "discount", "clearance", "restock", "preorder", "pre-order", "price drop", "gift guide",
    "doorbuster", "doorbusters", "amazon", "walmart", "costco", "best buy", "ebay", "etsy", "temu", "shein",
    "aliexpress", "home depot", "lowe's", "wayfair", "macy's", "kohl's", "sam's club", "dollar general", "ikea",
    "sephora", "ulta", "shopify", "tiktok shop", "newegg", "gamestop", "chewy", "poshmark", "offerup", "whatnot",
)
_SHOP_RE = re.compile(r"\b(%s)\b" % "|".join(re.escape(t) for t in sorted(SHOPPING_TERMS, key=len, reverse=True)), re.I)


def shopping_match(title):
    """The shopping term a trending title names, or None."""
    m = _SHOP_RE.search((title or "").replace("’", "'"))
    return m.group(1).lower() if m else None


def parse_trends_rss(text):
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise SourceUnavailable("Trends RSS unreadable (%s)" % str(exc)[:60])
    items = []
    for i, it in enumerate(root.iter("item"), 1):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        pub = it.findtext("pubDate")
        try:
            as_of = email.utils.parsedate_to_datetime(pub).isoformat() if pub else None
        except (TypeError, ValueError):
            as_of = None
        match = shopping_match(title)
        items.append({"rank": i, "title": title[:120], "traffic": (it.findtext(HT + "approx_traffic") or None),
                      "as_of": as_of, "shopping": match is not None, "shopping_match": match})
    if not items:
        raise SourceUnavailable("Trends RSS had no items")
    return items[:20]


def load_trends(ctx, now):
    text, _ = ctx.get_text("https://trends.google.com/trending/rss?geo=US", "trending-us.xml", min_age=50 * 60)
    items = parse_trends_rss(text)
    return {"as_of": (items[0]["as_of"] or "")[:10] or _day(now), "count": len(items), "data": items}


# ---------------------------------------------------------------- Wikipedia monthly views
def parse_pageviews(body):
    """-> [(YYYY-MM, views), ...] oldest first."""
    out = []
    for it in (body or {}).get("items") or []:
        ts, views = str(it.get("timestamp") or ""), it.get("views")
        if len(ts) >= 6 and isinstance(views, int):
            out.append(("%s-%s" % (ts[:4], ts[4:6]), views))
    return out


def load_wikimedia(ctx, now, shop=None):
    articles = {}
    for w in (shop or {}).get("watch") or []:
        art = w.get("wiki_title") or WATCH_WIKI.get(w.get("slug"))
        if art:
            articles[art] = True
    if not articles:
        articles = {a: True for a in sorted(set(WATCH_WIKI.values()))}
    first = owner_date(now).replace(day=1)
    start = (first - dt.timedelta(days=400)).replace(day=1).strftime("%Y%m%d")
    end = (first - dt.timedelta(days=1)).strftime("%Y%m%d")  # last full month only: a partial month reads as a crash
    out, fails = {}, []
    for art in sorted(articles):
        url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/%s/monthly/%s/%s"
               % (urllib.parse.quote(art, safe=""), start, end))
        try:
            pts = parse_pageviews(ctx.get_json(url, "pv-%s.json" % art, min_age=20 * 3600))
        except SourceUnavailable as exc:
            fails.append("%s: %s" % (art, exc))
            continue
        if pts:
            out[art] = pts
    if not out:
        raise SourceUnavailable("no article answered (%s)" % "; ".join(fails)[:160])
    as_of = max(p[-1][0] for p in out.values())
    return {"as_of": as_of, "count": sum(len(p) for p in out.values()), "data": out,
            "note": ("%d articles missing" % len(fails)) if fails else None}


# ---------------------------------------------------------------- Shopify store catalogs
def parse_shopify(body, host, brand, category, as_of, ranked=False):
    """products.json -> offers. Price = lowest available variant; regular = its compare_at_price when higher."""
    if not isinstance(body, dict) or not isinstance(body.get("products"), list):
        raise SourceUnavailable("%s answered no products list" % host)
    offers = []
    for i, p in enumerate(body["products"], 1):
        best = None
        for v in p.get("variants") or []:
            price = num(v.get("price"))
            if price is None or price <= 0 or v.get("available") is False:
                continue
            if best is None or price < best[0]:
                best = (price, num(v.get("compare_at_price")))
        if best is None:
            continue
        price, regular = best
        offers.append({"platform": brand, "site": host, "title": (p.get("title") or "")[:160],
                       "brand": (p.get("vendor") or brand)[:60], "model": None, "gtin": None,
                       "ext_id": "shopify:%s:%s" % (host, p.get("id")), "price": price,
                       "regular": regular if regular and regular > price else None,
                       "rank": i if ranked else None, "url": "https://%s/products/%s" % (host, p.get("handle") or ""),
                       "category": category, "source": "shopify_stores", "as_of": as_of})
    return offers


def load_shopify(ctx, now):
    day = _day(now)
    offers, fails, stores_ok = [], [], 0
    for host, brand, category in SHOPIFY_STORES:
        try:
            body = ctx.get_json("https://%s/products.json?limit=250" % host, "%s-products.json" % host,
                                min_age=6 * 3600, headers={"Accept": "application/json"})
            catalog = parse_shopify(body, host, brand, category, day)
            stores_ok += 1
        except SourceUnavailable as exc:
            fails.append("%s: %s" % (host, exc))
            continue
        ranked = []
        for handle in SHOPIFY_BEST_HANDLES:
            try:
                body = ctx.get_json("https://%s/collections/%s/products.json?limit=50" % (host, handle),
                                    "%s-%s.json" % (host, handle), min_age=6 * 3600, headers={"Accept": "application/json"})
                ranked = parse_shopify(body, host, brand, category, day, ranked=True)
            except SourceUnavailable:
                ranked = []
            if ranked:
                break
        rank_of = {o["ext_id"]: o["rank"] for o in ranked}
        for o in catalog:
            o["rank"] = rank_of.get(o["ext_id"])
        seen = {o["ext_id"] for o in catalog}
        offers += catalog + [o for o in ranked if o["ext_id"] not in seen]
    if not stores_ok:
        raise SourceUnavailable("; ".join(fails)[:200])
    return {"as_of": day, "count": len(offers), "data": offers,
            "note": ("%d of %d stores failed" % (len(fails), len(SHOPIFY_STORES))) if fails else None}


# ---------------------------------------------------------------- Reverb listings API
_PARTS = re.compile(r"\b(knob|pickguard|neck|body|case|gig bag|strap|cover|bag|pickup|tuners?|bridge|decal|manual|stand)\b", re.I)


def parse_reverb(body, make, model):
    """listings JSON -> (median ask, n) over USD listings that name the make and the model (parts and accessories out)."""
    if not isinstance(body, dict) or not isinstance(body.get("listings"), list):
        raise SourceUnavailable("Reverb answered no listings")
    want = re.sub(r"[^a-z0-9]+", "", model.lower())  # "P-45" matches "P45" and "P-45"
    prices = []
    for l in body["listings"]:
        title = (l.get("title") or "").lower()
        cats = " ".join(c.get("full_name", "") for c in l.get("categories") or [])
        if make.lower() not in title or want not in re.sub(r"[^a-z0-9]+", "", title):
            continue
        if cats.startswith(("Parts", "Accessories")) or _PARTS.search(title):
            continue
        p = l.get("price") or {}
        if p.get("currency") not in (None, "USD"):
            continue
        v = num(p.get("amount"))
        if v and v > 0:
            prices.append(v)
    return median(prices), len(prices)


def load_reverb(ctx, now):
    day = _day(now)
    offers, fails = [], []
    for make, model, query in REVERB_MODELS:
        url = "https://reverb.com/api/listings?" + urllib.parse.urlencode({"query": query, "per_page": 50})
        try:
            body = ctx.get_json(url, "q-%s.json" % query.replace(" ", "_"), min_age=6 * 3600,
                                headers={"Accept-Version": "3.0", "Accept": "application/hal+json"})
        except SourceUnavailable as exc:
            fails.append(str(exc))
            continue
        med, n = parse_reverb(body, make, model)
        if med is None or n < 3:
            continue
        offers.append({"platform": "Reverb", "site": "reverb", "title": "%s %s" % (make, model), "brand": make,
                       "model": model, "gtin": None, "ext_id": "reverb:" + query, "price": round(med, 2), "regular": None,
                       "rank": None, "url": "https://reverb.com/marketplace?query=" + urllib.parse.quote(query),
                       "category": "music", "source": "reverb_api", "as_of": day, "n": n})
    if not offers:
        raise SourceUnavailable(("; ".join(fails) or "no model had 3 matching listings")[:200])
    return {"as_of": day, "count": len(offers), "data": offers,
            "note": ("%d queries failed" % len(fails)) if fails else None}


# ---------------------------------------------------------------- Scryfall
def parse_scryfall(body, as_of):
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise SourceUnavailable("Scryfall answered no cards")
    offers = []
    for c in body["data"]:
        usd = num((c.get("prices") or {}).get("usd"))
        if not usd:
            continue
        offers.append({"platform": "TCGplayer", "site": "tcgplayer", "title": (c.get("name") or "")[:120], "brand": None,
                       "model": None, "gtin": None, "ext_id": "scryfall:%s" % (c.get("oracle_id") or c.get("id")),
                       "price": usd, "regular": None, "rank": None, "popularity": c.get("edhrec_rank"),
                       "url": (c.get("scryfall_uri") or "").split("?")[0], "category": "collectibles",
                       "source": "scryfall", "as_of": as_of})
    return offers


def load_scryfall(ctx, now):
    day = _day(now)
    url = "https://api.scryfall.com/cards/search?" + urllib.parse.urlencode({"q": "f:commander usd>0", "order": "edhrec"})
    offers = parse_scryfall(ctx.get_json(url, "edhrec-top.json", min_age=20 * 3600,
                                         headers={"Accept": "application/json"}), day)
    if len(offers) < 20:
        raise SourceUnavailable("Scryfall returned %d priced cards" % len(offers))
    return {"as_of": day, "count": len(offers), "data": offers}


# ---------------------------------------------------------------- owner's shop collector feed
def read_shop_feed(path=None, now=None):
    """The shop collector's ecom.json (watch medians, site states, movers). Raises when missing or unreadable."""
    path = path or SHOP_FEED
    try:
        with open(path, encoding="utf8") as fh:
            body = json.load(fh)
    except (OSError, ValueError) as exc:
        raise SourceUnavailable("shop collector feed unreadable (%s)" % exc.__class__.__name__)
    if not isinstance(body, dict) or not isinstance(body.get("watch"), list):
        raise SourceUnavailable("shop collector feed has no watch list")
    return body


def load_shop(ctx, now, path=None):
    body = read_shop_feed(path, now)
    t = body.get("t") or body.get("generated_at") or 0
    refresh = body.get("refresh") or 3600
    out = {"as_of": owner_date(t).isoformat() if t else None,
           "count": len(body.get("watch") or []), "data": body}
    if not t or now - t > 2 * refresh:
        out["stale"] = "shop collector feed is %s old" % ("of unknown age" if not t else "%d h" % ((now - t) // 3600))
    return out
