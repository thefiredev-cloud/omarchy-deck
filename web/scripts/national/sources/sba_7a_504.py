"""SBA 7(a) and 504 loan FOIA files: owner-occupied commercial real estate and small business lending per borrower ZIP.
504 loans fund owner-occupied commercial property, so 504 counts and dollars are a direct commercial lending signal.
Source tag: sba. Streams two large CSVs (60 MB and 190 MB) one after the other."""
import csv
import re

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "sba_7a_504",
    "name": "SBA 7(a) and 504 loans by borrower ZIP, last 5 years",
    "publisher": "US Small Business Administration",
    "homepage": "https://data.sba.gov/dataset/7a-504-foia",
    "level": "zip",
    "group": "commercial",
    "cadence": "quarterly",
    "license": "Public FOIA release (US government work)",
    "key_env": None,
    "fields": {
        "sba504_loans_5y": {"label": "SBA 504 property loans, 5 years", "unit": "count", "agg": "sum"},
        "sba504_dollars_5y": {"label": "SBA 504 loan dollars, 5 years", "unit": "usd", "agg": "sum"},
        "sba7a_loans_5y": {"label": "SBA 7(a) loans, 5 years", "unit": "count", "agg": "sum"},
        "sba7a_dollars_5y": {"label": "SBA 7(a) loan dollars, 5 years", "unit": "usd", "agg": "sum"},
        "sba_jobs_5y": {"label": "Jobs supported by SBA loans, 5 years", "unit": "count", "agg": "sum"},
        "sba_chargeoff_rate": {"label": "Share of SBA loan dollars charged off", "unit": "pct", "agg": "pop_weighted_mean",
                               "better": "lower"},
    },
}
PAGE = "https://data.sba.gov/dataset/7a-504-foia"
FILES = (("504", r"FOIA_504_FY2010_Present[^\"'\s<>]*\.csv", "FOIA_504.csv"),
         ("7a", r"FOIA_7a_FY2020_Present[^\"'\s<>]*\.csv", "FOIA_7a.csv"))
NOT_APPROVED = ("CANCLD", "NOT FUNDED")  # cancelled or never funded loans are not lending in the ZIP
NEED = {"AsOfDate", "Program", "BorrZip", "GrossApproval", "ApprovalDate", "LoanStatus", "GrossChargeOffAmount", "JobsSupported"}


def _window_start(as_of):
    """Date five years before the file's as-of date, as an ISO string."""
    match = re.fullmatch(r"(\d{4})-(\d\d)-(\d\d)", as_of or "")
    if not match:
        raise SourceUnavailable("SBA AsOfDate is not a date")
    return "%04d-%s-%s" % (int(match.group(1)) - 5, match.group(2), match.group(3))


def _scan(path, acc):
    """Add one FOIA file to acc (raw sums per ZIP). Returns (rows, as_of)."""
    rows, as_of = 0, None
    with open(path, newline="", encoding="latin-1") as fh:
        reader = csv.DictReader(fh)
        if not NEED <= set(reader.fieldnames or ()):
            raise SourceUnavailable("SBA header changed (needs %s)" % ", ".join(sorted(NEED - set(reader.fieldnames or ()))))
        start = None
        for row in reader:
            rows += 1
            if start is None:
                as_of = row["AsOfDate"].strip()
                start = _window_start(as_of)
            if row["ApprovalDate"] <= start or row["LoanStatus"].strip() in NOT_APPROVED:
                continue
            z = zfill_zip(row["BorrZip"])
            amount = num(row["GrossApproval"])
            if not z or amount is None:
                continue
            program = "504" if row["Program"].strip() == "504" else "7a"
            rec = acc.setdefault(z, {"504_n": 0, "504_usd": 0.0, "7a_n": 0, "7a_usd": 0.0, "jobs": 0.0, "chg_usd": 0.0})
            rec[program + "_n"] += 1
            rec[program + "_usd"] += amount
            rec["jobs"] += num(row["JobsSupported"]) or 0
            rec["chg_usd"] += num(row["GrossChargeOffAmount"]) or 0
    return rows, as_of


def parse(paths):
    """One FOIA file path or a list of them -> (data, rows, as_of). Window: approvals in the 5 years before the as-of date."""
    if isinstance(paths, str):
        paths = [paths]
    acc, rows, as_of = {}, 0, None
    for path in paths:
        n, stamp = _scan(path, acc)
        rows += n
        as_of = max(as_of or stamp, stamp) if stamp else as_of
    data = {}
    for z, rec in acc.items():
        total = rec["504_usd"] + rec["7a_usd"]
        data[z] = {
            "sba504_loans_5y": rec["504_n"], "sba504_dollars_5y": round(rec["504_usd"]),
            "sba7a_loans_5y": rec["7a_n"], "sba7a_dollars_5y": round(rec["7a_usd"]),
            "sba_jobs_5y": int(rec["jobs"]),
            "sba_chargeoff_rate": round(100.0 * rec["chg_usd"] / total, 2) if total else None,
        }
    if not data:
        raise SourceUnavailable("SBA files had no loans in the 5-year window")
    return data, rows, as_of


def load(ctx):
    page, _ = ctx.fetch(PAGE, "foia_page.html", timeout=60, min_bytes=1000)
    with open(page, encoding="utf8", errors="replace") as fh:
        html = fh.read()
    paths = []
    for program, pattern, name in FILES:  # one big download at a time
        links = sorted(set(re.findall(r"https://data\.sba\.gov/[^\"'\s<>]*" + pattern, html)))
        if not links:
            raise SourceUnavailable("SBA dataset page lists no %s file" % program)
        path, _ = ctx.fetch(links[-1], name, timeout=900)
        paths.append(path)
    data, rows, as_of = parse(paths)
    if rows < 100000 or len(data) < 10000:
        raise SourceUnavailable("SBA files parsed to %d rows and %d ZIPs" % (rows, len(data)))
    return {"as_of": as_of, "rows": rows, "data": data,
            "note": "Loans approved in the 5 years before the as-of date, by borrower ZIP. Cancelled and unfunded loans are left out."}
