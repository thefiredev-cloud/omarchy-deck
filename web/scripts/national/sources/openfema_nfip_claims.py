"""FEMA NFIP redacted flood claims (OpenFEMA v3): claims and dollars paid per ZIP over the last 10 full years."""
import csv
import time
from collections import defaultdict

import _openfema
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "openfema_nfip_claims",
    "name": "FEMA flood insurance claims by ZIP, last 10 years",
    "publisher": "FEMA, National Flood Insurance Program (OpenFEMA)",
    "homepage": "https://www.fema.gov/openfema-data-page/nfip-redacted-claims-v3",
    "level": "zip",
    "group": "risk",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "nfip_claims_10y": {"label": "Flood claims, last 10 years", "unit": "count", "agg": "sum",
                            "metric": "flood_risk", "better": "lower"},
        "nfip_claims_paid_10y": {"label": "Flood claims that paid out, last 10 years", "unit": "count", "agg": "sum",
                                 "better": "lower"},
        "nfip_paid_10y": {"label": "Flood claims paid, last 10 years", "unit": "usd", "agg": "sum", "better": "lower"},
        "nfip_nonres_claims_10y": {"label": "Non-residential flood claims, last 10 years", "unit": "count",
                                   "agg": "sum", "metric": "commercial_risk", "better": "lower"},
        "nfip_peak_year": {"label": "Year with the most flood claims", "unit": "year", "agg": "none"},
    },
}
ENTITY = "v3/NfipClaims"
SELECT = ("id,reportedZipCode,yearOfLoss,occupancyType,netBuildingPaymentAmount,netContentsPaymentAmount,"
          "netIccPaymentAmount")
TOP = 100000
WINDOW_YEARS = 10
MIN_ROWS = 200000  # about 590,000 claims in a 10-year window
CLOSED_AGE = 90 * 86400  # a year of loss two or more calendar years back no longer changes in any way that matters
DEADLINE_S = 780
# occupancyType codes the OpenFEMA dictionary calls non-residential: 4 and 6 (legacy), 17, 18, 19 (Risk Rating 2.0)
NONRES = {4, 6, 17, 18, 19}


def parse(paths, min_rows=MIN_ROWS):
    """Claims csv pages -> ({zip: {field: value}}, rows, as_of). Counts every claim, sums building, contents and ICC dollars."""
    count, paid_n, paid_usd, nonres = defaultdict(int), defaultdict(int), defaultdict(float), defaultdict(int)
    by_year = defaultdict(lambda: defaultdict(int))
    rows, years = 0, set()
    for path in paths:
        with open(path, newline="", encoding="utf8") as fh:
            reader = csv.DictReader(fh)
            need = {"reportedZipCode", "yearOfLoss", "occupancyType", "netBuildingPaymentAmount"}
            if not need <= set(reader.fieldnames or []):
                raise SourceUnavailable("FEMA claims page has unexpected columns")
            for row in reader:
                rows += 1
                year = num(row.get("yearOfLoss"))
                if year is None:
                    continue
                years.add(int(year))
                zip5 = _openfema.zip5(row.get("reportedZipCode"))
                if not zip5:
                    continue
                total = sum(num(row.get(col)) or 0.0 for col in
                            ("netBuildingPaymentAmount", "netContentsPaymentAmount", "netIccPaymentAmount"))
                count[zip5] += 1
                by_year[zip5][int(year)] += 1
                paid_usd[zip5] += total
                if total > 0:
                    paid_n[zip5] += 1
                if num(row.get("occupancyType")) in NONRES:
                    nonres[zip5] += 1
    if rows < min_rows:
        raise SourceUnavailable("FEMA claims window has %d rows, expected about 590,000" % rows)
    data = {}
    for zip5, n in count.items():
        peak = max(by_year[zip5].items(), key=lambda kv: (kv[1], kv[0]))[0]
        data[zip5] = {"nfip_claims_10y": n, "nfip_claims_paid_10y": paid_n[zip5],
                      "nfip_paid_10y": int(round(paid_usd[zip5])), "nfip_nonres_claims_10y": nonres[zip5],
                      "nfip_peak_year": peak}
    as_of = "%d-%d" % (min(years), max(years)) if years else None
    return data, rows, as_of


def load(ctx):
    t0 = time.time()
    last_year = ctx.year - 1
    first_year = last_year - WINDOW_YEARS + 1
    paths = []
    for year in range(first_year, last_year + 1):
        age = CLOSED_AGE if year <= ctx.year - 2 else 20 * 3600
        paths += list(_openfema.keyset_pages(ctx, ENTITY, SELECT, "yearOfLoss eq %d" % year, "claims_%d" % year, TOP,
                                             age, t0, DEADLINE_S))
    data, rows, _ = parse(paths)
    return {"as_of": "%d-%d" % (first_year, last_year), "rows": rows, "data": data,
            "note": "Claims by year of loss, counted by the ZIP the insurer reported. Dollars are net building, contents and compliance payments."}
