"""IRS Statistics of Income county-to-county migration (inflow and outflow files). Level "county".
A move is a tax return whose address changed county between two filing years. Each county has total rows in both files;
the total row of the inflow file is every return that moved in, of the outflow file every return that moved out.
Dollar columns are published in thousands of dollars; every dollar field here is whole dollars."""
import csv

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "irs_soi_county_migration",
    "name": "IRS county-to-county migration: tax returns moving in and out",
    "publisher": "IRS Statistics of Income",
    "homepage": "https://www.irs.gov/statistics/soi-tax-stats-migration-data",
    "level": "county",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "irs_mig_in_returns": {"label": "Tax returns that moved in", "unit": "count", "agg": "sum"},
        "irs_mig_out_returns": {"label": "Tax returns that moved out", "unit": "count", "agg": "sum"},
        "irs_mig_net_returns": {"label": "Net tax returns moving in", "unit": "count", "agg": "sum", "xwalk": "sum"},
        "irs_mig_net_rate": {"label": "Net moves in, as a share of the county's returns", "unit": "pct", "agg": "pop_weighted_mean",
                             "better": "higher", "xwalk": "assign", "metric": "migration"},
        "irs_mig_net_other_state": {"label": "Net tax returns moving in from other states", "unit": "count", "agg": "sum"},
        "irs_mig_net_agi": {"label": "Net adjusted gross income moving in", "unit": "usd", "agg": "sum"},
        "irs_mig_in_agi_per_return": {"label": "Average income of returns moving in", "unit": "usd", "agg": "pop_weighted_mean",
                                      "xwalk": "assign"},
        "irs_mig_out_agi_per_return": {"label": "Average income of returns moving out", "unit": "usd", "agg": "pop_weighted_mean",
                                       "xwalk": "assign"},
    },
}

BASE = "https://www.irs.gov/pub/irs-soi/county%s%s.csv"
MIN_COUNTIES = 2500  # about 3,100 counties


def parse_flow(path, own):
    """Total rows of one flow file -> {fips: {total, other_state, nonmig}}, each value (returns, agi in $ thousands).
    `own` is "y2" for the inflow file (the county is the destination) and "y1" for the outflow file."""
    other = "y1" if own == "y2" else "y2"
    out = {}
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        need = {own + "_statefips", own + "_countyfips", other + "_statefips", other + "_countyfips", "n1", "agi"}
        if not reader.fieldnames or not need <= set(reader.fieldnames):
            raise SourceUnavailable("IRS migration file is missing the columns %s" % ", ".join(sorted(need)))
        for row in reader:
            fips = (row[own + "_statefips"] or "").strip() + (row[own + "_countyfips"] or "").strip()
            if len(fips) != 5 or not fips.isdigit():
                continue
            o_state, o_county = row[other + "_statefips"].strip(), row[other + "_countyfips"].strip()
            n1, agi = num(row["n1"]), num(row["agi"])
            if n1 is None or n1 < 0 or agi is None or agi < 0:  # the IRS prints -1 for withheld cells
                continue
            rec = out.setdefault(fips, {})
            if (o_state, o_county) == ("96", "000"):
                rec["total"] = (n1, agi)
            elif (o_state, o_county) == ("97", "003"):
                rec["other_state"] = (n1, agi)
            elif row[other + "_countyname"].endswith("Non-migrants") and o_state == row[own + "_statefips"].strip():
                rec["nonmig"] = (n1, agi)
    return out


def _avg(pair):
    return round(pair[1] * 1000 / pair[0]) if pair and pair[0] else None


def parse(path_in, path_out):
    """-> (data by county FIPS, row count of counties with a total in either file)."""
    inflow, outflow = parse_flow(path_in, "y2"), parse_flow(path_out, "y1")
    if len(inflow) < MIN_COUNTIES or len(outflow) < MIN_COUNTIES:
        raise SourceUnavailable("IRS migration files hold %d and %d counties (expected about 3,100)" % (len(inflow), len(outflow)))
    data = {}
    for fips in sorted(set(inflow) | set(outflow)):
        i, o = inflow.get(fips, {}), outflow.get(fips, {})
        tin, tout = i.get("total"), o.get("total")
        row = dict.fromkeys(SOURCE["fields"])
        if tin:
            row["irs_mig_in_returns"] = int(tin[0])
            row["irs_mig_in_agi_per_return"] = _avg(tin)
        if tout:
            row["irs_mig_out_returns"] = int(tout[0])
            row["irs_mig_out_agi_per_return"] = _avg(tout)
        if tin and tout:
            row["irs_mig_net_returns"] = int(tin[0] - tout[0])
            row["irs_mig_net_agi"] = int((tin[1] - tout[1]) * 1000)
            base = (i.get("nonmig") or o.get("nonmig") or (None,))[0]
            if base is not None and base + tout[0] > 0:
                row["irs_mig_net_rate"] = round((tin[0] - tout[0]) / (base + tout[0]) * 100, 2)
        if i.get("other_state") and o.get("other_state"):
            row["irs_mig_net_other_state"] = int(i["other_state"][0] - o["other_state"][0])
        if any(v is not None for v in row.values()):
            data[fips] = row
    return data, len(data)


def load(ctx):
    pairs = [("%02d%02d" % (y % 100, (y + 1) % 100), y, y + 1) for y in (ctx.year - 2, ctx.year - 3, ctx.year - 4)]
    errors = []
    for tag, a, b in pairs:
        try:
            path_in, _ = ctx.fetch(BASE % ("inflow", tag), "inflow%s.csv" % tag)
            path_out, _ = ctx.fetch(BASE % ("outflow", tag), "outflow%s.csv" % tag)
        except SourceUnavailable as exc:
            errors.append("%s: %s" % (tag, exc))
            continue
        data, rows = parse(path_in, path_out)
        return {"as_of": "%d-%d" % (a, b), "rows": rows, "data": data,
                "note": "Moves of tax returns between counties; the IRS withholds small cells."}
    raise SourceUnavailable("; ".join(errors)[:300])
