"""Eviction Lab (Princeton) county eviction filing estimates, 2000 to 2018. Level "county".

One 4 MB CSV with a row per county per year. Keeps the newest year (2018) and shows filings divided by renter households as a
percent. The data stops in 2018; the label says so.
"""
import csv

from ctx import SourceUnavailable, num

URL = "https://eviction-lab-data-downloads.s3.amazonaws.com/estimating-eviction-prevalance-across-us/county_eviction_estimates_2000_2018.csv"
MIN_COUNTIES = 1000  # about 3,100 counties

SOURCE = {
    "id": "eviction_lab_county",
    "name": "Eviction Lab eviction filing estimates by county",
    "publisher": "Eviction Lab, Princeton University",
    "homepage": "https://evictionlab.org/eviction-tracking/",
    "level": "county",
    "native": "county",
    "group": "people",
    "cadence": "one-off release (data through 2018)",
    "license": "Eviction Lab data, free to use with citation to Eviction Lab",
    "key_env": None,
    "fields": {
        "eviction_filing_rate": {"label": "Eviction filings per 100 renter homes (2018, county)", "unit": "pct",
                                 "agg": "pop_weighted_mean", "xwalk": "mean", "better": "lower"},
    },
}


def parse(path):
    """-> (data, rows, as_of year). Counties with no renter households or no filing estimate in the newest year are left out."""
    by_year, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("Eviction Lab file is empty")
        need = ("FIPS_county", "year", "renting_hh", "filings_estimate")
        missing = [c for c in need if c not in head]
        if missing:
            raise SourceUnavailable("Eviction Lab header changed: %s missing" % ", ".join(missing))
        i_f, i_y, i_h, i_e = (head.index(c) for c in need)
        for row in reader:
            if len(row) <= max(i_f, i_y, i_h, i_e):
                continue
            rows += 1
            fips, year = row[i_f].strip(), row[i_y].strip()
            if len(fips) != 5 or not fips.isdigit() or not year.isdigit():
                continue
            by_year.setdefault(int(year), {})[fips] = (num(row[i_h]), num(row[i_e]))
    if not by_year:
        raise SourceUnavailable("Eviction Lab file had no county rows")
    latest = max(by_year)
    data = {}
    for fips, (households, filings) in by_year[latest].items():
        if households and households > 0 and filings is not None:
            data[fips] = {"eviction_filing_rate": round(filings / households * 100, 2)}
    if len(data) < MIN_COUNTIES:
        raise SourceUnavailable("Eviction Lab parsed to %d counties for %d (expected about 3,000)" % (len(data), latest))
    return data, rows, str(latest)


def load(ctx):
    path, meta = ctx.fetch(URL, "county.csv", timeout=120, min_bytes=100000)
    data, rows, as_of = parse(path)
    ctx.log("%d rows, %d counties for %s (%s)" % (rows, len(data), as_of, meta.get("status")))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Eviction Lab's county estimates stop in 2018; filings are modeled estimates, not court counts everywhere."}
