"""Public housing market numbers for the Pixel Deck Homes page.

Everything here is a published public series, fetched as CSV and reduced to the last value plus
its date. No scraping of listing sites and no paid feed:

  Zillow Research  ZHVI, for-sale inventory, median list price, median days to pending,
                   median sale price at ZIP, county and metro level
  Realtor.com      ZIP metrics: median listing price, active listing count, median days on market
  FRED             mortgage rates, commercial property price growth, commercial real estate loans

`collect()` returns the block the deck feed stores under market.residential / market.commercial /
market.mortgage. A series that cannot be fetched lands in `unavailable` with its reason; a number is
never invented or carried forward as if it were current.
"""
import csv
import io
import json
import os
import re
import time
import urllib.request

# DECK_MARKET_CACHE lets a staged national build keep its FRED copy out of the live status tree.
CACHE_DIR = os.path.expanduser(os.environ.get("DECK_MARKET_CACHE") or "~/.meshvault/status/deck/.market-cache")
TTL = {"zillow": 20 * 3600, "realtor": 20 * 3600, "fred": 6 * 3600}
UA = {"User-Agent": "pixel-deck/1 (+https://meshvault.ai)"}

# The tracked markets, closest first: the "home" tier, then the ring outward. Edit for your own area.
ZIPS = [
    ("92629", "Dana Point", "home"),
    ("92624", "Capistrano Beach", "south_oc"),
    ("92672", "San Clemente", "south_oc"),
    ("92673", "San Clemente", "south_oc"),
    ("92677", "Laguna Niguel", "south_oc"),
]
COUNTIES = [
    ("orange-county-ca", "Orange County", "Orange County", "oc"),
    ("los-angeles-county-ca", "Los Angeles County", "Los Angeles County", "la"),
    ("san-diego-county-ca", "San Diego County", "San Diego County", "sd"),
]
US_ROW = ("united-states", "United States", "United States", "us")

ZILLOW_ZIP = "https://files.zillowstatic.com/research/public_csvs/%s/Zip_%s_uc_sfrcondo%s.csv"
ZILLOW_COUNTY = "https://files.zillowstatic.com/research/public_csvs/%s/County_%s_uc_sfrcondo%s.csv"
ZILLOW_METRO = "https://files.zillowstatic.com/research/public_csvs/%s/Metro_%s_uc_sfrcondo%s.csv"
REALTOR_ZIP = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=%s"

# name -> (dir, file_stub, suffix, level)
SERIES = {
    "zhvi": ("zhvi", "zhvi", "_tier_0.33_0.67_sm_sa_month", ("zip", "county")),
    "mlp": ("mlp", "mlp", "_sm_month", ("zip", "county")),
    "invt_fs": ("invt_fs", "invt_fs", "_sm_month", ("county",)),
    "med_doz_pending": ("med_doz_pending", "med_doz_pending", "_sm_month", ("zip", "county")),
    "median_sale_price": ("median_sale_price", "median_sale_price", "_month", ("zip", "county")),
}
METRIC_LABEL = {
    "zhvi": "ZHVI all homes mid tier",
    "mlp": "median list price",
    "med_doz_pending": "median days to pending",
    "median_sale_price": "median sale price",
}
SOURCES = {
    "zillow": "Zillow Research public CSVs (files.zillowstatic.com/research)",
    "realtor": "Realtor.com residential listings core metrics, public ZIP file",
    "fred": "FRED (St. Louis Fed) fredgraph.csv",
}


def _cached(url, group, force=False):
    """Path to a locally cached copy of `url`, refetched when older than the group TTL."""
    os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", url.rsplit("/", 1)[-1])[:120]
    path = os.path.join(CACHE_DIR, name)
    fresh = False
    try:
        fresh = time.time() - os.path.getmtime(path) < TTL[group]
    except OSError:
        pass
    if fresh and not force and os.path.getsize(path) > 1024:
        return path
    req = urllib.request.Request(url, headers=UA)
    fd, tmp = path + ".part", None
    tmp = "%s.%d" % (fd, os.getpid())
    with urllib.request.urlopen(req, timeout=180) as resp, open(tmp, "wb") as fh:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    if os.path.getsize(tmp) < 1024:
        os.unlink(tmp)
        raise ValueError("body too small to be a data file")
    os.replace(tmp, path)
    return path


def _dates(header):
    return [(i, h) for i, h in enumerate(header) if re.match(r"^\d{4}-\d{2}-\d{2}$", h)]


def _reduce(header, row, key):
    """Last published value and the year-earlier value for one region row."""
    vals = []
    for i, h in _dates(header):
        v = row[i] if i < len(row) else ""
        try:
            vals.append((h, float(v)))
        except (TypeError, ValueError):
            continue
    if not vals:
        return None
    as_of, last = vals[-1]
    yo, mo = int(as_of[0:4]), int(as_of[5:7])
    want = "%04d-%02d" % (yo - 1, mo)
    prev = next((v for h, v in vals if h.startswith(want)), None)
    out = {"value": round(last, 2), "as_of": as_of}
    if prev not in (None, 0):
        out["yoy_pct"] = round((last - prev) / prev * 100, 2)
    return out


def zillow_series(kind, level, wanted, errors, force=False):
    """{region_name: {value, as_of, yoy_pct}} for one series at one geographic level."""
    src, stub, suffix, _levels = SERIES[kind]
    geo = {"zip": ZILLOW_ZIP, "county": ZILLOW_COUNTY}.get(level, ZILLOW_METRO)
    url = geo % (src, stub, suffix)
    try:
        path = _cached(url, "zillow", force)
        idx = {h: i for i, h in enumerate(_header_row(path))}
        if level == "zip":
            return _scan_zip(path, idx, set(wanted))
        if level == "metro":
            return _scan_names(path, idx, set(wanted))
        return _scan_names(path, idx, set(wanted), "StateName", "CA")
    except Exception as exc:  # noqa: BLE001 - reported, never raised at the caller
        errors.append({"source": "zillow %s %s" % (kind, level), "reason": _short(exc)})
        return {}


def _header_row(path):
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        return next(csv.reader(fh))


def _scan_zip(path, idx, wanted):
    out = {}
    key = idx["RegionName"]
    st = idx.get("StateName", idx.get("State"))
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        for row in reader:
            if len(row) <= key:
                continue
            zipc = (row[key] or "").strip()
            if zipc not in wanted:
                continue
            if st is not None and (row[st] or "").strip() != "CA":
                continue
            red = _reduce(header, row, zipc)
            if red and zipc not in out:
                out[zipc] = red
    return out


def _scan_names(path, idx, wanted, state_col=None, state_val=None):
    out = {}
    key = idx["RegionName"]
    sc = idx.get(state_col) if state_col else None
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        for row in reader:
            if len(row) <= key:
                continue
            name = (row[key] or "").strip()
            if name not in wanted:
                continue
            if sc is not None and state_val is not None and (row[sc] or "").strip() not in (state_val, ""):
                continue
            red = _reduce(header, row, name)
            if red and name not in out:
                out[name] = red
    return out


def realtor_zip(errors, force=False):
    """Latest month per ZIP: median listing price, active listings, median days on market."""
    try:
        path = _cached(REALTOR_ZIP, "realtor", force)
    except Exception as exc:  # noqa: BLE001
        errors.append({"source": "realtor.com zip metrics", "reason": _short(exc)})
        return {}, None
    want = {z for z, _, _ in ZIPS}
    out, month = {}, None
    try:
        with open(path, newline="", encoding="utf8", errors="replace") as fh:
            for row in csv.DictReader(fh):
                z = (row.get("postal_code") or "").strip()
                if z not in want:
                    continue
                m = (row.get("month_date_yyyymm") or "").strip()
                if month is None or m > month:
                    month = m
                if z in out and (row.get("month_date_yyyymm") or "") <= out[z]["_m"]:
                    continue
                out[z] = {
                    "_m": row.get("month_date_yyyymm") or "",
                    "list_price": _f(row.get("median_listing_price")),
                    "active_listings": _f(row.get("active_listing_count")),
                    "days_on_market": _f(row.get("median_days_on_market")),
                    "list_price_yoy_pct": _pct(row.get("median_listing_price_yy")),
                }
    except Exception as exc:  # noqa: BLE001
        errors.append({"source": "realtor.com zip metrics", "reason": _short(exc)})
        return {}, None
    for z in out:
        out[z].pop("_m", None)
    as_of = "%s-%s-01" % (month[0:4], month[4:6]) if month and len(month) == 6 else None
    return out, as_of


def _f(v):
    try:
        f = float(v)
        return round(f, 2) if f == f else None
    except (TypeError, ValueError):
        return None


def _pct(v):
    """Realtor.com year-over-year columns are fractions (-0.07 = -7%)."""
    f = _f(v)
    return None if f is None else round(f * 100, 2)


def _short(exc, limit=140):
    text = re.sub(r"\s+", " ", str(exc) or exc.__class__.__name__).strip()
    return text[:limit]


def fred_series(series_id, errors, force=False):
    """Last observation of a FRED CSV series: {value, as_of, series}."""
    try:
        path = _cached(FRED % series_id, "fred", force)
        with open(path, encoding="utf8", errors="replace") as fh:
            rows = [r for r in csv.reader(fh) if len(r) >= 2 and r[0] and r[0] != "observation_date"]
        for date, raw in reversed(rows):
            try:
                return {"value": round(float(raw), 2), "as_of": date, "series": series_id}
            except ValueError:
                continue  # FRED writes "." for a missing observation
        raise ValueError("no numeric observation")
    except Exception as exc:  # noqa: BLE001
        errors.append({"source": "fred " + series_id, "reason": _short(exc)})
        return None


def collect(force=False):
    """The market block: scope order, residential areas, commercial indicators, mortgage rates."""
    errors = []
    zips = [z for z, _, _ in ZIPS]
    zhvi_z = zillow_series("zhvi", "zip", zips, errors, force)
    mlp_z = zillow_series("mlp", "zip", zips, errors, force)
    dom_z = zillow_series("med_doz_pending", "zip", zips, errors, force)
    sale_z = zillow_series("median_sale_price", "zip", zips, errors, force)
    county_names = [n for _, _, n, _ in COUNTIES]
    us_name = [US_ROW[2]]
    zhvi_c = zillow_series("zhvi", "county", county_names, errors, force)
    inv_c = zillow_series("invt_fs", "county", county_names, errors, force)
    mlp_c = zillow_series("mlp", "county", county_names, errors, force)
    dom_c = zillow_series("med_doz_pending", "county", county_names, errors, force)
    sale_c = zillow_series("median_sale_price", "county", county_names, errors, force)
    us_zhvi = zillow_series("zhvi", "metro", us_name, errors, force)
    us_inv = zillow_series("invt_fs", "metro", us_name, errors, force)
    us_mlp = zillow_series("mlp", "metro", us_name, errors, force)
    us_dom = zillow_series("med_doz_pending", "metro", us_name, errors, force)
    us_sale = zillow_series("median_sale_price", "metro", us_name, errors, force)
    rz, rz_as_of = realtor_zip(errors, force)

    areas = []
    for z, label, tier in ZIPS:
        areas.append({
            "slug": "zip-" + z, "name": label, "tier": tier, "level": "zip", "zip": z,
            "zhvi": zhvi_z.get(z), "zhvi_source": "zillow",
            "list_price": mlp_z.get(z), "list_price_source": "zillow",
            "sale_price": sale_z.get(z), "sale_price_source": "zillow",
            "days_to_pending": dom_z.get(z),
            "active_listings": (rz.get(z) or {}).get("active_listings"),
            "days_on_market": (rz.get(z) or {}).get("days_on_market"),
            "realtor_list_price": (rz.get(z) or {}).get("list_price"),
            "realtor_as_of": rz_as_of if z in rz else None,
        })
    for slug, label, zname, tier in COUNTIES:
        areas.append({
            "slug": slug, "name": label, "tier": tier, "level": "county",
            "zip": None, "zhvi": zhvi_c.get(zname), "zhvi_source": "zillow",
            "inventory": inv_c.get(zname), "list_price": mlp_c.get(zname),
            "sale_price": sale_c.get(zname), "days_to_pending": dom_c.get(zname),
        })
    slug, label, zname, tier = US_ROW
    areas.append({
        "slug": slug, "name": label, "tier": tier, "level": "us", "zip": None,
        "zhvi": us_zhvi.get(zname), "zhvi_source": "zillow",
        "inventory": us_inv.get(zname), "list_price": us_mlp.get(zname),
        "sale_price": us_sale.get(zname), "days_to_pending": us_dom.get(zname),
    })

    mortgage = {
        "rate_30y": fred_series("MORTGAGE30US", errors, force),
        "rate_15y": fred_series("MORTGAGE15US", errors, force),
        "source": SOURCES["fred"],
    }
    cre_price = fred_series("COMREPUSQ159N", errors, force)
    cre_loans = fred_series("CREACBM027SBOG", errors, force)
    # 2026-11-04 housing sweep: more public commercial context, every number with its FRED series id and date.
    cre_delinq = fred_series("DRCRELEXFACBS", errors, force)
    cre_chargeoff = fred_series("CORCREXFACBS", errors, force)
    rent_vac = fred_series("RRVRUSQ156N", errors, force)
    own_vac = fred_series("RHVRUSQ156N", errors, force)
    mf_starts = fred_series("HOUST5F", errors, force)
    ten_year = fred_series("DGS10", errors, force)

    def ind(row, unit, label):
        return dict(row, unit=unit, label=label) if row else None

    commercial = {
        "price_growth": dict(cre_price, unit="percent_annualized",
                             label="Commercial property prices, percent change at annual rate (CoStar composite via FRED)")
        if cre_price else None,
        "loan_balance_bn": dict(cre_loans, unit="billions_usd",
                                label="Commercial real estate loans, all US commercial banks (FRED)")
        if cre_loans else None,
        "delinquency": ind(cre_delinq, "percent", "Delinquency rate on CRE loans excluding farmland, all US banks (Federal Reserve via FRED)"),
        "chargeoff": ind(cre_chargeoff, "percent", "Charge-off rate on CRE loans excluding farmland, all US banks (Federal Reserve via FRED)"),
        "rental_vacancy": ind(rent_vac, "percent", "US rental vacancy rate, Census Housing Vacancy Survey via FRED. Apartments and rented homes, not office or retail"),
        "homeowner_vacancy": ind(own_vac, "percent", "US homeowner vacancy rate, Census Housing Vacancy Survey via FRED"),
        "multifamily_starts": ind(mf_starts, "thousand_units_saar", "Housing starts in buildings with 5 or more units, annual rate (Census via FRED)"),
        "treasury_10y": ind(ten_year, "percent", "10-year Treasury yield, the usual benchmark that cap rates are read against (FRED)"),
        "vacancy": {
            "status": "unavailable",
            "reason": "No free public metro office, industrial or retail vacancy series for OC, LA or SD. "
                      "CoStar, CBRE and JLL publish it behind paid subscriptions, so the deck does not "
                      "show a commercial vacancy number at all. US rental vacancy is shown instead.",
        },
        "cap_rate": {
            "status": "unavailable",
            "reason": "No free public cap rate series. Listing cards carry price and size, not net operating income. "
                      "CoStar, Real Capital Analytics and CBRE sell it. The 10-year Treasury is shown as the benchmark.",
        },
        "local_listings": None,
        "source": SOURCES["fred"],
    }
    covered = sum(1 for a in areas if isinstance(a.get("zhvi"), dict))
    return {
        "generated_at": int(time.time()),
        "scope": {
            "home": "Dana Point, CA",
            "order": ["Dana Point", "Capistrano Beach", "San Clemente", "Laguna Niguel",
                      "Orange County", "Los Angeles County", "San Diego County", "United States"],
            "us_selectable": True,
            "note": "ZIP first, then the county each sits in, then the United States row.",
        },
        "areas": areas,
        "areas_with_zhvi": covered,
        "mortgage": mortgage,
        "commercial": commercial,
        "sources": SOURCES,
        "errors": errors,
    }


def main():
    print(json.dumps(collect("--force" in os.sys.argv), indent=1)[:4000])


if __name__ == "__main__":
    main()
