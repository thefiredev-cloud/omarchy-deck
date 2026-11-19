"""Redfin monthly all-residential and 2-4 unit multifamily markets by CBSA.

Published parent rows win. Missing parents are approximated from all Census
metropolitan divisions: counts sum, medians use homes-sold weights. Annual
changes use current and year-ago rollups when available, else weighted changes.
"""
import time

from ctx import SourceUnavailable
from _redfin_segments import COLUMNS, MARKET, MF, NOTE, census_cbsas, fields, fetch_table, parse_periods, require_coverage

MIN_METROS = 250
SOURCE = {
    "id": "redfin_metro_market",
    "name": "Redfin residential and multifamily market by CBSA",
    "publisher": "Redfin",
    "homepage": "https://www.redfin.com/news/data-center/",
    "level": "cbsa",
    "group": "residential",
    "cadence": "monthly",
    "license": "Redfin Data Center: free to use with citation to Redfin",
    "key_env": None,
    "fields": {**fields("rfm_", MARKET + ("price_drop_share",), level="Metro"),
               **fields("rfm_mf_", MF, multifamily=True, level="Metro")},
}


def weighted(rows, children, field, weights, weight_field):
    """Do not silently treat a missing division value or weight as zero."""
    total, weight_sum = 0.0, 0.0
    for code in children:
        weight = weights.get(code, {}).get(weight_field)
        if weight is None or weight < 0:
            return None
        if weight == 0:
            continue
        value = rows[code].get(field)
        if value is None:
            return None
        total += value * weight
        weight_sum += weight
    return total / weight_sum if weight_sum else None


def rollup(period, divisions, prefix, suffixes, market=None):
    """Roll up complete division sets only, preserving every published parent."""
    data = {code: values for code, values in period.items() if code not in divisions}
    groups, rolled = {}, set()
    for code, info in divisions.items():
        groups.setdefault(info["parent"], []).append(code)
    for parent, children in groups.items():
        if parent in data or not all(code in period for code in children):
            continue
        values = {}
        for suffix in suffixes:
            field = prefix + suffix
            if suffix in {"inventory", "homes_sold", "new_listings"}:
                cells = [period[code].get(field) for code in children]
                value = sum(cells) if all(v is not None for v in cells) else None
            else:
                # Price drops describe active listings, not completed sales.
                weights = market if suffix == "price_drop_share" else period
                weight_field = "rfm_inventory" if suffix == "price_drop_share" else prefix + (
                    "inventory" if suffix == "inventory_yoy" else "homes_sold")
                value = weighted(period, children, field, weights or {}, weight_field)
                if value is not None:
                    value = int(round(value)) if COLUMNS[suffix][1] in {"i", "d"} else round(value, 2)
            values[field] = value
        data[parent] = values
        rolled.add(parent)
    return data, rolled


def parse_market(path, cbsas, kind, divisions, market=None):
    """Keep 13 months for annual comparisons and return the raw weight tables."""
    suffixes = {"housing_market": MARKET, "property_types": MF, "price_drops": ("price_drop_share",)}[kind]
    prefix = "rfm_mf_" if kind == "property_types" else "rfm_"
    identities = dict(cbsas, **{code: info["title"] for code, info in divisions.items()})
    periods, rows, latest = parse_periods(
        path, "cbsa", prefix, suffixes, multifamily=kind == "property_types",
        cbsas=identities, months=1 if kind == "price_drops" else 13)
    data, rolled = rollup(periods[latest], divisions, prefix, suffixes, (market or {}).get(latest))
    prior = str(int(latest[:4]) - 1) + latest[4:]
    if prior in periods:
        old, _ = rollup(periods[prior], divisions, prefix, suffixes)
        for code in rolled:
            for suffix in ("median_sale", "inventory"):
                field, yoy = prefix + suffix, prefix + suffix + "_yoy"
                if yoy not in data[code]:
                    continue
                current, previous = data[code].get(field), old.get(code, {}).get(field)
                if current is not None and previous is not None and previous != 0:
                    data[code][yoy] = round((current / previous - 1) * 100, 2)
    return data, rows, latest, rolled, periods


def parse(path, cbsas, kind="housing_market", divisions=None, market=None):
    """Pure fixture entry point; market contains inventory weights for price drops."""
    data, rows, latest, _, _ = parse_market(path, cbsas, kind, divisions or {}, market)
    return data, rows, latest


def load(ctx):
    cbsas, vintage, divisions = census_cbsas(ctx)
    data, periods, rolled, rows, market = {}, set(), set(), 0, None
    skipped = set()
    groups = {}
    for code, info in divisions.items():
        groups.setdefault(info["parent"], []).append(code)
    for index, kind in enumerate(("housing_market", "property_types", "price_drops")):
        if index:
            time.sleep(1)
        path = fetch_table(ctx, kind, "cbsa")
        part, count, period, approximate, raw = parse_market(path, cbsas, kind, divisions, market)
        if kind == "housing_market":
            data, market = part, raw
            if len(data) < MIN_METROS:
                raise SourceUnavailable("Redfin has fewer than %d CBSAs" % MIN_METROS)
            require_coverage(data, "rfm_median_sale", max(1, MIN_METROS // 2))
        else:
            field = "rfm_mf_inventory" if kind == "property_types" else "rfm_price_drop_share"
            require_coverage(part, field, max(1, MIN_METROS // 2))
            for code in data:
                if code in part:
                    data[code].update(part[code])
        rows += count
        periods.add(period)
        rolled.update(approximate & data.keys())
        for parent, children in groups.items():
            if parent not in part:
                missing = sorted(code for code in children if code not in raw[period])
                if missing:
                    skipped.add(parent + " (" + kind + ": missing " + ", ".join(missing) + ")")
    if len(periods) != 1:
        raise SourceUnavailable("Redfin files have different latest periods: " + ", ".join(sorted(periods)))
    note = (NOTE + " Metro values cover one month. CBSA identities use Census " + vintage +
            "; division partitions use Census TIGER/Line 2020, matching Redfin's older division IDs.")
    if rolled:
        note += (" Division rollups for CBSAs: " + ", ".join(sorted(rolled)) + ". "
                 "Counts sum all divisions. Medians are approximations using homes-sold-weighted division medians. "
                 "Other rates use homes-sold weights, except inventory changes and price-drop shares use inventory weights. "
                 "Annual changes are recomputed from current and year-ago rolled values when both exist, otherwise weighted. "
                 "Published parent rows are never overwritten; incomplete division sets are not rolled up.")
    if skipped:
        note += " Skipped incomplete parent CBSAs: " + "; ".join(sorted(skipped)) + "."
    note += " Redfin includes metropolitan and micropolitan areas."
    return {"data": data, "rows": rows, "as_of": periods.pop(), "note": note}
