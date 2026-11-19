"""Realtor.com listings core metrics and market hotness by metro area (CBSA). Level "cbsa".

Three public files from the Realtor.com Economic Research bucket:
- Core metrics, metro, newest month (about 300 KB, 935 CBSAs): the headline fields.
- Core metrics, metro, monthly history since 2016-07 (about 34 MB): the last 72 months of three fields for charts.
- Market hotness, metro, monthly history (about 9 MB, the top 300 metros): hotness, supply and demand scores.
  The current-month hotness file answers 403 to scripts; the history file does not.
Hotness and history are soft: if they cannot be read, the core fields still land and the note says what is missing.
"""
import csv
import time

import _realtor_core as core
from ctx import SourceUnavailable, num

CORE_URL = core.BASE + "/Core/RDC_Inventory_Core_Metrics_Metro.csv"
HISTORY_URL = core.BASE + "/Core/RDC_Inventory_Core_Metrics_Metro_History.csv"
HOTNESS_URL = core.BASE + "/Hotness/RDC_Inventory_Hotness_Metrics_Metro_History.csv"
HIST_MONTHS = 72
MIN_CBSAS = 400  # the newest month has about 935

SOURCE = {
    "id": "realtor_metro",
    "name": "Realtor.com listings core metrics and hotness, metro area",
    "publisher": "Realtor.com Economic Research",
    "homepage": core.HOMEPAGE,
    "level": "cbsa",
    "native": "cbsa",
    "group": "residential",
    "cadence": "monthly",
    "license": core.LICENSE,
    "key_env": None,
    "fields": {
        **{"rdm_" + s: {"label": core.labelled("Metro", label), "unit": unit, "agg": "none", **({"better": better} if better else {})}
           for s, (label, unit, better) in core.FIELD_SPECS.items()},
        "rdm_hotness": {"label": core.labelled("Metro", "Market hotness score"), "unit": "score", "agg": "none", "better": "higher"},
        "rdm_supply_score": {"label": core.labelled("Metro", "Supply score"), "unit": "score", "agg": "none"},
        "rdm_demand_score": {"label": core.labelled("Metro", "Demand score"), "unit": "score", "agg": "none", "better": "higher"},
        "rdm_low_quality": {"label": "Realtor.com flags this metro's data as thin", "unit": "flag", "agg": "none"},
    },
}

HOTNESS_COLUMNS = {
    "rdm_hotness": "hotness_score",
    "rdm_supply_score": "supply_score",
    "rdm_demand_score": "demand_score",
}
# field -> (publisher column, conversion) for the monthly history charts
HIST_COLUMNS = {
    "rdm_active": ("active_listing_count", "int"),
    "rdm_dom": ("median_days_on_market", "int"),
    "rdm_price_reduced_share": ("price_reduced_share", "pct"),
}


def parse(path, min_rows=MIN_CBSAS):
    """Newest month of the core metro file. -> (data, rows, as_of, info). Keys are 5-digit CBSA codes."""
    return core.parse_core(path, "rdm_", "cbsa_code", core.cbsa_key, "metro core metrics", min_rows)


def parse_hotness(path, as_of):
    """Hotness, supply and demand scores of the newest month in the hotness history file.

    -> ({cbsa: {rdm_hotness, rdm_supply_score, rdm_demand_score, flag}}, month_label or None). `flag` is the publisher's
    hotness quality flag; the caller folds it into rdm_low_quality. A newest month other than as_of returns ({}, month).
    """
    wanted = ["month_date_yyyymm", "cbsa_code", "quality_flag"] + list(HOTNESS_COLUMNS.values())
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        head = core.header(reader, wanted, "metro hotness")
        i_month, i_key, i_flag = head.index("month_date_yyyymm"), head.index("cbsa_code"), head.index("quality_flag")
        cols = {f: head.index(c) for f, c in HOTNESS_COLUMNS.items()}
        latest, newest = "", []
        for row in reader:
            if len(row) < len(head):
                continue
            month = row[i_month].strip()
            if not core.is_month(month):
                continue
            if month > latest:
                latest, newest = month, []
            if month == latest:
                newest.append(row)
    if not latest:
        raise SourceUnavailable("Realtor.com metro hotness file has no monthly rows")
    month = core.month_label(latest)
    if month != as_of:
        return {}, month
    out = {}
    for row in newest:
        key = core.cbsa_key(row[i_key])
        if key is None:
            continue
        rec = {}
        for field, i in cols.items():
            val = num(row[i])
            if val is not None:
                rec[field] = round(val, 1)
        if rec:
            rec["flag"] = core.flag_of(row[i_flag])
            out[key] = rec
    return out, month


def parse_history(path, keys, months=HIST_MONTHS):
    """Last `months` months of rdm_active, rdm_dom and rdm_price_reduced_share per CBSA in `keys`, oldest first.

    Months the publisher flags as thin (quality_flag 1) are left out of the series, so a chart shows a gap, not a guess.
    -> (hist, flagged_points).
    """
    wanted = ["month_date_yyyymm", "cbsa_code", "quality_flag"] + [c for c, _ in HIST_COLUMNS.values()]
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        head = core.header(reader, wanted, "metro history")
        i_month, i_key, i_flag = head.index("month_date_yyyymm"), head.index("cbsa_code"), head.index("quality_flag")
        cols = {f: (head.index(c), kind) for f, (c, kind) in HIST_COLUMNS.items()}
        by_month, flagged = {}, 0
        for row in reader:
            if len(row) < len(head):
                continue
            month = row[i_month].strip()
            if not core.is_month(month):
                continue
            key = core.cbsa_key(row[i_key])
            if key is None or key not in keys:
                continue
            by_month.setdefault(month, []).append((key, row))
    window = sorted(by_month)[-months:]
    series = {}
    for month in window:
        label = core.month_label(month)
        for key, row in by_month[month]:
            if core.flag_of(row[i_flag]) == 1:
                flagged += 1
                continue
            for field, (i, kind) in cols.items():
                val = core.convert(row[i], kind)
                if val is not None:
                    series.setdefault(key, {}).setdefault(field, []).append([label, val])
    hist = {}
    for key, fields in series.items():
        kept = {f: pts for f, pts in fields.items() if len(pts) >= 2}
        if kept:
            hist[key] = kept
    return hist, flagged


def load(ctx):
    path, meta = ctx.fetch(CORE_URL, "metro.csv", timeout=120, min_bytes=100_000)
    data, rows, as_of, info = parse(path)
    notes = ["Realtor.com flagged %d of %d metros as thin data and the rows are kept with rdm_low_quality = 1"
             % (info["flagged"], len(data))]
    if info["no_key"]:
        notes.append("%d row with no CBSA code (a national total) was skipped" % info["no_key"])
    ctx.log("%d metro rows for %s (%s)" % (len(data), as_of, meta.get("status")))

    hist, thin_points = {}, 0
    try:
        hot_path, hot_meta = ctx.fetch(HOTNESS_URL, "hotness_history.csv", timeout=180, min_bytes=1 << 20)
        t0 = time.time()
        hot, hot_month = parse_hotness(hot_path, as_of)
        ctx.log("%d hotness rows for %s in %.0fs (%s)" % (len(hot), hot_month, time.time() - t0, hot_meta.get("status")))
        if hot:
            for key, rec in hot.items():
                if key not in data:
                    continue
                flag = rec.pop("flag", None)
                data[key].update(rec)
                if flag == 1:
                    data[key]["rdm_low_quality"] = 1
            notes.append("hotness covers the %d largest metros only" % len(hot))
        else:
            notes.append("hotness skipped: its newest month is %s, not %s" % (hot_month, as_of))
    except SourceUnavailable as exc:
        notes.append("hotness unavailable (%s)" % exc)

    try:
        hist_path, hist_meta = ctx.fetch(HISTORY_URL, "metro_history.csv", timeout=300, min_bytes=1 << 20)
        t0 = time.time()
        hist, thin_points = parse_history(hist_path, set(data))
        ctx.log("history for %d metros in %.0fs (%s)" % (len(hist), time.time() - t0, hist_meta.get("status")))
        notes.append("charts leave out %d metro-months the publisher flags as thin" % thin_points)
    except SourceUnavailable as exc:
        notes.append("history unavailable (%s)" % exc)

    return {"as_of": as_of, "rows": rows, "data": data, "hist": hist,
            "note": "Source month %s. %s. Shares and year-over-year changes are percent." % (as_of, "; ".join(notes))}
