"""Commercial listings per ZIP: counts, median asking price and price per square foot, median listed cap rate (overall
and for office, retail, industrial and multifamily) and median asking rent, from the listing files the Deck already
writes. Replaces the legacy `realestate_feed_commercial` join and keeps its three field names.

Reads, first that exists:
  1. house-feeds/listings-v2/commercial.json  national broker table (scripts/listings). Disabled at launch: the brokers'
     terms forbid automated access, so this file does not exist yet.
  2. house-feeds/realestate.json `commercial` (for sale) plus the Realmo lease rows in
     deck/realestate-source-records.json: the hourly California feed (Southern California commercial).
Every ZIP outside the file's scope is null, never zero. No network. Root: $DECK_FEED_DIR, else ~/.kodros/status.
"""
import json
import os
import re
import statistics
import time

from ctx import SourceUnavailable, zfill_zip

TYPES = ("office", "retail", "industrial", "multifamily")
SOURCE = {
    "id": "cre_listings_zip",
    "name": "Commercial listings by ZIP (asking prices, listed cap rates, asking rents)",
    "publisher": "Kodros listings collectors (public broker listings)",
    "homepage": "https://www.matthews.com/listings",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "cadence": "daily",
    "license": "Asking prices from public listing pages read under each site's terms; not closed sales",
    "key_env": None,
    "fields": dict({
        "com_listings": {"label": "Commercial listings for sale", "unit": "count", "agg": "sum"},
        "com_median_price": {"label": "Median commercial asking price", "unit": "usd", "agg": "pop_weighted_median"},
        "com_median_cap": {"label": "Median asking cap rate (listed caps only)", "unit": "pct", "agg": "pop_weighted_median",
                           "metric": "asking_cap"},
        "crel_cap_n": {"label": "Listings with a listed cap rate", "unit": "count", "agg": "sum"},
        "crel_sale_psf": {"label": "Median asking price per sq ft", "unit": "usd_sqft", "agg": "pop_weighted_median"},
        "crel_lease_psf_yr": {"label": "Median asking rent per sq ft per year", "unit": "usd_sqft", "agg": "pop_weighted_median"},
        "crel_lease_listings": {"label": "Commercial listings for lease", "unit": "count", "agg": "sum"},
    }, **{"crel_cap_" + t: {"label": "Median asking cap, %s (listed caps only)" % t, "unit": "pct", "agg": "pop_weighted_median"}
          for t in TYPES}),
}
ADDR_ZIP = re.compile(r"\b(\d{5})(?:-\d{4})?\s*$")
MIN_PSF_SQFT = 500  # same floor as the feed's own asking price per SF block
NATIONAL_NOTE = "Public broker listings across the US (asking figures, not closed sales); caps are the ones brokers list."
CA_NOTE = ("Covers only the hourly California listings feed (Southern California commercial for sale, Orange County lease "
           "listings); every other ZIP is null. Caps are the ones brokers list; most listings show none.")


def root():
    return os.path.expanduser(os.environ.get("DECK_FEED_DIR") or "~/.kodros/status")


def _zip(r):
    z = zfill_zip(r.get("zip"))
    if not z:
        m = ADDR_ZIP.search(r.get("addr") or "")
        z = m.group(1) if m else None
    return z


def _pos(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0 else None


def read_rows(path):
    """A listings file -> (sale rows, lease rows, generated_at). Columnar commercial.json or realestate.json."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as exc:
        raise SourceUnavailable("listings file unreadable: %s" % exc.__class__.__name__)
    if not isinstance(doc, dict):
        raise SourceUnavailable("listings file is not a JSON object")
    if "cols" in doc:
        cols = doc.get("cols") or []
        if "sale_or_lease" not in cols or "zip" not in cols:
            raise SourceUnavailable("listings table lacks the sale_or_lease or zip column")
        rows = [dict(zip(cols, r)) for r in doc.get("rows") or []]
        return ([r for r in rows if r.get("sale_or_lease") == "sale"], [r for r in rows if r.get("sale_or_lease") == "lease"],
                doc.get("generated_at"))
    if not isinstance(doc.get("commercial"), list):
        raise SourceUnavailable("realestate feed has no commercial list")
    return doc["commercial"], [], doc.get("t")


def read_lease_records(path):
    """Realmo lease rows from the realestate feed's records sidecar; [] when absent."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return []
    return ((doc.get("sources") or {}).get("realmo_lease") or {}).get("lease") or []


def _median(vals, nd):
    return round(statistics.median(vals), nd) if vals else None


def parse(sale, lease):
    """-> {zip: fields}. A ZIP appears when it has at least one sale or lease row."""
    groups = {}
    for kind, rows in (("sale", sale), ("lease", lease)):
        for r in rows:
            z = _zip(r)
            if z:
                groups.setdefault(z, {"sale": [], "lease": []})[kind].append(r)
    out = {}
    for z, g in groups.items():
        s, l_ = g["sale"], g["lease"]
        prices = [r["price"] for r in s if _pos(r.get("price"))]
        psf = [r["price"] / r["sqft"] for r in s if _pos(r.get("price")) and (_pos(r.get("sqft")) or 0) >= MIN_PSF_SQFT]
        capped = [r for r in s if _pos(r.get("cap_rate")) and r["cap_rate"] <= 30]
        rents = [r["rent_psf_yr"] for r in l_ if _pos(r.get("rent_psf_yr")) and r["rent_psf_yr"] <= 500]
        rec = {"com_listings": len(s) if s else None,
               "com_median_price": int(round(statistics.median(prices))) if prices else None,
               "com_median_cap": _median([r["cap_rate"] for r in capped], 2),
               "crel_cap_n": len(capped) if s else None,
               "crel_sale_psf": _median(psf, 2),
               "crel_lease_psf_yr": _median(rents, 2),
               "crel_lease_listings": len(l_) if l_ else None}
        for t in TYPES:
            rec["crel_cap_" + t] = _median([r["cap_rate"] for r in capped if (r.get("type") or "").lower() == t], 2)
        out[z] = rec
    return out


def load(ctx):
    base = root()
    national = os.path.join(base, "house-feeds", "listings-v2", "commercial.json")
    if os.path.exists(national):
        sale, lease, at = read_rows(national)
        note = NATIONAL_NOTE
    else:
        feed = os.path.join(base, "house-feeds", "realestate.json")
        if not os.path.exists(feed):
            raise SourceUnavailable("no listings file (listings-v2/commercial.json or realestate.json)")
        sale, lease, at = read_rows(feed)
        lease = lease or read_lease_records(os.path.join(base, "deck", "realestate-source-records.json"))
        note = CA_NOTE
    if not sale and not lease:
        raise SourceUnavailable("listings file has no commercial rows")
    ctx.log("%d sale and %d lease rows" % (len(sale), len(lease)))
    at = at if isinstance(at, (int, float)) else None
    return {"as_of": time.strftime("%Y-%m-%d", time.localtime(at)) if at else time.strftime("%Y-%m-%d"),
            "rows": len(sale) + len(lease), "data": parse(sale, lease), "note": note}
