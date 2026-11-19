"""HUD FHA-insured apartment loans by maturity date per ZIP: loans, homes and unpaid principal maturing within 2 and 5
years, a refinance or sale trigger. Reads the active insured mortgage file. Source tag: fham."""
import datetime

import _fha_bf90 as bf90
import _federal_layers as fed
from ctx import SourceUnavailable

NOTE = ("Active FHA-insured apartment loans (HUD business type MF Residential) whose maturity date falls between today and "
        "2 or 5 years out. Unpaid principal is HUD's amortized balance on the current month's schedule. FHA apartment loans "
        "run 35 to 40 years and fully amortize, so loans near maturity are old loans with small balances; most borrowers "
        "refinance or sell well before maturity.")
MIN_ACTIVE = 8000  # the active file held 15,776 loans on 2026-10-31

SOURCE = {
    "id": "fha_mf_maturity",
    "name": "HUD FHA-insured apartment loan maturities",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": bf90.PAGE,
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fham_loans_maturing_5y": {"label": "FHA-insured apartment loans maturing within 5 years", "unit": "count", "agg": "sum"},
        "fham_units_maturing_5y": {"label": "Apartment homes on FHA loans maturing within 5 years", "unit": "count", "agg": "sum"},
        "fham_upb_maturing_5y": {"label": "Unpaid principal on FHA apartment loans maturing within 5 years (HUD amortized balance)",
                                 "unit": "usd", "agg": "sum"},
        "fham_loans_maturing_2y": {"label": "FHA-insured apartment loans maturing within 2 years", "unit": "count", "agg": "sum"},
    },
}


def aggregate(active, today=None):
    """Active loan rows -> {zip: fields}. Every ZIP with an active insured apartment loan gets a record; a loan already past
    its maturity date is not counted as maturing."""
    today = today or datetime.date.today()
    five, two = fed.add_years(today, 5), fed.add_years(today, 2)
    blank = {name: 0 for name in SOURCE["fields"]}
    data = {}
    for loan in active:
        if loan["business"] != bf90.RESIDENTIAL or not loan["zip"]:
            continue
        rec = data.setdefault(loan["zip"], dict(blank))
        end = loan["maturity"]
        if not end or not today <= end <= five:
            continue
        rec["fham_loans_maturing_5y"] += 1
        rec["fham_units_maturing_5y"] += loan["units"] or 0
        rec["fham_upb_maturing_5y"] += loan["upb"] or 0
        if end <= two:
            rec["fham_loans_maturing_2y"] += 1
    return data


def parse(path, today=None):
    """Active insured mortgage file -> (data, rows read, as_of month)."""
    active = bf90.loans(path)
    if len(active) < MIN_ACTIVE:
        raise SourceUnavailable("active insured mortgage file has %d loans, expected at least %d" % (len(active), MIN_ACTIVE))
    if not any(loan["upb"] is not None for loan in active):
        raise SourceUnavailable("active insured mortgage file has no unpaid principal column")
    data = aggregate(active, today)
    if not data:
        raise SourceUnavailable("active insured mortgage file had no apartment loans with a ZIP")
    return data, len(active), bf90.latest_endorsement(active).strftime("%Y-%m")


def load(ctx):
    data, rows, as_of = parse(bf90.fetch(ctx))
    return {"as_of": as_of, "rows": rows, "data": data, "note": NOTE}
