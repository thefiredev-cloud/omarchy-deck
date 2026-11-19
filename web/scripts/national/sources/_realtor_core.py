"""Shared reader for the Realtor.com Economic Research listings core metrics files at metro and state level.

Not a source (the leading underscore). realtor_metro.py and realtor_state.py import it.

Both files hold one row per geography for the newest month (the metro history file holds every month since 2016-07).
The publisher writes year-over-year changes and shares as fractions (0.0673 means 6.73 percent); this module converts them
to 0 to 100. A row with quality_flag 1 is one the publisher marks as less reliable (thin listing counts). Those rows stay,
carry flag 1, and are counted in the note, because dropping them would remove about one metro in ten.
"""
import csv

from ctx import SourceUnavailable, num, zfill_zip

BASE = "https://econdata.s3-us-west-2.amazonaws.com/Reports"
HOMEPAGE = "https://www.realtor.com/research/data/"
LICENSE = "Realtor.com research data: free to use with attribution to Realtor.com Economic Research"

# suffix -> (publisher column, conversion). Conversions: int, pct (fraction to 0-100, 2 decimals), ratio (4 decimals).
CORE = {
    "active": ("active_listing_count", "int"),
    "active_yoy": ("active_listing_count_yy", "pct"),
    "new_listings": ("new_listing_count", "int"),
    "dom": ("median_days_on_market", "int"),
    "price_reduced_share": ("price_reduced_share", "pct"),
    "pending_ratio": ("pending_ratio", "ratio"),
    "median_list": ("median_listing_price", "int"),
    "median_list_yoy": ("median_listing_price_yy", "pct"),
    "ppsf": ("median_listing_price_per_square_foot", "int"),
}

# suffix -> (label, unit, better)
FIELD_SPECS = {
    "active": ("Active listings", "count", None),
    "active_yoy": ("Active listings, change from a year earlier", "pct", None),
    "new_listings": ("New listings in the month", "count", None),
    "dom": ("Median days listed", "days", "lower"),
    "price_reduced_share": ("Listings with a price cut", "pct", None),
    "pending_ratio": ("Pending listings per active listing", "ratio", "higher"),
    "median_list": ("Median list price", "usd", None),
    "median_list_yoy": ("Median list price, change from a year earlier", "pct", None),
    "ppsf": ("Median list price per square foot", "usd_sqft", None),
}


def labelled(level, label):
    """A metro or state field's label names its level and the publisher ("Metro active listings (Realtor.com)"), so it
    never reads like the same measure from Redfin or Zillow on one screen."""
    return "%s %s%s (Realtor.com)" % (level, label[0].lower(), label[1:])


def convert(value, kind):
    val = num(value)
    if val is None:
        return None
    if kind == "int":
        return int(round(val))
    if kind == "pct":
        return round(val * 100, 2)
    return round(val, 4)


def month_label(yyyymm):
    return "%s-%s" % (yyyymm[:4], yyyymm[4:6])


def is_month(text):
    return len(text) == 6 and text.isdigit() and "01" <= text[4:] <= "12"


def flag_of(value):
    val = num(value)
    return None if val is None else int(round(val))


def header(reader, wanted, what):
    try:
        head = [h.strip() for h in next(reader)]
    except StopIteration:
        raise SourceUnavailable("Realtor.com %s file is empty" % what)
    missing = [c for c in wanted if c not in head]
    if missing:
        raise SourceUnavailable("Realtor.com %s header changed: %s missing" % (what, ", ".join(missing)))
    return head


def parse_core(path, prefix, key_col, key_fn, what, min_rows):
    """Newest month of a core metrics file. -> (data, rows, as_of, info).

    data[key] holds <prefix><suffix> fields plus <prefix>low_quality. info counts what was set aside:
    no_key (rows whose geography id is blank or malformed) and flagged (rows kept with the publisher's thin-data flag).
    """
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        head = header(reader, ["month_date_yyyymm", key_col, "quality_flag"] + [c for c, _ in CORE.values()], what)
        i_month, i_key, i_flag = head.index("month_date_yyyymm"), head.index(key_col), head.index("quality_flag")
        cols = {s: (head.index(c), kind) for s, (c, kind) in CORE.items()}
        rows, latest, newest = 0, "", []
        for row in reader:
            if len(row) < len(head):
                continue
            month = row[i_month].strip()
            if not is_month(month):
                continue
            rows += 1
            if month > latest:
                latest, newest = month, []
            if month == latest:
                newest.append(row)
    data, no_key, flagged = {}, 0, 0
    for row in newest:
        key = key_fn(row[i_key])
        if key is None:
            no_key += 1
            continue
        rec = {}
        for suffix, (i, kind) in cols.items():
            val = convert(row[i], kind)
            if val is not None:
                rec[prefix + suffix] = val
        flag = flag_of(row[i_flag])
        if flag is not None:
            rec[prefix + "low_quality"] = flag
            flagged += flag == 1
        if rec:
            data[key] = rec
    if len(data) < min_rows:
        raise SourceUnavailable("Realtor.com %s file parsed to %d rows for %s (expected at least %d)"
                                % (what, len(data), latest or "no month", min_rows))
    return data, rows, month_label(latest), {"no_key": no_key, "flagged": flagged}


def cbsa_key(value):
    """'31080' -> '31080'. A CBSA code is five digits; anything else (a blank national total row) is None."""
    text = (value or "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    return zfill_zip(text) if text.isdigit() else None
