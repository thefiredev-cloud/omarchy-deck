"""HUD FHA multifamily initial endorsements per ZIP, last 5 years: new insured apartment loans, dollars, homes, new
construction and refinance. Reads the active and terminated insured mortgage files together, so a loan endorsed in the
window and already paid off still counts. Source tag: fhae."""
import _fha_bf90 as bf90
import _federal_layers as fed
from ctx import SourceUnavailable

# Section of the Act codes, apartment loans only (BUSINESS_TYPE "MF Residential").
NEW_CONSTRUCTION = ("OMI", "OMR", "OMC", "MMI", "LUR", "QER", "YHC")
REFINANCE_EXACT = ("HRI", "HRK", "YHE", "YHF", "YHN", "YQE", "YQR", "YFE")
REFINANCE_PREFIX = ("RE", "RF")  # every 223(a)(7) code
NOTE = ("Apartment loans only (HUD business type MF Residential, no nursing homes or hospitals). New construction counts "
        "Section of the Act codes OMI, OMR, OMC (221(d)(4), which also covers substantial rehab), MMI (221(d)(3)), LUR (220), "
        "QER (231) and YHC (542(c) new construction); refinance counts HRI and HRK (223(f), which includes purchases), "
        "every RE and RF code (223(a)(7)) and YHE, YHF, YHN, YQE, YQR, YFE (542(b) and 542(c) existing and recently "
        "completed). The 5 years end at the newest endorsement in the file.")
MIN_ACTIVE = 8000  # the active file held 15,776 loans on 2026-10-31

SOURCE = {
    "id": "fha_mf_endorsements",
    "name": "HUD FHA multifamily initial endorsements",
    "publisher": "US Department of Housing and Urban Development",
    "homepage": bf90.PAGE,
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fhae_loans_5y": {"label": "FHA-insured apartment loans endorsed, last 5 years", "unit": "count", "agg": "sum"},
        "fhae_amount_5y": {"label": "FHA-insured apartment loan dollars endorsed, last 5 years (original amount)",
                           "unit": "usd", "agg": "sum"},
        "fhae_units_5y": {"label": "Apartment homes financed by FHA-insured loans, last 5 years", "unit": "count", "agg": "sum"},
        "fhae_new_construction_units_5y": {"label": "Apartment homes in FHA new construction loans (221(d)(4) and similar), last 5 years",
                                           "unit": "count", "agg": "sum"},
        "fhae_refi_loans_5y": {"label": "FHA apartment refinance and purchase loans (223(f), 223(a)(7)), last 5 years",
                               "unit": "count", "agg": "sum"},
    },
}


def is_new_construction(soa):
    return soa in NEW_CONSTRUCTION


def is_refinance(soa):
    return soa in REFINANCE_EXACT or soa.startswith(REFINANCE_PREFIX)


def aggregate(active, terminated=(), end=None):
    """Loan rows -> {zip: fields}. Every ZIP with an active insured apartment loan gets a record (0 when nothing was endorsed
    there in the window); a ZIP with only a terminated loan endorsed in the window gets one too."""
    end = end or bf90.latest_endorsement(list(active) + list(terminated))
    start = fed.add_years(end, -5)
    data, seen = {}, set()
    blank = {name: 0 for name in SOURCE["fields"]}
    for loan in active:
        if loan["business"] == bf90.RESIDENTIAL and loan["zip"]:
            data.setdefault(loan["zip"], dict(blank))
    for loan in list(active) + list(terminated):
        key = (loan["number"], loan["ie"])
        if (loan["business"] != bf90.RESIDENTIAL or not loan["zip"] or not loan["ie"] or key in seen
                or not start < loan["ie"] <= end):
            continue
        seen.add(key)
        rec = data.setdefault(loan["zip"], dict(blank))
        rec["fhae_loans_5y"] += 1
        rec["fhae_amount_5y"] += loan["amount"] or 0
        rec["fhae_units_5y"] += loan["units"] or 0
        if is_new_construction(loan["soa"]):
            rec["fhae_new_construction_units_5y"] += loan["units"] or 0
        if is_refinance(loan["soa"]):
            rec["fhae_refi_loans_5y"] += 1
    return data, end


def parse(path, terminated=None):
    """Active file (and optionally the terminated file) -> (data, rows read, as_of month)."""
    active = bf90.loans(path)
    if len(active) < MIN_ACTIVE:
        raise SourceUnavailable("active insured mortgage file has %d loans, expected at least %d" % (len(active), MIN_ACTIVE))
    ended = bf90.loans(terminated) if terminated else []
    data, end = aggregate(active, ended)
    if not data:
        raise SourceUnavailable("insured mortgage files had no apartment loans with a ZIP")
    return data, len(active) + len(ended), end.strftime("%Y-%m")


def load(ctx):
    data, rows, as_of = parse(bf90.fetch(ctx), bf90.fetch(ctx, terminated=True))
    return {"as_of": as_of, "rows": rows, "data": data, "note": NOTE}
