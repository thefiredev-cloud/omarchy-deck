"""Official APIs whose keys are free. Each loader calls `ctx.need_key(...)` first, so with no key it raises NeedsKey
(status needs_key, reason names the env vars) and makes no request. Response shapes follow each API's documentation;
none of these ran live on 2026-11-14 because no key exists yet (parsers are tested against documented examples).

Never cached: OAuth tokens and Best Buy rows (its terms allow temporary caching only)."""
import base64
import json
import urllib.parse

from .ctx import SourceUnavailable
from .registry import PLATFORMS
from .util import median, num, owner_date

EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_SEARCH = "https://api.ebay.com/buy/browse/v1/item_summary/search?"
BESTBUY_CATEGORIES = (  # (category id, feed category)
    ("abcat0500000", "computers"), ("abcat0100000", "electronics"), ("abcat0200000", "electronics"),
    ("abcat0800000", "electronics"), ("abcat0900000", "home"),
)
ETSY_BASKET = (("throw blanket", "home"), ("ceramic mug", "home"), ("soy candle", "home"),
               ("leather wallet", "apparel"), ("linen dress", "apparel"))
BLS_AVG_PRICES = (("APU0000708111", "avg_eggs", "Eggs, dozen"), ("APU0000702111", "avg_bread", "White bread, pound"),
                  ("APU0000709112", "avg_milk", "Whole milk, gallon"), ("APU0000717311", "avg_coffee", "Ground coffee, pound"),
                  ("APU0000711211", "avg_bananas", "Bananas, pound"))


def _day(now):
    return owner_date(now).isoformat()


def gtin14(code):
    """Digits of a UPC/EAN/GTIN padded to 14 when the check digit is valid, else None."""
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(digits) not in (8, 12, 13, 14):
        return None
    digits = digits.zfill(14)
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(body))
    return digits if (10 - total % 10) % 10 == check else None


# ---------------------------------------------------------------- eBay Browse
def parse_ebay_search(body):
    """item_summary/search JSON -> [{price, condition, title, url, item_id, gtin}] (USD asks only)."""
    if not isinstance(body, dict):
        raise SourceUnavailable("eBay answered no JSON object")
    if body.get("errors"):
        raise SourceUnavailable("eBay error %s" % (body["errors"][0].get("errorId")))
    out = []
    for it in body.get("itemSummaries") or []:
        p = it.get("price") or {}
        v = num(p.get("value"))
        if v is None or p.get("currency") not in (None, "USD"):
            continue
        out.append({"price": v, "condition": it.get("condition"), "title": (it.get("title") or "")[:160],
                    "url": it.get("itemWebUrl"), "item_id": it.get("itemId"), "gtin": gtin14(it.get("gtin"))})
    return out


def ebay_token(ctx):
    cid, secret = ctx.need_key("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET")
    auth = base64.b64encode(("%s:%s" % (cid, secret)).encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials",
                                   "scope": "https://api.ebay.com/oauth/api_scope"}).encode()
    text, _ = ctx.get_text(EBAY_TOKEN_URL, "token", min_age=0, cache=False, data=data,
                           headers={"Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        token = json.loads(text)["access_token"]
    except (ValueError, KeyError):
        raise SourceUnavailable("eBay token call answered no access token")
    return token


def load_ebay(ctx, now, shop=None, gtins=()):
    """Per active watch: eBay median ask inside the watch's price band. Per GTIN (from other sources): eBay's lowest ask."""
    token = ebay_token(ctx)
    hdr = {"Authorization": "Bearer " + token, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"}
    day = _day(now)
    watch, offers, n = {}, [], 0
    for w in (shop or {}).get("watch") or []:
        q = {"q": w.get("query") or w.get("slug"), "limit": "50"}
        lo, hi = w.get("min_price"), w.get("max_price")
        if lo or hi:
            q["filter"] = "price:[%s..%s],priceCurrency:USD" % (lo or "", hi or "")
        rows = parse_ebay_search(ctx.get_json(EBAY_SEARCH + urllib.parse.urlencode(q), "w-%s.json" % w.get("slug"),
                                              min_age=50 * 60, headers=hdr))
        n += len(rows)
        med = median([r["price"] for r in rows])
        if med is not None:
            watch[w.get("slug")] = {"median": round(med, 2), "low": round(min(r["price"] for r in rows), 2), "n": len(rows)}
    for g in list(gtins)[:20]:
        rows = parse_ebay_search(ctx.get_json(EBAY_SEARCH + urllib.parse.urlencode({"gtin": g, "limit": "20"}),
                                              "g-%s.json" % g, min_age=50 * 60, headers=hdr))
        n += len(rows)
        new = [r for r in rows if (r["condition"] or "").lower().startswith("new")] or rows
        if new:
            b = min(new, key=lambda r: r["price"])
            offers.append({"platform": "eBay", "site": "ebay", "title": b["title"], "brand": None, "model": None,
                           "gtin": g, "ext_id": "ebay:%s" % b["item_id"], "price": b["price"], "regular": None,
                           "rank": None, "url": b["url"], "category": None, "source": "ebay_browse", "as_of": day})
    return {"as_of": day, "count": n, "data": {"watch": watch, "offers": offers}}


# ---------------------------------------------------------------- Best Buy Products API
def parse_bestbuy(body, category, as_of):
    if not isinstance(body, dict) or not isinstance(body.get("products"), list):
        raise SourceUnavailable("Best Buy answered no products list")
    offers = []
    for i, p in enumerate(body["products"], 1):
        price = num(p.get("salePrice"))
        if not price:
            continue
        regular = num(p.get("regularPrice"))
        offers.append({"platform": "Best Buy", "site": "bestbuy", "title": (p.get("name") or "")[:160],
                       "brand": p.get("manufacturer"), "model": p.get("modelNumber"), "gtin": gtin14(p.get("upc")),
                       "ext_id": "bestbuy:%s" % p.get("sku"), "price": price,
                       "regular": regular if regular and regular > price else None, "rank": i,
                       "url": p.get("url"), "category": category, "source": "bestbuy_api", "as_of": as_of})
    return offers


def load_bestbuy(ctx, now):
    key = ctx.need_key("BESTBUY_API_KEY")
    day = _day(now)
    show = "sku,name,upc,salePrice,regularPrice,onSale,manufacturer,modelNumber,bestSellingRank,url"
    offers = []
    for cat_id, category in BESTBUY_CATEGORIES:
        url = ("https://api.bestbuy.com/v1/products(categoryPath.id=%s)?" % cat_id) + urllib.parse.urlencode(
            {"apiKey": key, "sort": "bestSellingRank.asc", "show": show, "pageSize": "25", "format": "json"})
        text, _ = ctx.get_text(url, "c-%s.json" % cat_id, min_age=0, cache=False)
        try:
            offers += parse_bestbuy(json.loads(text), category, day)
        except ValueError:
            raise SourceUnavailable("Best Buy answered no JSON")
    return {"as_of": day, "count": len(offers), "data": offers}


# ---------------------------------------------------------------- Etsy Open API v3
def parse_etsy(body):
    """listings/active JSON -> [dollars] for USD listings."""
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise SourceUnavailable("Etsy answered no results list")
    out = []
    for listing in body["results"]:
        p = listing.get("price") or {}
        amt, div = num(p.get("amount")), num(p.get("divisor")) or 100
        if amt and p.get("currency_code") in (None, "USD"):
            out.append(amt / div)
    return out


def load_etsy(ctx, now):
    key = ctx.need_key("ETSY_API_KEY")
    day = _day(now)
    offers = []
    for kw, category in ETSY_BASKET:
        url = "https://openapi.etsy.com/v3/application/listings/active?" + urllib.parse.urlencode(
            {"keywords": kw, "limit": "50", "sort_on": "score"})
        prices = parse_etsy(ctx.get_json(url, "k-%s.json" % kw.replace(" ", "_"), min_age=6 * 3600,
                                         headers={"x-api-key": key}))
        med = median(prices)
        if med is not None and len(prices) >= 5:
            offers.append({"platform": "Etsy", "site": "etsy", "title": kw.capitalize(), "brand": None, "model": None,
                           "gtin": None, "ext_id": "etsy:" + kw, "price": round(med, 2), "regular": None, "rank": None,
                           "url": "https://www.etsy.com/search?q=" + urllib.parse.quote(kw), "category": category,
                           "source": "etsy_api", "as_of": day, "n": len(prices)})
    return {"as_of": day, "count": len(offers), "data": offers}


# ---------------------------------------------------------------- Census economic indicators (MARTS)
def parse_census_marts(body):
    """Census API table (header row first) -> [(YYYY-MM-01, value)] oldest first."""
    if not isinstance(body, list) or len(body) < 2:
        raise SourceUnavailable("Census answered no rows")
    head = body[0]
    try:
        iv, it = head.index("cell_value"), head.index("time")
    except ValueError:
        raise SourceUnavailable("Census table lacks cell_value or time")
    pts = sorted((r[it] + "-01", num(r[iv])) for r in body[1:] if num(r[iv]) is not None)
    return pts


def load_census(ctx, now):
    key = ctx.need_key("CENSUS_API_KEY")
    year = owner_date(now).year
    url = "https://api.census.gov/data/timeseries/eits/marts?" + urllib.parse.urlencode(
        {"get": "cell_value,data_type_code,category_code,seasonally_adj", "for": "us:*", "time": "from %d" % (year - 3),
         "category_code": "454", "data_type_code": "SM", "seasonally_adj": "yes", "key": key})
    text, _ = ctx.get_text(url, "marts-454.json", min_age=0, cache=False)
    try:
        pts = parse_census_marts(json.loads(text))
    except ValueError:
        raise SourceUnavailable("Census answered no JSON")
    return {"as_of": pts[-1][0][:7] if pts else None, "count": len(pts), "data": {"nonstore_sales": pts}}


# ---------------------------------------------------------------- BLS v2 average prices
def parse_bls(body):
    """v2 timeseries JSON -> {series_id: [(YYYY-MM-01, value)] oldest first}. Annual averages (M13) are skipped."""
    if not isinstance(body, dict) or body.get("status") != "REQUEST_SUCCEEDED":
        raise SourceUnavailable("BLS: %s" % "; ".join((body or {}).get("message") or ["request failed"])[:120])
    out = {}
    for s in (body.get("Results") or {}).get("series") or []:
        pts = []
        for d in s.get("data") or []:
            per = d.get("period") or ""
            if per.startswith("M") and per != "M13" and num(d.get("value")) is not None:
                pts.append(("%s-%s-01" % (d.get("year"), per[1:]), num(d.get("value"))))
        out[s.get("seriesID")] = sorted(pts)
    return out


def load_bls(ctx, now):
    key = ctx.need_key("BLS_API_KEY")
    year = owner_date(now).year
    payload = json.dumps({"seriesid": [s[0] for s in BLS_AVG_PRICES], "registrationkey": key,
                          "startyear": str(year - 2), "endyear": str(year)}).encode()
    text, _ = ctx.get_text("https://api.bls.gov/publicAPI/v2/timeseries/data/", "avg-prices.json", min_age=0,
                           cache=False, data=payload, headers={"Content-Type": "application/json"})
    try:
        got = parse_bls(json.loads(text))
    except ValueError:
        raise SourceUnavailable("BLS answered no JSON")
    periods = [p[-1][0][:7] for p in got.values() if p]
    return {"as_of": max(periods) if periods else None, "count": sum(len(p) for p in got.values()), "data": got}


# ---------------------------------------------------------------- Cloudflare Radar
def parse_radar(body):
    """ranking/domain JSON -> rank (int) or None."""
    if not isinstance(body, dict) or not body.get("success", True):
        raise SourceUnavailable("Cloudflare Radar error")
    res = body.get("result") or {}
    det = res.get("details_0") or res.get("details") or {}
    rank = det.get("rank")
    return int(rank) if isinstance(rank, (int, float)) else None


def load_radar(ctx, now):
    token = ctx.need_key("CLOUDFLARE_API_TOKEN")
    ranks = {}
    for p in PLATFORMS:
        if not p[1]:
            continue
        url = "https://api.cloudflare.com/client/v4/radar/ranking/domain/%s" % p[1]
        r = parse_radar(ctx.get_json(url, "d-%s.json" % p[1], min_age=20 * 3600,
                                     headers={"Authorization": "Bearer " + token}))
        if r:
            ranks[p[1]] = r
    return {"as_of": _day(now), "count": len(ranks), "data": {"ranks": ranks}}
