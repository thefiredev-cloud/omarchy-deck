"""Shared helper for the HUD insured multifamily mortgage files (FHA-BF90-RM-A active, FHA-BF90-RM-T terminated), read by
fha_mf_endorsements and fha_mf_maturity. Both workbooks download once into the shared `fha_mf_loans` cache folder.
Not a source: the leading underscore tells the runner to skip it (SPEC rule 12)."""
import datetime
import os

import _hud
from ctx import Ctx, SourceUnavailable, num, zfill_zip

PAGE = "https://www.hud.gov/hud-partners/multifamily-fhasl-active"
ACTIVE_URL = "https://www.hud.gov/sites/default/files/Housing/documents/FHA-BF90-RM-A.xlsx"
TERMINATED_URL = "https://www.hud.gov/sites/default/files/Housing/documents/FHA-BF90-RM-T.xlsx"
RESIDENTIAL = "MF Residential"  # BUSINESS_TYPE of apartment loans; the files also hold MF Healthcare and MF Hospitals
EXCEL_EPOCH = datetime.date(1899, 12, 30)
COLUMNS = {"number": "HUD PROJECT NUMBER", "zip": "PROPERTY ZIP", "units": "UNITS", "ie": "INITIAL ENDORSEMENT DATE",
           "amount": "ORIGINAL MORTGAGE AMOUNT", "maturity": "MATURITY DATE", "upb": "AMORITIZED PRINCIPAL BALANCE",
           "soa": "SECTION OF ACT CODE", "business": "BUSINESS_TYPE"}
REQUIRED = ("number", "zip", "units", "ie", "amount", "maturity", "soa", "business")


def shared_ctx(ctx):
    """A context that caches in the shared fha_mf_loans folder next to this source's own cache folder."""
    return Ctx("fha_mf_loans", force=ctx.force, cache_root=os.path.dirname(ctx.cache_dir), quiet=ctx.quiet)


def fetch(ctx, terminated=False):
    url, name = (TERMINATED_URL, "bf90_terminated.xlsx") if terminated else (ACTIVE_URL, "bf90_active.xlsx")
    path, _ = shared_ctx(ctx).fetch(url, name, timeout=600, min_bytes=100000)
    return path


def excel_day(value):
    """Excel serial day number ('46295.0') -> datetime.date, else None."""
    n = num(value)
    if n is None or n <= 0:
        return None
    try:
        return EXCEL_EPOCH + datetime.timedelta(days=int(n))
    except OverflowError:
        return None


def loans(path):
    """Workbook -> list of loan dicts: number, zip, units, ie, amount, maturity, upb (None in the terminated file),
    soa, business. Row 1 is a title, the header row names HUD PROJECT NUMBER."""
    out, index = [], None
    for row in _hud.rows(path):
        if index is None:
            if "HUD PROJECT NUMBER" in row:
                index = {key: row.index(col) for key, col in COLUMNS.items() if col in row}
                missing = [COLUMNS[k] for k in REQUIRED if k not in index]
                if missing:
                    raise SourceUnavailable("insured mortgage file lacks columns %s" % ", ".join(missing))
            continue
        cell = lambda key: row[index[key]] if key in index and index[key] < len(row) else ""  # noqa: E731
        if not cell("number"):
            continue
        units = num(cell("units"))
        amount, upb = num(cell("amount")), num(cell("upb"))
        out.append({"number": cell("number").strip(), "zip": zfill_zip(cell("zip")),
                    "units": int(units) if units is not None and units > 0 else None,
                    "ie": excel_day(cell("ie")), "amount": round(amount) if amount is not None and amount > 0 else None,
                    "maturity": excel_day(cell("maturity")), "upb": round(upb) if upb is not None and upb >= 0 else None,
                    "soa": cell("soa").strip().upper(), "business": cell("business").strip()})
    if index is None:
        raise SourceUnavailable("insured mortgage file has no HUD PROJECT NUMBER header")
    return out


def latest_endorsement(rows):
    """Newest initial endorsement date in the rows: the file's data month."""
    days = [r["ie"] for r in rows if r["ie"]]
    if not days:
        raise SourceUnavailable("insured mortgage file has no endorsement dates")
    return max(days)
