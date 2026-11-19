"""Section builders: macro strip, platform board, categories and watches. Inputs are the per-source results
(`{id: {"status", "data", ...}}`) and the History; outputs follow `plan/EcomFeed.md`."""
import math
import sys

from .registry import CATEGORIES, PLATFORM_NOTES, PLATFORMS, WATCH_CATEGORY, WATCH_WIKI
from .sources_keyed import BLS_AVG_PRICES
from .sources_macro import USPS_ITEMS, change_of, series_row
from .util import days_between, median, nearest, owner_date, pct_change, quantile, r2, shift_day, size_differs, sizes

GROUP_ORDER = ("demand", "prices", "freight", "parcel", "ports", "policy")


def _data(results, sid):
    r = results.get(sid) or {}
    return r.get("data") if r.get("status") in ("ok", "stale") else None


# ---------------------------------------------------------------- macro
def _page_row(key, label, group, unit, cadence, value, period, source, history, change=None, change_unit=None,
              yoy=None, yoy_unit=None, note=None):
    """A macro row for a page value: prior and hist come from our own stored periods."""
    if value is None:
        return None
    hist = history.get("macro", key)
    prev = sorted((p, v) for p, v in hist.items() if p < period)
    prior = {"value": prev[-1][1], "period": prev[-1][0]} if prev else None
    if change is None and prior:
        change, change_unit = change_of(unit, value, prior["value"])
    history.put("macro", key, period, value)
    pts = sorted(history.get("macro", key).items())[-36:]
    return {"key": key, "label": label, "group": group, "unit": unit, "value": value, "period": period, "prior": prior,
            "change": change, "change_unit": change_unit, "yoy": yoy, "yoy_unit": yoy_unit, "cadence": cadence,
            "hist": [[p, v] for p, v in pts], "source": source, "note": note}


def build_macro(results, history):
    rows = []
    fred_rows = {}
    for sid, res in results.items():
        if res.get("status") in ("ok", "stale") and isinstance(res.get("data"), dict) and sid.startswith(
                ("census_", "bls_", "bea_", "eia_", "cass_", "umich_", "bts_")) and sid not in ("census_api", "bls_api"):
            for key, row in res["data"].items():
                fred_rows[key] = row
                if row.get("macro"):
                    rows.append({k: v for k, v in row.items() if k not in ("macro", "series")})
    census = _data(results, "census_api")
    if census and census.get("nonstore_sales"):  # the official API is fresher than the FRED mirror: replace that row
        rows = [r for r in rows if r["key"] != "nonstore_sales"]
        rows.append(series_row("nonstore_sales", "Nonstore retail sales", "demand", "usd_m", "monthly",
                               census["nonstore_sales"], "census_api"))
    bls = _data(results, "bls_api")
    for sid, key, label in BLS_AVG_PRICES:
        if bls and bls.get(sid):
            rows.append(series_row(key, label, "prices", "usd", "monthly", bls[sid], "bls_api"))
    fx = _data(results, "fedex_fuel")
    if fx:
        cur, prev = fx[0], (fx[1] if len(fx) > 1 else None)
        for key, label, field in (("fedex_ground_fuel", "FedEx Ground fuel surcharge", "ground"),
                                  ("fedex_express_fuel", "FedEx Express fuel surcharge", "express")):
            if cur.get(field) is None:
                continue
            if prev and prev.get(field) is not None:  # the page shows two weeks: keep both in the history
                history.put("macro", key, prev["week"], prev[field])
            ch, cu = change_of("pct", cur[field], prev.get(field) if prev else None)
            rows.append(_page_row(key, label, "parcel", "pct", "weekly", cur[field], cur["week"], "fedex_fuel", history,
                                  ch, cu))
    usps = _data(results, "usps_prices")
    if usps:
        for key, label, _ in USPS_ITEMS:
            row = _page_row(key, label, "parcel", "usd", "on change", usps["prices"].get(key), usps["as_of"],
                            "usps_prices", history)
            if row:
                rows.append(row)
    dw = _data(results, "drewry_wci")
    if dw:
        for key, label, field in (("container_wci", "Container rate, world composite", "wci"),
                                  ("container_sha_la", "Container rate, Shanghai to Los Angeles", "sha_la"),
                                  ("container_sha_ny", "Container rate, Shanghai to New York", "sha_ny")):
            if dw.get(field):
                row = _page_row(key, label, "freight", "usd_feu", "weekly", dw[field]["value"], dw["as_of"], "drewry_wci",
                                history, dw[field]["change_pct"], "pct" if dw[field]["change_pct"] is not None else None)
                if row:
                    rows.append(row)
    pla = _data(results, "port_la")
    if pla:
        for key, label, field in (("port_la_teu", "Port of Los Angeles containers", "total"),
                                  ("port_la_imports", "Port of Los Angeles loaded imports", "imports")):
            if pla.get(field):
                row = _page_row(key, label, "ports", "teu", "monthly", round(pla[field]["value"]), pla["as_of"], "port_la",
                                history, yoy=pla[field]["change_pct"], yoy_unit="pct")
                if row:
                    rows.append(row)
    fr = _data(results, "federal_register")
    if fr:
        row = _page_row("trade_notices", "Tariff and customs notices, 30 days", "policy", "count", "daily", fr["count"],
                        fr["until"], "federal_register", history,
                        note=("Latest: %s" % fr["latest"]["title"]) if fr.get("latest") else None)
        rows.append(row)
    rows.sort(key=lambda r: GROUP_ORDER.index(r["group"]) if r["group"] in GROUP_ORDER else 99)
    return rows, fred_rows


# ---------------------------------------------------------------- platforms
def _log_score(rank, n_max):
    return max(0.0, 1.0 - math.log10(rank) / math.log10(n_max)) if rank else 0.0


def _chg(series, today, days, gap):
    """Positions climbed since `days` ago (positive = better), from a {day: rank} map."""
    now, then = series.get(today), nearest(series, shift_day(today, -days), gap)
    return (then - now) if now and then else None


def build_platforms(results, history, today, shop_sites, status_of):
    apple = _data(results, "apple_chart") or {}
    tranco = _data(results, "tranco") or {}
    radar = _data(results, "cloudflare_radar") or {}
    app_ranks, tr_ranks, rd_ranks = apple.get("ranks") or {}, tranco.get("ranks") or {}, radar.get("ranks") or {}
    board = []
    for name, domain, kind, app_id, shop_site, own in PLATFORMS:
        tr = tr_ranks.get(domain) if domain else None
        ap = app_ranks.get(app_id) if app_id else None
        rd = rd_ranks.get(domain) if domain else None
        if domain and tr:
            history.put("tranco", domain, tranco.get("as_of") or today, tr)
        if app_id and ap and apple:
            history.put("app", app_id, today, ap)
        parts = []
        if domain and tr_ranks:
            parts.append(_log_score(tr, 1_000_000))
        if app_id and app_ranks:
            parts.append(_log_score(ap, 101))
        if domain and rd_ranks:
            parts.append(_log_score(rd, 1_000_000))
        states, srcs, detail = [], [], {"n_24h": None, "last_ok": None}
        site = shop_sites.get(shop_site) if shop_site else None
        if site:
            srcs.append("shop_" + shop_site)
            detail["n_24h"], detail["last_ok"] = site.get("n_24h"), site.get("last_ok")
            st = site.get("state") or site.get("status")
            states.append("ok" if st == "ok" and (site.get("n_24h") or 0) > 0 else
                          "blocked" if st in ("blocked_by_site", "blocked") else
                          "needs_key" if st in ("needs_keys", "never") else "none")
        if own:
            srcs.append(own)
            st = status_of(own)
            states.append("ok" if st in ("ok", "stale") else "needs_key" if st == "needs_key" else "none")
        cov = next((s for s in ("ok", "needs_key", "blocked") if s in states), "none")
        board.append({
            "name": name, "domain": domain, "kind": kind,
            "score": round(sum(parts) / len(parts), 3) if parts else None,
            "signals": {"tranco_rank": tr, "tranco_period": tranco.get("as_of") if tr else None,
                        "tranco_change_30d": _chg(history.get("tranco", domain), tranco.get("as_of") or today, 30, 3) if tr else None,
                        "app_rank": ap, "app_period": apple.get("as_of") if app_id and apple else None,
                        "app_change_7d": _chg(history.get("app", app_id), today, 7, 1) if ap else None,
                        "radar_rank": rd},
            "price_coverage": cov, "price_detail": dict(detail, sources=srcs),
            "note": PLATFORM_NOTES.get(name)})
    board.sort(key=lambda b: (b["score"] is None, -(b["score"] or 0), b["name"]))
    for i, b in enumerate(board, 1):
        b["rank"] = i
    return board


# ---------------------------------------------------------------- categories
MIN_PANEL = 10  # products priced at both ends of a window before a store price change prints
REL_BOUNDS = (0.5, 2.0)  # a price ratio outside this is a broken price, not a price move
FULL_PANEL = 30  # matched products for full product coverage in the confidence score
AGREE_POINTS = 1.0  # high confidence needs store and official monthly rates within 1 percentage point
AGREE_RATIO = 3.0  # the same direction and under 3 times apart caps confidence at medium; more apart is low
RATIO_FLOOR = 0.25  # a move under a quarter point counts as a quarter point when two sizes are compared
MONTH_DAYS = 30.44  # store changes are compared with the official one-month change at this pace
CATEGORY_METHOD = (
    "Store prices: geometric mean of price ratios of products priced at both ends of the window (30 days or 7);"
    " ratios outside 0.5 to 2 dropped; under 10 such products, no value. Never blended with the official monthly"
    " change. Confidence: 0.4 products (full at 30), 0.3 sites (full at 4), 0.3 agreement as a monthly rate:"
    " within 1 point can be high, same way under 3 times apart medium at most, else low.")


def matched(prices, gids, a, b):
    """[(gid, ratio)] of the products priced on both day a and day b, ratio inside REL_BOUNDS."""
    out = []
    for g in gids:
        p0, p1 = prices[g].get(a), prices[g].get(b)
        if p0 and p1 and REL_BOUNDS[0] <= p1 / p0 <= REL_BOUNDS[1]:
            out.append((g, p1 / p0))
    return out


def _jevons(pairs):
    return math.exp(sum(math.log(r) for _, r in pairs) / len(pairs)) if pairs else None


def _panel(prices, gids, days, last_day, window, gap, min_panel):
    """The matched panel over `window` days to `last_day`: {from, to, n, change} (change null under min_panel)."""
    target = shift_day(last_day, -window)
    starts = [d for d in days if d < last_day and abs(days_between(d, target)) <= gap]
    if not starts:
        return None
    start = min(starts, key=lambda d: (abs(days_between(d, target)), d))
    pairs = matched(prices, gids, start, last_day)
    change = r2((_jevons(pairs) - 1) * 100) if len(pairs) >= min_panel else None
    return {"from": start, "to": last_day, "n": len(pairs), "change": change}


def _stored(history, gids, today):
    """({gid: {day: price}}, sorted days of the last 45 up to today) for `gids`."""
    prices = {g: history.price_days(g) for g in gids}
    return prices, sorted({d for p in prices.values() for d in p if days_between(d, today) <= 45 and d <= today})


def platform_index(history, gids, today, min_panel=MIN_PANEL):
    """Store price index of `gids` from their stored daily prices, never chained: the base is the first day with
    `min_panel` products priced, and each later day is 100 times the geometric mean of the price ratios of the products
    priced on both the base and that day (a day with fewer such products has no point). `change_7d` and `change_30d`
    are matched-panel changes: only products priced at both ends of the window, null under `min_panel`, so products
    that come and go never move the number. None with under two points."""
    prices, days = _stored(history, gids, today)
    base = next((d for d in days if sum(1 for p in prices.values() if p.get(d)) >= min_panel), None)
    if base is None:
        return None
    hist = [[base, 100.0]]
    for d in days:
        if d > base:
            pairs = matched(prices, gids, base, d)
            if len(pairs) >= min_panel:
                hist.append([d, round(100 * _jevons(pairs), 2)])
    if len(hist) < 2:
        return None
    last_day = hist[-1][0]
    p7 = _panel(prices, gids, days, last_day, 7, 2, min_panel)
    p30 = _panel(prices, gids, days, last_day, 30, 3, min_panel)
    strip = lambda p: {k: p[k] for k in ("from", "to", "n")} if p else None  # noqa: E731
    return {"value": hist[-1][1], "base_period": base, "last_period": last_day,
            "change_7d": p7["change"] if p7 else None, "change_30d": p30["change"] if p30 else None,
            "span_days": days_between(base, last_day), "hist": hist[-45:],
            "panel_7d": strip(p7), "panel_30d": strip(p30), "min_panel": min_panel}


def _official(row):
    if not row or row.get("value") is None:
        return None
    return {"source": row["source"], "series": row.get("series"), "label": row["label"], "value": row["value"],
            "period": row["period"], "mom": row["change"], "yoy": row["yoy"], "hist": row["hist"][-13:]}


def _agreement(plat, off, said):
    """(agreement 0..1, score cap, reason) for two changes already on one period (a month), by size and direction."""
    gap = abs(plat - off)
    big, small = max(abs(plat), abs(off)), min(abs(plat), abs(off))
    times = big / max(small, RATIO_FLOOR)
    if gap <= AGREE_POINTS:
        return 1.0, 1.0, said + ", within 1 point"
    if (plat >= 0) == (off >= 0) and times <= AGREE_RATIO:
        return 0.6, 0.74, said + ", %.1f times apart" % times
    if (plat >= 0) == (off >= 0):
        return 0.0, 0.49, said + ", %d times apart" % round(times)
    return 0.0, 0.49, said + ", opposite ways"


def monthly_rate(change_pct, days):
    """A change over `days` as the same pace over one month (30.44 days), compounded."""
    return ((1 + change_pct / 100) ** (MONTH_DAYS / days) - 1) * 100


def build_categories(products, history, today, fred_rows, watch_items):
    by_cat = {}
    for p in products:
        if p.get("category") in CATEGORIES and p["price"]["median"]:
            by_cat.setdefault(p["category"], []).append(p)
    for w in watch_items:
        if w.get("category") in CATEGORIES and w.get("median"):
            by_cat.setdefault(w["category"], []).append(
                {"gid": "watch:" + w["slug"], "platforms_n": w["sites_ok"],
                 "detail": {"offers": [{"platform": b["platform"]} for b in w["detail"]["by_platform"]]}})
    out = []
    for key, (label, cpi_key, sales_key) in CATEGORIES.items():
        items = by_cat.get(key, [])
        gids = [p["gid"] for p in items]
        platforms = {o["platform"] for p in items for o in p["detail"]["offers"]}
        idx = platform_index(history, gids, today) if gids else None
        prices, days = _stored(history, gids, today)
        if idx:
            idx.update(n_products=len(items), n_platforms=len(platforms))
        official = _official(fred_rows.get(cpi_key)) if cpi_key else None
        sales_row = fred_rows.get(sales_key) if sales_key else None
        # One printed value covers one period: the store's matched-panel change (30 days when that panel holds, else
        # 7 days) when it exists, else the official one-month change. The two are never blended; the official series
        # stays in `official` with its own month, and confidence compares the two only on one period (a month).
        panel, measure = None, None
        if idx and idx["change_30d"] is not None:
            panel, measure = idx["panel_30d"], "change_30d"
        elif idx and idx["change_7d"] is not None:
            panel, measure = idx["panel_7d"], "change_7d"
        store = off_part = None
        if panel:
            in_panel = {g for g, _ in matched(prices, gids, panel["from"], panel["to"])}
            sites = {o["platform"] for p in items if p["gid"] in in_panel for o in p["detail"]["offers"]}
            store = {"kind": "platforms", "value": idx[measure],
                     "period": ("30 days to %s" % panel["to"]) if measure == "change_30d"
                     else "%s to %s" % (panel["from"], panel["to"]),
                     "measure": measure, "n_products": panel["n"], "n_platforms": len(sites), "weight": 1.0}
        if official and official["mom"] is not None:
            off_part = {"kind": "official", "source": official["source"], "series": official["series"],
                        "value": official["mom"], "period": official["period"], "measure": "mom", "weight": 1.0}
        carrier = store or off_part
        parts = [carrier] if carrier else []
        value = carrier["value"] if carrier else None
        basis = "platforms" if store else "official_mom" if off_part else None
        period = carrier["period"] if carrier else None
        if store:
            reasons = ["%d products priced at both ends, on %d sites" % (store["n_products"], store["n_platforms"])]
        elif items:
            n7 = _panel(prices, gids, days, days[-1], 7, 2, MIN_PANEL) if days else None
            reasons = ["%d products, %d priced at both ends of 7 days; a change needs %d"
                       % (len(items), n7["n"] if n7 else 0, MIN_PANEL)]
        else:
            reasons = ["no platform prices yet"]
        cap = 1.0
        if store and off_part:
            days_n = max(1, days_between(panel["from"], panel["to"]))
            month = monthly_rate(store["value"], days_n)
            said = "store %+.2f%% in %d days, %+.2f%% a month; official %+.2f%% in %s" % (
                store["value"], days_n, month, off_part["value"], off_part["period"])
            agree, cap, why = _agreement(month, off_part["value"], said)
            reasons.append(why)
        elif store:
            agree = 0.5
            reasons.append("no official series to compare")
        span = idx["span_days"] if idx else (days_between(days[0], days[-1]) if days else 0)
        if items and span < 7:
            reasons.append("price history %d day%s, building" % (span, "" if span == 1 else "s"))
        if store:
            cover = 0.4 * min(1.0, store["n_products"] / FULL_PANEL) + 0.3 * min(1.0, store["n_platforms"] / 4)
            score = round(min(cap, cover + 0.3 * agree), 2)
            conf = {"score": score, "label": "high" if score >= 0.75 else "medium" if score >= 0.5 else "low"}
        elif off_part:
            # a published monthly figure carried alone: nothing of ours stands behind it or checks it, so no score
            reasons.insert(0, "official monthly figure; store prices too few to cross-check it")
            conf = {"score": None, "label": "official"}
        else:
            conf = {"score": None, "label": None}
        out.append({
            "key": key, "label": label, "value": value, "unit": "pct", "basis": basis, "period": period,
            "parts": parts, "confidence": dict(conf, reasons=reasons),
            "method": CATEGORY_METHOD,
            "platform_index": idx, "official": official,
            "sales": {"source": sales_row["source"], "series": sales_row.get("series"), "label": sales_row["label"],
                      "value": sales_row["value"], "unit": "usd_m", "period": sales_row["period"], "mom": sales_row["change"],
                      "yoy": sales_row["yoy"]} if sales_row and sales_row.get("value") is not None else None,
        })
    return out


# ---------------------------------------------------------------- watches
WATCH_MIN_LISTINGS = 10  # listings a watch needs in each window before its median change prints
WATCH_MAX_MOVE = 50.0  # percent: a median of asking prices that moves more in 7 or 30 days changed its sample, not its price
SAMPLE_SHIFT = 0.25  # the sample's typical pack count or size moving more than this is another basket


def sample_signature(w):
    """{"pack": .., "ml": .., "g": ..}: the median pack count and size the sample's product groups state (weighted by
    each group's listing count); a measure no group states is absent."""
    vals = {}
    for g in w.get("groups") or []:
        count = max(1, int(g.get("count") or 1))
        for dim, v in sizes(g.get("title")).items():
            vals.setdefault(dim, []).extend([v[0]] * count)
    return {d: round(median(v), 2) for d, v in vals.items() if v}


def change_evidence(change, days, n_now, sig_now, n_then, sig_then):
    """(change or None, reason or None). A median change prints only when the evidence carries it: enough listings in
    both windows, the same kind of pack in the sample, and a move inside WATCH_MAX_MOVE. Never capped."""
    if change is None:
        return None, None
    if n_now < WATCH_MIN_LISTINGS:
        return None, "%d listings now; a change needs %d" % (n_now, WATCH_MIN_LISTINGS)
    if n_then is not None and n_then < WATCH_MIN_LISTINGS:
        return None, "%d listings %d days ago; a change needs %d" % (n_then, days, WATCH_MIN_LISTINGS)
    for dim, word in (("pack", "pack count"), ("ml", "volume"), ("g", "weight")):
        a, b = (sig_then or {}).get(dim), (sig_now or {}).get(dim)
        if a and b and abs(b - a) > SAMPLE_SHIFT * a:
            return None, "the sample's typical %s changed (%g to %g)" % (word, a, b)
    if abs(change) > WATCH_MAX_MOVE:
        return None, "moved %+.0f%% in %d days, more than a median of asking prices can carry (%d%%)" % (
            change, days, WATCH_MAX_MOVE)
    return change, None


def reason_class(reason):
    """The short class of a change_evidence reason, for counts."""
    return ("too few listings" if "listings" in reason else "sample pack or size changed" if "changed" in reason
            else "beyond the bound")


def build_watches(shop, now, today, labels, ebay=None, wiki=None, history=None):
    """Cross-platform view of the owner's watch list from the shop collector feed (asking prices)."""
    if not shop:
        return {"as_of": None, "window_days": 7, "items": []}
    age = now - (shop.get("t") or 0)
    fresh = 1.0 if age <= 7200 else 0.5 if age <= 86400 else 0.0
    items = []
    for w in shop.get("watch") or []:
        slug = w.get("slug")
        by = [{"platform": labels.get(s.get("site"), s.get("site")), "median": r2(s["median"]), "low": r2(s.get("min")),
               "n": s.get("n") or 0, "source": "shop_%s" % s.get("site")}
              for s in w.get("by_site") or [] if s.get("median") is not None and (s.get("n") or 0) > 0]
        eb = (ebay or {}).get(slug)
        if eb:
            by.append({"platform": "eBay", "median": eb["median"], "low": eb.get("low"), "n": eb["n"], "source": "ebay_browse"})
        meds = [b["median"] for b in by]
        n = sum(b["n"] for b in by)
        expected = max(len(w.get("by_site") or []), len(by))
        mid = median(meds)
        lo, hi = (quantile(meds, 0.25), quantile(meds, 0.75)) if len(meds) >= 2 else (None, None)
        cov = len(by) / expected if expected else 0.0
        agree = max(0.0, 1 - (hi - lo) / mid) if mid and lo is not None else (0.3 if by else 0.0)
        hist_days = w.get("history_days") or 0
        score = round(0.35 * cov + 0.25 * min(1.0, n / 30) + 0.2 * agree + 0.1 * fresh + 0.1 * min(1.0, hist_days / 30), 2)
        reasons = ["%d of %d sites" % (len(by), expected), "%d listings" % n]
        if lo is not None and mid:
            reasons.append("sites agree within %d%%" % round((hi - lo) / mid * 100))
        if fresh < 1:
            reasons.append("collector data is %d h old" % (age // 3600))
        t_day = today
        if w.get("t"):
            t_day = owner_date(w["t"]).isoformat()
        spark = w.get("spark") or []
        hist = [[shift_day(t_day, i - len(spark) + 1), v] for i, v in enumerate(spark) if v is not None]
        art = w.get("wiki_title") or WATCH_WIKI.get(slug)
        interest = None
        pts = (wiki or {}).get(art) if art else None
        if pts:
            last = pts[-1]
            interest = {"views": last[1], "period": last[0],
                        "change_pct": r2(pct_change(last[1], pts[-2][1])) if len(pts) > 1 else None}
        best, best_used, best_reason = best_offer(w, labels)
        sig = sample_signature(w)
        changes = {}
        for days, key in ((7, "chg7"), (30, "chg30")):
            raw = r2(w[key] * 100) if w.get(key) is not None else None
            then = shift_day(t_day, -days)
            n_then = nearest(history.get("watch_n", slug), then, 2) if history else None
            sig_then = nearest(history.get("watch_sample", slug), then, 2) if history else None
            changes[days] = change_evidence(raw, days, n, sig, n_then, sig_then)
            if raw is not None and changes[days][0] is None:
                _log("watch %s: %d-day change %+.1f%% not printed: %s" % (slug, days, raw, changes[days][1]))
        if history:
            history.put("watch_n", slug, t_day, n)
            history.put("watch_sample", slug, t_day, sig)
        items.append({
            "slug": slug, "label": w.get("query") or slug, "category": WATCH_CATEGORY.get(w.get("category"), w.get("category")),
            "median": r2(mid), "ci": {"lo": r2(lo), "hi": r2(hi)} if lo is not None else None, "n": n,
            "sites_ok": len(by), "sites_expected": expected,
            "change_7d": changes[7][0], "change_7d_reason": changes[7][1],
            "change_30d": changes[30][0], "change_30d_reason": changes[30][1],
            "best": best, "best_used": best_used, "best_reason": best_reason,
            "period": "%s to %s" % (shift_day(t_day, -6), t_day),
            "confidence": {"score": score, "label": "high" if score >= 0.75 else "medium" if score >= 0.5 else "low",
                           "reasons": reasons},
            "interest": interest, "hist": hist[-45:], "detail": {"by_platform": by},
        })
    return {"as_of": owner_date(shop["t"]).isoformat() if shop.get("t") else None, "window_days": 7,
            "items": items}


def _log(msg):
    print("ecom-market: %s" % msg, file=sys.stderr, flush=True)


def best_offer(w, labels, log=_log):
    """(best, best_used, reason) from the shop collector's lowest believable listing. `best` is a new listing only; a
    used, refurbished, open-box or unknown-condition listing goes to `best_used`. When the watch query names a size or
    pack and the listing states a different one in the same measure (250 ml against 1 l), it is another item: neither,
    and the reason names it. Every listing kept out of `best` is logged with its title."""
    raw = w.get("best") or None
    if not raw or not raw.get("price"):
        return None, None, "no listing passed the price checks"
    cond = raw.get("condition") or "unknown"
    row = {"price": r2(raw["price"]), "platform": labels.get(raw.get("site"), raw.get("site")), "condition": cond,
           "title": (raw.get("title") or "")[:160] or None, "url": raw.get("url")}
    said = '"%s" at %s, $%.2f' % ((row["title"] or "untitled")[:120], row["platform"], row["price"])
    if size_differs(sizes(w.get("query")), sizes(raw.get("title"))):
        log("watch %s: refused %s, another size than %r" % (w.get("slug"), said, w.get("query")))
        return None, None, "the lowest listing, %s, is another size than the watch names" % said
    if cond == "new":
        return row, None, None
    log("watch %s: %s is %s, kept as best_used" % (w.get("slug"), said, cond))
    return None, row, "no new listing passed the price checks; the lowest is %s" % cond.replace("_", " ")


def record_watches(watch_items, history):
    """Daily cross-platform history of each watch feeds the category indexes."""
    for w in watch_items:
        for day, v in w["hist"]:
            history.put_price("watch:" + w["slug"], day, v, w["label"], w["category"])
