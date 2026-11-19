"""One product per real item across platforms, then the best-seller and mover lists.

Identity, strongest first: a valid GTIN (UPC/EAN, padded to 14), a Steam app id, brand plus model, the platform's own
catalog id, the normalized title. An offer with brand plus model and no GTIN joins a GTIN product that states the same
brand and model, so a Best Buy row (UPC) and a Reverb row (make, model) of one item become one product."""
import hashlib
import re

from .sources_keyed import gtin14
from .util import days_between, median, norm_tokens, pct_change, r2

CATALOG_PREFIXES = ("shopify", "scryfall", "etsy", "reverb", "watch", "bestbuy", "ebay", "shoplisting")
MOVER_MIN_PCT = 5.0
MOVER_MAX_PCT = 80.0  # a stored-price or listing move beyond this is left out, never capped
SALE_MIN_PCT = 10.0
RANK_GAIN_MIN = 5
PER_KIND = 100


def _alnum(text):
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def brand_model_key(brand, model):
    b, m = _alnum(brand), _alnum(model)
    if not b or len(m) < 3 or m == b:
        return None
    if m.startswith(b):  # "Fender" + "Fender Player Stratocaster"
        m = m[len(b):]
    return "bm:%s:%s" % (b, m) if len(m) >= 2 else None


def identity(o):
    """(gid, id_basis) for one offer."""
    g = gtin14(o.get("gtin"))
    if g:
        return "gtin:" + g, "gtin"
    if o.get("steam_appid"):
        return "steam:%s" % o["steam_appid"], "steam"
    bm = brand_model_key(o.get("brand"), o.get("model"))
    if bm:
        return bm, "brand_model"
    ext = o.get("ext_id") or ""
    if ext.split(":", 1)[0] in CATALOG_PREFIXES:
        return ext, "catalog_id"
    toks = norm_tokens(o.get("title"))
    return "title:" + "-".join(toks)[:90], "title"


def group_offers(offers):
    """{gid: (id_basis, [offers])}. Two passes: identity, then brand+model offers fold into a GTIN product."""
    groups, bm_to_gtin = {}, {}
    for o in offers:
        gid, basis = identity(o)
        o = dict(o, _gid=gid)
        if basis == "gtin":
            bm = brand_model_key(o.get("brand"), o.get("model"))
            if bm:
                bm_to_gtin.setdefault(bm, gid)
        groups.setdefault(gid, [basis, []])[1].append(o)
    for bm, gid in bm_to_gtin.items():
        if bm in groups and bm != gid:
            groups[gid][1].extend(groups.pop(bm)[1])
    return {g: (b, offs) for g, (b, offs) in groups.items()}


def _prior_rank(ranks, today):
    """Rank on the newest stored day before today (at most 3 days back)."""
    days = [d for d in ranks if d < today and days_between(d, today) <= 3]
    return ranks[max(days)] if days else None


def build_products(offers, history, today):
    """Merged products, each with price stats across platforms and the per-platform offers in `detail`."""
    products = []
    for gid, (basis, offs) in group_offers(offers).items():
        per_platform = {}
        for o in offs:
            key = o.get("platform")
            if key not in per_platform or o["price"] < per_platform[key]["price"]:
                per_platform[key] = o
        chosen = sorted(per_platform.values(), key=lambda o: (o.get("rank") or 10 ** 6, o["price"]))
        lead = chosen[0]
        prices = [o["price"] for o in chosen]
        ranks = [o["rank"] for o in chosen if o.get("rank")]
        rank = min(ranks) if ranks else None
        prior = _prior_rank(history.rank_days(gid), today) if rank else None
        products.append({
            "gid": gid, "id_basis": basis, "title": lead.get("title"),
            "brand": next((o.get("brand") for o in chosen if o.get("brand")), None),
            "category": next((o.get("category") for o in chosen if o.get("category")), None),
            "rank": rank, "rank_change": (prior - rank) if prior and rank else None,
            "price": {"median": r2(median(prices)), "low": r2(min(prices)), "high": r2(max(prices))},
            "platforms_n": len(chosen), "change_pct": None, "as_of": today,
            "detail": {"offers": [{
                "platform": o.get("platform"), "price": r2(o["price"]), "regular": r2(o.get("regular")),
                "discount_pct": round((1 - o["price"] / o["regular"]) * 100, 1) if o.get("regular") else None,
                "rank": o.get("rank"), "url": o.get("url"), "as_of": o.get("as_of"), "source": o.get("source"),
                **({"n": o["n"]} if o.get("n") else {}), **({"reference": r2(o["reference"])} if o.get("reference") else {}),
            } for o in chosen]},
        })
    return products


def record(products, history, today):
    for p in products:
        history.put_price(p["gid"], today, p["price"]["median"], p["title"], p["category"], p["platforms_n"])
        history.put_rank(p["gid"], today, p["rank"])


def _url_stem(p):
    """(host, handle tokens) of the row's first offer URL, or None. A store names colourways of one product with one
    handle stem ("mens-basic-tshirt-white", "mens-basic-tshirt-meteorite-black")."""
    url = next((o.get("url") for o in p["detail"]["offers"] if o.get("url")), None)
    m = re.match(r"https?://([^/?#]+)(?:/[^?#]*)?/([^/?#]+)/?(?:[?#].*)?$", url or "")
    return (m.group(1).lower(), m.group(2).lower().split("-")) if m else None


def same_stem(a, b):
    """Two handles on one host that start with the same two or more tokens."""
    if not a or not b or a[0] != b[0]:
        return False
    n = 0
    for x, y in zip(a[1], b[1]):
        if x != y:
            break
        n += 1
    return n >= 2


def bestsellers(products, limit=400):
    """Ranked products, best rank first. Variants of one product (a store lists each colourway as its own product)
    take one row: the best-ranked one, with `variants_n` counting the rows it stands for. Rows join only when brand and
    title match AND their URLs share a handle stem on one host, so a men's and a women's "Juniper Hoodie"
    (mens-juniper-hoodie-..., womens-juniper-hoodie-...) stay two rows; a row without a URL never joins."""
    ranked = [p for p in products if p["rank"]]
    ranked.sort(key=lambda p: (p["rank"], -p["platforms_n"], p["title"] or ""))
    rows, groups = [], {}
    for p in ranked:
        key = (_alnum(p.get("brand")), " ".join(norm_tokens(p.get("title"))))
        stem = _url_stem(p)
        home = next((g for g in groups.get(key, []) if any(same_stem(stem, s) for s in g[1])), None) if key[1] else None
        if home:
            home[0]["variants_n"] += 1
            home[1].append(stem)
            continue
        row = dict(p, kind="bestseller", variants_n=1)
        groups.setdefault(key, []).append((row, [stem]))
        rows.append(row)
    return rows[:limit]


def _prior_price(days, today):
    """(price, day) of the oldest stored day 1 to 8 days before today, or (None, None)."""
    cands = [d for d in days if d < today and 1 <= days_between(d, today) <= 8]
    if not cands:
        return None, None
    d = min(cands)
    return days[d], d


def movers(products, history, today, shop_movers=(), dropped=None):
    """Price drops and rises against our stored prices, sales against the platform's own regular price, rank gains,
    and the shop collector's movers. At most PER_KIND per kind, biggest move first. A stored-price move the evidence
    cannot carry is left out and counted in `dropped` by reason: the product's platform count changed between the two
    days (its median then and now are different mixes), or the move is beyond MOVER_MAX_PCT."""
    dropped = dropped if dropped is not None else {}
    out = {"price_drop": [], "price_rise": [], "on_sale": [], "rank_gain": [], "under_median": []}
    for p in products:
        now_price = p["price"]["median"]
        then, day = _prior_price(history.price_days(p["gid"]), today)
        ch = pct_change(now_price, then)
        if ch is not None and abs(ch) >= MOVER_MIN_PCT:
            n_then = history.platform_days(p["gid"]).get(day)
            if n_then and n_then != p["platforms_n"]:
                dropped["platform mix changed"] = dropped.get("platform mix changed", 0) + 1
            elif abs(ch) > MOVER_MAX_PCT:
                dropped["beyond the bound"] = dropped.get("beyond the bound", 0) + 1
            else:
                out["price_drop" if ch < 0 else "price_rise"].append(
                    dict(p, kind="price_drop" if ch < 0 else "price_rise", change_pct=round(ch, 1), period="%s to %s" % (day, today)))
        sale = [o for o in p["detail"]["offers"] if o.get("discount_pct") and o["discount_pct"] >= SALE_MIN_PCT]
        if sale:
            best = max(sale, key=lambda o: o["discount_pct"])
            out["on_sale"].append(dict(p, kind="on_sale", change_pct=-best["discount_pct"], period=today))
        if p["rank_change"] and p["rank_change"] >= RANK_GAIN_MIN:
            out["rank_gain"].append(dict(p, kind="rank_gain", change_pct=None, period="since the last stored day"))
    for m in shop_movers:
        out[m["kind"]].append(m)
    rows = []
    for kind, items in out.items():
        key = (lambda p: -(p["rank_change"] or 0)) if kind == "rank_gain" else (lambda p: -abs(p["change_pct"] or 0))
        rows += sorted(items, key=key)[:PER_KIND]
    return rows


def shop_mover_rows(shop, labels, today, slug_category=None, held=None, dropped=None):
    """The shop collector's movers as mover products: a listing under the cross-site median (`under_median`), a listing
    whose price fell (`drop`), or the watch's own 7-day median trend (`trend`, no single listing). A trend whose watch
    change was not printed (`held`: {slug: reason class}) is left out, and so is a listing move beyond MOVER_MAX_PCT;
    both are counted in `dropped` by reason."""
    dropped = dropped if dropped is not None else {}
    rows = []
    for m in (shop or {}).get("movers") or []:
        price, chg = m.get("price"), m.get("chg7")
        if price is None or chg is None:
            continue
        site, url = m.get("site"), m.get("url")
        why = (held or {}).get(m.get("slug")) if not url else None
        if not why and m.get("kind") != "under_median" and abs(chg * 100) > MOVER_MAX_PCT:
            why = "beyond the bound"
        if why:
            dropped[why] = dropped.get(why, 0) + 1
            continue
        kind = "under_median" if m.get("kind") == "under_median" else "price_drop" if chg < 0 else "price_rise"
        if url:
            gid = "shoplisting:" + hashlib.sha1(url.encode()).hexdigest()[:12]
        else:
            gid = "watch:%s" % m.get("slug")
        rows.append({
            "gid": gid, "id_basis": "catalog_id", "title": (m.get("title") or m.get("query") or "")[:160],
            "brand": None, "category": (slug_category or {}).get(m.get("slug")), "kind": kind, "rank": None,
            "rank_change": None, "price": {"median": r2(price), "low": r2(price), "high": r2(price)}, "platforms_n": 1,
            "change_pct": round(chg * 100, 1), "period": "7 days to %s" % today, "as_of": today,
            "detail": {"offers": [{"platform": labels.get(site, site) if site else "All tracked sites", "price": r2(price),
                                   "regular": None, "reference": r2(m.get("ref")), "discount_pct": None, "rank": None,
                                   "url": url, "as_of": today, "source": "shop_%s" % site if site else "shop_collector"}]},
        })
    return rows
