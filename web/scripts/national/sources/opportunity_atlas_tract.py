"""Opportunity Atlas (Opportunity Insights): adult income rank of children who grew up in low-income homes, by census tract. Level "tract".

One 34 MB CSV (about 73,000 tracts, 2010 census tract ids split over state, county and tract columns, children born 1978 to 1983).
kfr_pooled_pooled_p25 is the mean income rank (0 to 1) at age 26 of children whose parents were at the 25th income percentile;
the source shows it as 0 to 100. Tracts with no estimate are left out.
"""
import csv
import time

from ctx import SourceUnavailable, num

URL = "https://opportunityinsights.org/wp-content/uploads/2018/10/tract_outcomes_simple.csv"
MIN_TRACTS = 30000  # about 73,000 tracts

SOURCE = {
    "id": "opportunity_atlas_tract",
    "name": "Opportunity Atlas children's income rank by tract",
    "publisher": "Opportunity Insights (Harvard), US Census Bureau data",
    "homepage": "https://opportunityinsights.org/data/",
    "level": "tract",
    "native": "tract",
    "tract_vintage": 2010,
    "group": "people",
    "cadence": "one-off release (2018)",
    "license": "Opportunity Insights public data release; cite Chetty, Friedman, Hendren, Jones and Porter (2018)",
    "key_env": None,
    "fields": {
        "opp_child_income_p25": {"label": "Adult income rank of kids from lower-income homes", "unit": "score",
                                 "agg": "pop_weighted_mean", "metric": "schools", "xwalk": "mean", "better": "higher"},
    },
}


def parse(path):
    """-> (data, rows, as_of). data[2010 tract GEOID] = {opp_child_income_p25: 0 to 100}."""
    data, rows = {}, 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            head = [h.strip() for h in next(reader)]
        except StopIteration:
            raise SourceUnavailable("Opportunity Atlas file is empty")
        missing = [c for c in ("state", "county", "tract", "kfr_pooled_pooled_p25") if c not in head]
        if missing:
            raise SourceUnavailable("Opportunity Atlas header changed: %s missing" % ", ".join(missing))
        i_s, i_c, i_t, i_v = (head.index(c) for c in ("state", "county", "tract", "kfr_pooled_pooled_p25"))
        for row in reader:
            if len(row) <= max(i_s, i_c, i_t, i_v):
                continue
            rows += 1
            val = num(row[i_v])
            if val is None or not (row[i_s].strip().isdigit() and row[i_c].strip().isdigit() and row[i_t].strip().isdigit()):
                continue
            geoid = row[i_s].strip().zfill(2) + row[i_c].strip().zfill(3) + row[i_t].strip().zfill(6)
            data[geoid] = {"opp_child_income_p25": round(val * 100, 1)}
    if len(data) < MIN_TRACTS:
        raise SourceUnavailable("Opportunity Atlas parsed to %d tracts with an estimate (expected about 70,000)" % len(data))
    return data, rows, "2018 release (children born 1978-1983)"


def load(ctx):
    path, meta = ctx.fetch(URL, "tract_outcomes_simple.csv", timeout=180, min_bytes=1 << 20)
    t0 = time.time()
    data, rows, as_of = parse(path)
    ctx.log("%d rows, %d tracts in %.0fs (%s)" % (rows, len(data), time.time() - t0, meta.get("status")))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Outcomes of children born 1978 to 1983 on 2010 tract boundaries; a one-off 2018 release."}
