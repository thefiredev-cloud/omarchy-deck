"""NCUA 5300 call report quarterly data: credit union offices and headquarters balance sheets per ZIP. Source tag: ncua.
One zip per quarter (about 8 MB). Offices come from "Credit Union Branch Information.txt" (physical ZIP of every corporate
and branch office). Assets, shares and members come from FS220.txt and sit on the headquarters ZIP in FOICU.txt, because a
credit union reports one balance sheet for all its offices. Complements the FDIC branch file, which has banks only."""
import csv
import io
import time
import zipfile

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://ncua.gov/files/publications/analysis/call-report-data-%04d-%02d.zip"
MIN_OFFICES = 10000  # about 23,000 offices
MIN_CREDIT_UNIONS = 2000  # about 4,300 credit unions

SOURCE = {
    "id": "ncua_call_report",
    "name": "NCUA call report: credit union offices and headquarters balance sheets by ZIP",
    "publisher": "National Credit Union Administration",
    "homepage": "https://ncua.gov/analysis/credit-union-corporate-call-report-data/quarterly-data",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "side": "commercial",
    "cadence": "quarterly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "ncua_offices": {"label": "Credit union offices", "unit": "count", "agg": "sum"},
        "ncua_credit_unions": {"label": "Credit unions with an office here", "unit": "count", "agg": "none"},
        "ncua_hq_assets": {"label": "Assets of credit unions headquartered here", "unit": "usd", "agg": "sum"},
        "ncua_hq_shares": {"label": "Member deposits of credit unions headquartered here", "unit": "usd", "agg": "sum"},
        "ncua_hq_members": {"label": "Members of credit unions headquartered here", "unit": "count", "agg": "sum"},
    },
}


def _member(zf, wanted):
    for name in zf.namelist():
        if name.lower() == wanted.lower():
            return name
    raise SourceUnavailable("NCUA zip has no %s" % wanted)


def _rows(zf, wanted):
    with zf.open(_member(zf, wanted)) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))


def _cycle(text):
    """'6/30/2026 0:00:00' -> '2026-06-30'."""
    try:
        month, day, year = text.split()[0].split("/")
        return "%04d-%02d-%02d" % (int(year), int(month), int(day))
    except ValueError:
        return None


def parse(path):
    """NCUA call report zip -> (data {zip: fields}, office rows + credit union rows read, as_of 'YYYY-MM-DD')."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise SourceUnavailable("NCUA call report file is not a zip (%s)" % exc)
    with zf:
        data, as_of, rows = {}, None, 0
        offices, cu_seen = 0, set()
        for row in _rows(zf, "Credit Union Branch Information.txt"):
            zipc = zfill_zip((row.get("PhysicalAddressPostalCode") or "")[:5])
            cu = (row.get("CU_NUMBER") or "").strip()
            rows += 1
            if not zipc or not cu:
                continue
            rec = data.setdefault(zipc, {"ncua_offices": 0, "_cus": set()})
            rec["ncua_offices"] += 1
            rec["_cus"].add(cu)
            offices += 1
            cu_seen.add(cu)
        if offices < MIN_OFFICES:
            raise SourceUnavailable("NCUA branch file had %d offices with a ZIP, expected over %d" % (offices, MIN_OFFICES))
        hq = {}
        for row in _rows(zf, "FOICU.txt"):
            cu = (row.get("CU_NUMBER") or "").strip()
            zipc = zfill_zip((row.get("ZIP_CODE") or "")[:5])
            as_of = as_of or _cycle(row.get("CYCLE_DATE") or "")
            if cu and zipc:
                hq[cu] = zipc
        books = 0
        for row in _rows(zf, "FS220.txt"):
            cu = (row.get("CU_NUMBER") or "").strip()
            zipc = hq.get(cu)
            assets, shares, members = num(row.get("ACCT_010")), num(row.get("ACCT_018")), num(row.get("ACCT_083"))
            if not zipc or assets is None:
                continue
            rec = data.setdefault(zipc, {"_cus": set()})
            rec["ncua_hq_assets"] = rec.get("ncua_hq_assets", 0) + int(assets)
            if shares is not None:
                rec["ncua_hq_shares"] = rec.get("ncua_hq_shares", 0) + int(shares)
            if members is not None:
                rec["ncua_hq_members"] = rec.get("ncua_hq_members", 0) + int(members)
            books += 1
        if books < MIN_CREDIT_UNIONS:
            raise SourceUnavailable("NCUA FS220 had %d credit unions with assets, expected over %d" % (books, MIN_CREDIT_UNIONS))
        if not as_of:
            raise SourceUnavailable("NCUA FOICU file carries no cycle date")
        rows += len(hq) + books
    for rec in data.values():
        cus = rec.pop("_cus")
        if rec.get("ncua_offices"):
            rec["ncua_credit_unions"] = len(cus)
    return data, rows, as_of


def _quarters(now):
    """Quarter-end (year, month) pairs from the newest one that can exist back six quarters."""
    year, month = now.tm_year, (now.tm_mon // 3) * 3
    if month == 0:
        year, month = year - 1, 12
    out = []
    for _ in range(6):
        out.append((year, month))
        month -= 3
        if month == 0:
            year, month = year - 1, 12
    return out


def load(ctx):
    reasons = []
    for year, month in _quarters(time.gmtime()):
        name = "call-report-%04d-%02d.zip" % (year, month)
        try:
            path, _ = ctx.fetch(URL % (year, month), name, timeout=600)
        except SourceUnavailable as exc:
            reasons.append("%04d-%02d: %s" % (year, month, exc))
            continue
        data, rows, as_of = parse(path)
        note = "Offices sit on their physical ZIP. Assets, deposits and members of a credit union are counted once, on its headquarters ZIP."
        return {"as_of": as_of, "rows": rows, "data": data, "note": note}
    raise SourceUnavailable("no NCUA call report zip found: " + "; ".join(reasons)[:200])
