"""Streaming readers for Redfin's current monthly Data Center exports.

The retired redfin_market_tracker/*.tsv000.gz URLs return 403. The publisher's
redfin_data_center/index.json now lists CSVs. Like the existing ZIP readers,
_open accepts gzip by magic bytes, without holding the download in memory.
Percent-labelled CSV columns already use percent units, not fractions.
"""
import csv
import datetime
import re
import struct
import time
import unicodedata
import zipfile

from ctx import SourceUnavailable, zfill_zip
from redfin_zip_market import _cast, _open

BASE = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center"
MF_TYPES = {"Multi-Family (2-4 Unit)", "Multi-Family (2-4 Units)"}
COLUMNS = {
    "median_sale": ("MEDIAN SALE PRICE NSA ($)", "d"),
    "median_sale_yoy": ("MEDIAN SALE PRICE NSA YOY (%)", "f"),
    "ppsf": ("MEDIAN SALE PRICE PER SQ.FT. ($)", "f"),
    "dom": ("MEDIAN DAYS ON MARKET (DAYS)", "i"),
    "inventory": ("INVENTORY", "i"),
    "inventory_yoy": ("INVENTORY YOY (%)", "f"),
    "homes_sold": ("HOMES SOLD", "i"),
    "price_drop_share": ("PERCENT ACTIVE WITH PRICE DROPS (%)", "f"),
    "sale_to_list": ("AVERAGE SALE TO LIST RATIO (%)", "f"),
    "months_supply": ("MONTHS OF SUPPLY", "f"),
    "new_listings": ("NEW LISTINGS", "i"),
}
SPECS = {
    "median_sale": ("Median sale price", "usd", "pop_weighted_median"),
    "median_sale_yoy": ("Median sale price, change from a year ago", "pct", "pop_weighted_mean"),
    "ppsf": ("Median sale price per square foot", "usd_sqft", "pop_weighted_median"),
    "dom": ("Median days on market", "days", "pop_weighted_median"),
    "inventory": ("Homes for sale", "count", "sum"),
    "inventory_yoy": ("Homes for sale, change from a year ago", "pct", "pop_weighted_mean"),
    "homes_sold": ("Homes sold", "count", "sum"),
    "price_drop_share": ("Active listings with a price drop", "pct", "pop_weighted_mean"),
    "sale_to_list": ("Sale price as a share of list price", "pct", "pop_weighted_mean"),
    "months_supply": ("Months of supply", "ratio", "pop_weighted_mean"),
    "new_listings": ("New listings", "count", "sum"),
}
MARKET = tuple(k for k in COLUMNS if k != "price_drop_share")
MF = ("median_sale", "median_sale_yoy", "ppsf", "dom", "inventory", "homes_sold")
MF_ZIP = MF + ("sale_to_list", "months_supply")
NOTE = ("Redfin Data Center monthly CSVs replace the retired market_tracker TSV URLs. "
        "Only unadjusted latest-period rows are used. Multifamily means 2-4 units, not 5+ units. "
        "Redfin does not publish multifamily price-drop shares in these files.")


def fields(prefix, suffixes, multifamily=False, level=None):
    """Use the same field descriptions and units in all three plugins. A metro or state plugin names its level and
    the publisher in the label ("Metro homes for sale (Redfin)"), so it never reads like the ZIP field or the same
    measure from Zillow or Realtor.com; the field names stay."""
    result = {}
    for suffix in suffixes:
        label, unit, agg = SPECS[suffix]
        if multifamily:
            label += ", multifamily 2-4 units"
        if level:
            label = "%s %s%s (Redfin)" % (level, label[0].lower(), label[1:])
        result[prefix + suffix] = {"label": label, "unit": unit, "agg": agg}
    return result


def metro_name(value):
    """Normalize exact Census titles, never fuzzy-match a city to a wider metro."""
    value = re.sub(r"\s+metro area$", "", value.strip(), flags=re.I)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", value.lower())


def metro_resolver(cbsas):
    """Validate REGION ID against Census codes; fall back to unique full titles.

    Division IDs may be supplied separately by the metro source. Resolving a
    division keeps its own ID until that source explicitly rolls up its rows.
    """
    names = {}
    for code, name in cbsas.items():
        key = metro_name(name)
        names[key] = code if key not in names else None

    def resolve(region_id, name):
        if region_id in cbsas:
            return region_id
        return names.get(metro_name(name))

    return resolve


def state_resolver():
    from _legacy import S

    names = {name.casefold(): abbr for fips, (abbr, name) in S.STATES.items() if int(fips) <= 56}
    # Redfin labels District of Columbia as Columbia (REGION ID 17).
    names["columbia"] = "DC"
    return lambda region_id, name: names.get(name.strip().casefold())


def parse_periods(path, level, prefix, suffixes, multifamily=False, cbsas=None, months=1):
    """Stream a bounded monthly window, independent of publisher row order."""
    if level == "zip":
        resolve = lambda region_id, name: zfill_zip(name)
    elif level == "state":
        resolve = state_resolver()
    else:
        if not cbsas:
            raise SourceUnavailable("Redfin metro parsing requires the Census CBSA list")
        resolve = metro_resolver(cbsas)
    region_type = {"zip": "Zip", "state": "State", "cbsa": "Metro"}[level]
    frequency = "Rolling 3 Months" if level == "zip" else "Monthly"
    periods, latest, rows, latest_index = {}, "", 0, 0
    with _open(path) as fh:
        reader = csv.reader(fh)
        head = next(reader, [])
        head = [h.strip().upper() for h in head]
        need = ["PERIOD END", "REGION TYPE", "REGION NAME", "REGION ID", "FREQUENCY", "IS SEASONALLY ADJUSTED"]
        if multifamily:
            need.append("PROPERTY TYPE")
        need.extend(COLUMNS[s][0] for s in suffixes)
        missing = [n for n in need if n not in head]
        if missing:
            raise SourceUnavailable("Redfin header missing: " + ", ".join(missing))
        idx = {name: head.index(name) for name in need}
        cols = [(prefix + s, idx[COLUMNS[s][0]], COLUMNS[s][1]) for s in suffixes]
        for row in reader:
            rows += 1
            if len(row) != len(head):
                raise SourceUnavailable("Redfin row %d has a truncated or changed schema" % rows)
            if row[idx["REGION TYPE"]] != region_type or row[idx["IS SEASONALLY ADJUSTED"]].lower() != "false":
                continue
            if row[idx["FREQUENCY"]] != frequency:
                continue
            if multifamily and row[idx["PROPERTY TYPE"]] not in MF_TYPES:
                continue
            end = row[idx["PERIOD END"]]
            try:
                datetime.date.fromisoformat(end)
            except ValueError:
                raise SourceUnavailable("Redfin has an invalid period end") from None
            month_index = int(end[:4]) * 12 + int(end[5:7])
            if month_index < latest_index - months + 1:
                continue
            if end > latest:
                latest, latest_index = end, month_index
                periods = {p: values for p, values in periods.items()
                           if int(p[:4]) * 12 + int(p[5:7]) >= latest_index - months + 1}
            geo = resolve(row[idx["REGION ID"]], row[idx["REGION NAME"]])
            if not geo:
                continue
            data = periods.setdefault(end[:7], {})
            values = {field: _cast(row[i], kind) for field, i, kind in cols}
            if geo in data and data[geo] != values:
                raise SourceUnavailable("Redfin has conflicting latest-period rows for " + geo)
            data[geo] = values
    if not periods.get(latest[:7]):
        raise SourceUnavailable("Redfin has no matching latest-period " + region_type + " rows")
    return periods, rows, latest[:7]


def parse_table(path, level, prefix, suffixes, multifamily=False, cbsas=None):
    """Return the newest monthly table without retaining older values."""
    periods, rows, latest = parse_periods(path, level, prefix, suffixes, multifamily, cbsas)
    return periods[latest], rows, latest


def fetch_table(ctx, kind, level):
    """Keep each download in its source's normal conditional-request cache."""
    region = {"zip": "zips", "cbsa": "metros", "state": "states"}[level]
    path, meta = ctx.fetch(BASE + "/%s/monthly/all_%s.csv" % (kind, region), kind + ".csv",
                           timeout=180, min_bytes=1 << 20)
    ctx.log("parsing %s, %d bytes (%s)" % (kind, meta.get("bytes", 0), meta.get("status")))
    if meta.get("refresh_error"):
        ctx.log("cached download: " + meta["refresh_error"])
    return path


def census_cbsas(ctx):
    """Use the same Census list 1 URL and parser as the census_cbsa source."""
    from _legacy import CBSA, S

    for year in range(ctx.year, 2022, -1):
        try:
            path, _ = ctx.fetch(CBSA % (year, year), "cbsa_list1_%d.xlsx" % year, timeout=90)
        except SourceUnavailable:
            if year > 2023:
                time.sleep(1)
            continue
        counties, meta = S.parse_cbsa(path)
        cbsas = {v["cbsa"]: v["metro"] for v in counties.values() if v.get("metro")}
        if len(cbsas) < 500:
            raise SourceUnavailable("Census CBSA list parsed to fewer than 500 areas")
        # Redfin still uses the pre-2023 division partition. TIGER's 2020
        # attribute table publishes that complete partition without XLS dependencies.
        time.sleep(1)
        division_path, _ = ctx.fetch(
            "https://www2.census.gov/geo/tiger/TIGER2020/METDIV/tl_2020_us_metdiv.zip",
            "metdiv_2020.zip", timeout=90)
        return cbsas, meta["as_of"], census_divisions(division_path)
    raise SourceUnavailable("Census CBSA delineation list is unavailable")


def census_divisions(path):
    """Read 2020 division-to-CBSA identities from Census TIGER's DBF table."""
    with zipfile.ZipFile(path) as archive:
        members = [name for name in archive.namelist() if name.endswith(".dbf")]
        if len(members) != 1:
            raise SourceUnavailable("Census division archive must contain one DBF table")
        raw = archive.read(members[0])
    if len(raw) < 32:
        raise SourceUnavailable("Census division DBF header is truncated")
    count, header_size, record_size = struct.unpack_from("<IHH", raw, 4)
    if header_size < 33 or (header_size - 33) % 32 or len(raw) < header_size + count * record_size:
        raise SourceUnavailable("Census division DBF records are truncated")
    columns, offset = {}, 1
    for pos in range(32, header_size - 1, 32):
        name = raw[pos:pos + 11].split(b"\0")[0].decode("ascii")
        width = raw[pos + 16]
        columns[name] = (offset, width)
        offset += width
    if not {"CBSAFP", "METDIVFP", "NAME"} <= columns.keys() or offset != record_size:
        raise SourceUnavailable("Census division DBF columns changed")
    divisions = {}
    for index in range(count):
        start = header_size + index * record_size
        if raw[start:start + 1] == b"*":
            continue
        def cell(name):
            offset, width = columns[name]
            return raw[start + offset:start + offset + width].decode("utf8").strip()
        parent, code, title = cell("CBSAFP"), cell("METDIVFP"), cell("NAME")
        if not (len(code) == len(parent) == 5 and code.isdigit() and parent.isdigit() and title):
            raise SourceUnavailable("Census division DBF has an invalid identity")
        value = {"parent": parent, "title": title}
        if code in divisions and divisions[code] != value:
            raise SourceUnavailable("Census division has conflicting parent identities: " + code)
        divisions[code] = value
    if len(divisions) < 15:
        raise SourceUnavailable("Census division DBF has fewer than half the expected divisions")
    return divisions


def require_coverage(data, field, minimum):
    count = sum(row.get(field) is not None for row in data.values())
    if count < minimum:
        raise SourceUnavailable("Redfin has %d areas with %s (need at least %d)" % (count, field, minimum))


def load_area(ctx, parse, level, prefix, minimum, cbsas=None):
    """Combine only same-period all-residential, multifamily and price-drop rows."""
    data, periods, rows = {}, set(), 0
    for index, kind in enumerate(("housing_market", "property_types", "price_drops")):
        if index:
            time.sleep(1)
        path = fetch_table(ctx, kind, level)
        part, count, period = parse(path, kind=kind, cbsas=cbsas)
        if kind == "housing_market":
            data = part
            if len(data) < minimum:
                raise SourceUnavailable("Redfin has %d areas (need at least %d)" % (len(data), minimum))
            # The publisher can suppress a whole state's cells while still
            # publishing its row. Keep that geography with null values.
            require_coverage(data, prefix + "median_sale", max(1, minimum // 2))
        else:
            require_coverage(part, prefix + ("mf_inventory" if kind == "property_types" else "price_drop_share"),
                             max(1, minimum // 2))
            for geo in data:
                if geo in part:
                    data[geo].update(part[geo])
        periods.add(period)
        rows += count
    if len(periods) != 1:
        raise SourceUnavailable("Redfin files have different latest periods: " + ", ".join(sorted(periods)))
    note = NOTE + " Metro and state values cover one month."
    if level == "state":
        missing = sorted(geo for geo, values in data.items() if values.get(prefix + "median_sale") is None)
        if missing:
            note += " No current median sale price is published for: " + ", ".join(missing) + ". Values stay null."
    return {"data": data, "rows": rows, "as_of": periods.pop(), "note": note}
