"""FEMA NFIP redacted policies (OpenFEMA v3): flood policies in force, average cost and high-risk-zone share per ZIP.

The table holds 74.7 million policy-term records. Policy terms last one year, so the policies in force on the first of the
data's as-of month are the records whose term started in the 12 calendar months before it (and has not ended early).
Those are fetched one calendar month at a time, so a closed month stays in the cache and a later run only refreshes the
newest months.
"""
import csv
import time
from collections import defaultdict

import _openfema
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "openfema_nfip_policies",
    "name": "FEMA flood insurance policies in force by ZIP",
    "publisher": "FEMA, National Flood Insurance Program (OpenFEMA)",
    "homepage": "https://www.fema.gov/openfema-data-page/nfip-redacted-policies-v3",
    "level": "zip",
    "group": "risk",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "nfip_policies": {"label": "Flood policies in force", "unit": "count", "agg": "sum"},
        "nfip_premium_avg": {"label": "Average yearly flood policy cost", "unit": "usd",
                             "agg": "pop_weighted_mean", "metric": "insurance_cost", "better": "lower"},
        "nfip_sfha_share": {"label": "Policies in high-risk flood zones", "unit": "pct", "agg": "pop_weighted_mean",
                            "metric": "flood_risk", "better": "lower"},
    },
}
ENTITY = "v3/NfipPolicies"
SELECT = "id,reportedZipCode,policyCount,policyCost,ratedFloodZone,policyTerminationDate"
TOP = 50000
MONTHS = 12
MIN_ROWS = 1000000  # about 3.5 million policy-term records in a year
MIN_POLICIES_FOR_AVERAGE = 10
SETTLED_AGE = 60 * 86400
DEADLINE_S = 780


def _month_start(year, month):
    return "%04d-%02d-01T00:00:00.000Z" % (year, month)


def _shift(year, month, delta):
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def parse(paths, in_force_on, min_rows=MIN_ROWS):
    """Policy csv pages -> ({zip: {field: value}}, rows, as_of). `in_force_on` is an ISO date: terms that ended earlier are skipped."""
    policies, records, cost, sfha, zoned = defaultdict(int), defaultdict(int), defaultdict(float), \
        defaultdict(int), defaultdict(int)
    rows = 0
    for path in paths:
        with open(path, newline="", encoding="utf8") as fh:
            reader = csv.DictReader(fh)
            need = {"reportedZipCode", "policyCount", "policyCost", "ratedFloodZone", "policyTerminationDate"}
            if not need <= set(reader.fieldnames or []):
                raise SourceUnavailable("FEMA policies page has unexpected columns")
            for row in reader:
                rows += 1
                zip5 = _openfema.zip5(row.get("reportedZipCode"))
                count = num(row.get("policyCount"))
                if not zip5 or not count or count < 1:
                    continue
                ended = (row.get("policyTerminationDate") or "")[:10]
                if ended and ended < in_force_on:
                    continue
                policies[zip5] += int(count)
                price = num(row.get("policyCost"))
                if price is not None and price > 0:
                    records[zip5] += 1
                    cost[zip5] += price
                zone = (row.get("ratedFloodZone") or "").strip().upper()
                if zone:
                    zoned[zip5] += int(count)
                    if zone[0] in "AV":
                        sfha[zip5] += int(count)
    if rows < min_rows:
        raise SourceUnavailable("FEMA policies window has %d rows, expected about 3.5 million" % rows)
    data = {}
    for zip5, n in policies.items():
        data[zip5] = {
            "nfip_policies": n,
            "nfip_premium_avg": int(round(cost[zip5] / records[zip5])) if records[zip5] >= MIN_POLICIES_FOR_AVERAGE else None,
            "nfip_sfha_share": round(100.0 * sfha[zip5] / zoned[zip5], 1) if zoned[zip5] else None,
        }
    return data, rows, in_force_on


def _as_of_date(ctx):
    url = _openfema.url(ENTITY, "id,asOfDate", "", 1, orderby="id desc")
    path, _ = ctx.fetch(url, "policies_as_of.csv", min_age=20 * 3600, timeout=60, min_bytes=10)
    with open(path, newline="", encoding="utf8") as fh:
        rows = list(csv.DictReader(fh))
    stamp = (rows[0].get("asOfDate") if rows else "") or ""
    if len(stamp) < 10 or not stamp[:4].isdigit():
        raise SourceUnavailable("FEMA policies table did not state an as-of date")
    return stamp[:10]


def load(ctx):
    t0 = time.time()
    as_of = _as_of_date(ctx)
    end_y, end_m = int(as_of[:4]), int(as_of[5:7])
    in_force_on = "%04d-%02d-01" % (end_y, end_m)
    paths = []
    for back in range(MONTHS, 0, -1):
        y, m = _shift(end_y, end_m, -back)
        ny, nm = _shift(y, m, 1)
        flt = "policyEffectiveDate ge %s and policyEffectiveDate lt %s" % (_month_start(y, m), _month_start(ny, nm))
        age = SETTLED_AGE if back > 2 else 20 * 3600
        paths += list(_openfema.keyset_pages(ctx, ENTITY, SELECT, flt, "policies_%04d%02d" % (y, m), TOP, age, t0,
                                             DEADLINE_S, pause=0.5))
    data, rows, _ = parse(paths, in_force_on)
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Policies whose one-year term started in the 12 months before %s and has not ended; average cost counts ZIPs with 10 or more policies." % in_force_on}
