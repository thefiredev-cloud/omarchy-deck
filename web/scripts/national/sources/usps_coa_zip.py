"""USPS change-of-address statistics by ZIP (FOIA library): permanent and temporary address changes into and out of each
ZIP, monthly. Level "zip". The USPS stopped publishing this file after June 2023 (newer data is a paid service), so the
figures cover the last 12 months published. A ZIP counts only when it has a row for each of those 12 months; a missing
row is not read as zero."""
import csv

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "usps_coa_zip",
    "name": "USPS change-of-address moves by ZIP code",
    "publisher": "US Postal Service (FOIA library)",
    "homepage": "https://about.usps.com/who/legal/foia/library.htm",
    "level": "zip",
    "group": "people",
    "cadence": "static",
    "license": "Public domain (US government work); released under FOIA",
    "key_env": None,
    "fields": {
        "coa_net_moves_12m": {"label": "Net moves in, last 12 months published", "unit": "count", "agg": "sum", "better": "higher",
                              "metric": "migration"},
        "coa_moves_in_12m": {"label": "Moves in, last 12 months published", "unit": "count", "agg": "sum"},
        "coa_moves_out_12m": {"label": "Moves out, last 12 months published", "unit": "count", "agg": "sum"},
        "coa_business_out_12m": {"label": "Business moves out, last 12 months published", "unit": "count", "agg": "sum",
                                 "better": "lower"},
        "coa_business_net_12m": {"label": "Net business moves in, last 12 months published", "unit": "count", "agg": "sum",
                                 "better": "higher"},
    },
}

URL = "https://about.usps.com/who/legal/foia/documents/change-of-address-stats/Y%d.csv"
MIN_ZIPS = 15000  # about 26,000 ZIPs report
# column positions in the file: month, ZIP, city, state, then "from" (out) total, business, family, individual, perm, temp,
# then "to" (in) total, business, family, individual, perm, temp
I_MONTH, I_ZIP, I_OUT, I_OUT_BIZ, I_IN, I_IN_BIZ = 0, 1, 4, 5, 10, 11


def read_months(path):
    """-> {month 'YYYYMM': {zip: (out, in, business out, business in)}}."""
    out = {}
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.reader(fh)
        head = next(reader, None)
        if not head or len(head) < 16 or head[0].strip() != "YYYYMM" or head[1].strip() != "ZIPCODE":
            raise SourceUnavailable("the change-of-address file has no YYYYMM and ZIPCODE columns")
        for row in reader:
            if len(row) < 16 or not row[I_MONTH].strip().isdigit():
                continue
            z = zfill_zip(row[I_ZIP])
            vals = [num(row[i]) for i in (I_OUT, I_IN, I_OUT_BIZ, I_IN_BIZ)]
            if z and None not in vals:
                out.setdefault(row[I_MONTH].strip(), {})[z] = tuple(int(v) for v in vals)
    return out


def parse(paths):
    """`paths` are the yearly files (any order). -> (data, rows, last month 'YYYY-MM', first month 'YYYY-MM')."""
    months = {}
    for path in paths:
        for month, zips in read_months(path).items():
            months.setdefault(month, {}).update(zips)
    ordered = sorted(months)
    if len(ordered) < 12:
        raise SourceUnavailable("the change-of-address files cover only %d months" % len(ordered))
    window = ordered[-12:]
    first_i = int(window[0][:4]) * 12 + int(window[0][4:]) - 1
    last_i = int(window[-1][:4]) * 12 + int(window[-1][4:]) - 1
    if last_i - first_i != 11:
        raise SourceUnavailable("the last 12 change-of-address months are not consecutive")
    sums, seen, rows = {}, {}, 0
    for month in window:
        for z, (out, inn, out_biz, in_biz) in months[month].items():
            rows += 1
            acc = sums.setdefault(z, [0, 0, 0, 0])
            for i, v in enumerate((out, inn, out_biz, in_biz)):
                acc[i] += v
            seen[z] = seen.get(z, 0) + 1
    data = {}
    for z, (out, inn, out_biz, in_biz) in sums.items():
        if seen[z] == 12:
            data[z] = {"coa_net_moves_12m": inn - out, "coa_moves_in_12m": inn, "coa_moves_out_12m": out,
                       "coa_business_out_12m": out_biz, "coa_business_net_12m": in_biz - out_biz}
    if len(data) < MIN_ZIPS:
        raise SourceUnavailable("only %d ZIPs have all 12 months of change-of-address data (expected about 24,000)" % len(data))
    return data, rows, "%s-%s" % (window[-1][:4], window[-1][4:]), "%s-%s" % (window[0][:4], window[0][4:])


def load(ctx):
    paths, year = [], None
    for y in (ctx.year, ctx.year - 1, ctx.year - 2, ctx.year - 3):
        try:
            path, _ = ctx.fetch(URL % y, "Y%d.csv" % y)
        except SourceUnavailable:
            continue
        year = y
        paths.append(path)
        break
    if year is None:
        raise SourceUnavailable("no change-of-address file answered")
    path, _ = ctx.fetch(URL % (year - 1), "Y%d.csv" % (year - 1))
    paths.append(path)
    data, rows, last, first = parse(paths)
    return {"as_of": last, "rows": rows, "data": data,
            "note": "The USPS stopped publishing this file after %s; figures cover %s to %s." % (last, first, last)}
