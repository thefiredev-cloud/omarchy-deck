"""IRS Statistics of Income, individual returns by ZIP code and size of adjusted gross income (the `zpallagi` file).
Level "zip". One row per ZIP and income bracket (agi_stub 1 to 6); this source adds the brackets up per ZIP.
Dollar columns (A-prefixed) are published in thousands of dollars; every dollar field here is whole dollars."""
import csv

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "irs_soi_zip",
    "name": "IRS Statistics of Income: individual returns by ZIP code",
    "publisher": "IRS Statistics of Income",
    "homepage": "https://www.irs.gov/statistics/soi-tax-stats-individual-income-tax-statistics-zip-code-data-soi",
    "level": "zip",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "irs_returns": {"label": "Individual tax returns filed", "unit": "count", "agg": "sum"},
        "irs_agi_per_return": {"label": "Average adjusted gross income per return", "unit": "usd", "agg": "pop_weighted_mean",
                               "better": "higher", "metric": "income"},
        "irs_wage_share": {"label": "Wages as a share of total income", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_sched_c_share": {"label": "Returns with business income (Schedule C), per 100 returns", "unit": "pct",
                              "agg": "pop_weighted_mean"},
        "irs_over100k_share": {"label": "Returns with AGI of $100,000 or more", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_over200k_share": {"label": "Returns with AGI of $200,000 or more", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_itemizer_share": {"label": "Returns that itemize deductions", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_re_tax_share": {"label": "Returns deducting real estate taxes", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_re_tax_avg": {"label": "Average real estate tax deducted", "unit": "usd", "agg": "pop_weighted_mean"},
        "irs_mortgage_int_avg": {"label": "Average mortgage interest deducted", "unit": "usd", "agg": "pop_weighted_mean"},
        "irs_cap_gains_per_return": {"label": "Average capital gains per return", "unit": "usd", "agg": "pop_weighted_mean"},
        "irs_returns_yoy": {"label": "Change in returns filed, year over year", "unit": "pct", "agg": "pop_weighted_mean"},
        "irs_agi_per_return_yoy": {"label": "Change in average AGI per return, year over year", "unit": "pct",
                                   "agg": "pop_weighted_mean", "metric": "income_trend", "better": "higher"},
    },
}

URL = "https://www.irs.gov/pub/irs-soi/%szpallagi.csv"
MIN_ROWS = 80000  # the national file has about 166,000 rows (27,700 ZIPs x 6 brackets)
SUMS = ("N1", "A00100", "A02650", "A00200", "N00900", "N04470", "N18500", "A18500", "N19300", "A19300", "A01000")


def parse(path):
    """-> ({zip: sums}, row count). Sums are over the six AGI brackets; ZIP 00000 (state totals) and 99999 (other) are
    dropped. `hi` and `top` count returns with AGI of $100,000+ and $200,000+."""
    out, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head or "zipcode" not in head or "agi_stub" not in head:
            raise SourceUnavailable("IRS ZIP file has no zipcode and agi_stub columns")
        col = {name: i for i, name in enumerate(head)}
        missing = [c for c in SUMS if c not in col]
        if missing:
            raise SourceUnavailable("IRS ZIP file is missing columns %s" % ", ".join(missing))
        iz, ist = col["zipcode"], col["agi_stub"]
        for row in reader:
            if len(row) <= max(col[c] for c in SUMS):
                continue
            rows += 1
            z = zfill_zip(row[iz])
            if not z or z in ("00000", "99999"):
                continue
            rec = out.get(z)
            if rec is None:
                rec = out[z] = dict.fromkeys(SUMS + ("hi", "top"), 0.0)
            n1 = num(row[col["N1"]]) or 0.0
            for c in SUMS:
                rec[c] += num(row[col[c]]) or 0.0
            stub = row[ist].strip()
            if stub in ("5", "6"):
                rec["hi"] += n1
            if stub == "6":
                rec["top"] += n1
    if rows < MIN_ROWS:
        raise SourceUnavailable("IRS ZIP file has only %d rows (expected about 166,000)" % rows)
    return out, rows


def _ratio(top, bottom, scale=1.0, nd=2):
    if not bottom:
        return None
    return round(top / bottom * scale, nd)


def derive(cur, prior=None):
    """Clean fields from the bracket sums of one ZIP (`prior` is the same ZIP a year earlier, or None)."""
    n1 = cur["N1"]
    agi = _ratio(cur["A00100"] * 1000, n1, 1, 0)
    out = {
        "irs_returns": int(n1) if n1 else None,
        "irs_agi_per_return": agi,
        "irs_wage_share": _ratio(cur["A00200"], cur["A02650"], 100),
        "irs_sched_c_share": _ratio(cur["N00900"], n1, 100),
        "irs_over100k_share": _ratio(cur["hi"], n1, 100),
        "irs_over200k_share": _ratio(cur["top"], n1, 100),
        "irs_itemizer_share": _ratio(cur["N04470"], n1, 100),
        "irs_re_tax_share": _ratio(cur["N18500"], n1, 100),
        "irs_re_tax_avg": _ratio(cur["A18500"] * 1000, cur["N18500"], 1, 0),
        "irs_mortgage_int_avg": _ratio(cur["A19300"] * 1000, cur["N19300"], 1, 0),
        "irs_cap_gains_per_return": _ratio(cur["A01000"] * 1000, n1, 1, 0),
        "irs_returns_yoy": None,
        "irs_agi_per_return_yoy": None,
    }
    if prior and prior["N1"] and n1:
        out["irs_returns_yoy"] = round((n1 / prior["N1"] - 1) * 100, 2)
        before = prior["A00100"] / prior["N1"]
        if before:
            out["irs_agi_per_return_yoy"] = round((cur["A00100"] / n1 / before - 1) * 100, 2)
    return out


def build(cur, prior):
    return {z: derive(rec, (prior or {}).get(z)) for z, rec in cur.items() if rec["N1"]}


def load(ctx):
    candidates = [(str(y)[2:], y) for y in (ctx.year - 2, ctx.year - 3, ctx.year - 4)]  # file prefix, tax year
    tag = year = path = None
    for tag, year in candidates:
        try:
            path, _ = ctx.fetch(URL % tag, "%szpallagi.csv" % tag, timeout=900)
            break
        except SourceUnavailable as exc:
            ctx.log("TY%d not available (%s)" % (year, exc))
    if path is None:
        raise SourceUnavailable("no IRS zpallagi file answered for tax years %s" % ", ".join(str(y) for _, y in candidates))
    cur, rows = parse(path)
    prior = None
    try:
        prior_path, _ = ctx.fetch(URL % ("%02d" % (int(tag) - 1)), "%02dzpallagi.csv" % (int(tag) - 1), timeout=900)
        prior, _ = parse(prior_path)
    except SourceUnavailable as exc:
        ctx.log("prior year not used: %s" % exc)
    data = build(cur, prior)
    note = "Tax year %d. Dollar figures are for returns filed from the ZIP; small ZIPs are grouped by the IRS." % year
    return {"as_of": str(year), "rows": rows, "data": data, "note": note}
