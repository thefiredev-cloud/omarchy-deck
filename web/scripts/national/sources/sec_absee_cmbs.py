"""SEC ABS-EE commercial mortgage (CMBS) asset data: occupancy, NOI, value, DSCR and delinquency of the properties behind
conduit and single-asset CMBS trusts, rolled up to the property ZIP. Source tag: cmbs.

How it runs (all through ctx, 1 request per second to sec.gov as the SEC fair-access policy asks):
1. The quarterly EDGAR form index lists every ABS-EE filing. The newest filing of each trust in the last 75 days is the snapshot.
2. A trust is CMBS when its submission header says `ABS ASSET CLASS: Commercial mortgages`. Names that are plainly CMBS skip the
   check; unknown names get a 4 KB range request, remembered per trust. Names that are plainly auto, card or student loans are skipped.
3. The full submission .txt of a CMBS filing is cached forever (a filing never changes). Its EX-102 asset XML is parsed once and the
   property rows are cached next to it as JSON, so a warm run only reads small files.
"""
import json
import os
import re
import statistics
import time
import xml.etree.ElementTree as ET

from ctx import SourceUnavailable, num

TYPES = {"office": ("OF",), "retail": ("RT",), "industrial": ("IN", "WH"), "multifamily": ("MF",), "hotel": ("LO",)}
SQFT_TYPES = ("office", "retail", "industrial")
LATE_LABEL = "on loans 30 days or more late, or non-performing at maturity"


def _fields():
    out = {
        "cmbs_props": {"label": "CMBS properties", "unit": "count", "agg": "sum"},
        "cmbs_occ_median": {"label": "CMBS property occupancy, median", "unit": "pct", "agg": "pop_weighted_median",
                            "better": "higher"},
        "cmbs_cap_rate": {"label": "CMBS implied cap rate (NOI over appraised value)", "unit": "pct", "agg": "pop_weighted_mean"},
        "cmbs_noi_psf_median": {"label": "CMBS net operating income per square foot, median", "unit": "usd_sqft",
                                "agg": "pop_weighted_median"},
        "cmbs_dscr_median": {"label": "CMBS debt service coverage, median", "unit": "ratio", "agg": "pop_weighted_median",
                             "better": "higher"},
        "cmbs_delinq_share": {"label": "CMBS properties " + LATE_LABEL, "unit": "pct", "agg": "pop_weighted_mean",
                              "better": "lower"},
        "cmbs_status_known": {"label": "CMBS properties whose loan reports a payment status", "unit": "count",
                              "agg": "sum"},
    }
    for name in TYPES:
        out["cmbs_%s_props" % name] = {"label": "CMBS %s properties" % name, "unit": "count", "agg": "sum"}
        out["cmbs_%s_occ" % name] = {"label": "CMBS %s occupancy, median" % name, "unit": "pct", "agg": "pop_weighted_median",
                                     "better": "higher"}
        out["cmbs_%s_cap" % name] = {"label": "CMBS %s implied cap rate" % name, "unit": "pct", "agg": "pop_weighted_mean"}
        if name in SQFT_TYPES:
            out["cmbs_%s_noi_psf" % name] = {"label": "CMBS %s NOI per square foot, median" % name, "unit": "usd_sqft",
                                             "agg": "pop_weighted_median"}
    out["cmbs_office_delinq"] = {"label": "CMBS office properties " + LATE_LABEL, "unit": "pct",
                                 "agg": "pop_weighted_mean", "better": "lower"}
    out["cmbs_retail_delinq"] = {"label": "CMBS retail properties " + LATE_LABEL, "unit": "pct",
                                 "agg": "pop_weighted_mean", "better": "lower"}
    return out


SOURCE = {
    "id": "sec_absee_cmbs",
    "name": "SEC ABS-EE commercial mortgage trusts, property performance by ZIP",
    "publisher": "US Securities and Exchange Commission (EDGAR)",
    "homepage": "https://www.sec.gov/edgar/search/",
    "level": "zip",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public filings (SEC fair access policy: 10 requests a second at most, declared User-Agent)",
    "key_env": None,
    "fields": _fields(),
}
INDEX = "https://www.sec.gov/Archives/edgar/full-index/%d/QTR%d/form.idx"
ARCHIVE = "https://www.sec.gov/Archives/"
WINDOW_DAYS = 75
PACE = 1.05  # seconds between sec.gov requests (the spec allows 1 per second)
FOREVER = 10 ** 10
# paymentStatusLoanCode, from the SEC EDGAR ABS XML Technical Specification v3.2 (March 2025), section 4.3.20 PYMNT_STAT_LOAN_CODE_TYPE:
#   0 Current; 1 30-59 days delinquent; 2 60-89 days delinquent; 3 90+ days delinquent; 4 Performing matured balloon;
#   5 Non performing matured balloon; A Payment not received but still in grace period or not yet due;
#   B Late payment but less than 30 days delinquent. The specification has no other code (none for 120+ days or foreclosure).
DELINQUENT = ("1", "2", "3", "5")  # 30 days or more late, or non-performing at maturity
NOT_DELINQUENT = ("0", "4", "A", "B")  # current, performing at maturity, in grace, or late by under 30 days
STRONG = re.compile(
    r"COMMERCIAL MORTGAGE|^BENCHMARK|^BANK\b|^BANK5|^BMO\b|^BBCMS|^GS MORTGAGE SECURITIES|MORGAN STANLEY CAPITAL I\b|^CSAIL|"
    r"^DBJPM|^JPMBB|^JPMCC|^JPMDB|^MSBAM|^COMM\b|^CD \d{4}|^3650R|^CFCRE|^CGCMT|^UBS|^WFRBS|^SG COMMERCIAL|^DBUBS|^BAMLL", re.I)
SKIP = re.compile(r"AUTO|RECEIVABLES|CREDIT CARD|STUDENT|EQUIPMENT|LEASE|DEALER|FLOORPLAN|TRUCK|MASTER TRUST|OWNER TRUST|"
                  r"CARVANA|CARMAX|HONDA|TOYOTA|HYUNDAI|NISSAN|FORD CREDIT|HARLEY|NAVIENT|SLM |NELNET", re.I)


def _pace(started, status):
    """Hold the 1-request-per-second line after a call that really hit sec.gov."""
    if status != "cached":
        wait = PACE - (time.monotonic() - started)
        if wait > 0:
            time.sleep(wait)


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_index(path, today=None):
    """form.idx -> {cik: [(date, name, 'edgar/data/...txt'), ...]} for ABS-EE rows filed in the last WINDOW_DAYS, newest first."""
    import datetime
    today = today or datetime.date.today()
    cutoff = (today - datetime.timedelta(days=WINDOW_DAYS)).isoformat()
    out, seen_header = {}, False
    row = re.compile(r"^ABS-EE\S*\s+(.+?)\s+(\d+)\s+(\d{4}-\d\d-\d\d)\s+(edgar/\S+\.txt)\s*$")
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            if line.startswith("Form Type"):
                seen_header = True
                continue
            match = row.match(line) if line.startswith("ABS-EE") else None
            if match and match.group(3) >= cutoff:
                out.setdefault(match.group(2), []).append((match.group(3), match.group(1), match.group(4)))
    if not seen_header:
        raise SourceUnavailable("EDGAR form index header not found")
    for rows in out.values():
        rows.sort(reverse=True)
    return out


def header_fields(text):
    """Asset class, period of report and trust name from the SEC-HEADER of a submission (or its first bytes)."""
    def grab(label):
        match = re.search(label + r":\s*([^\n]+)", text)
        return match.group(1).strip() if match else None
    return {"asset_class": grab("ABS ASSET CLASS"), "period": grab("CONFORMED PERIOD OF REPORT"),
            "name": grab("COMPANY CONFORMED NAME")}


def _annualise(noi, start, end):
    """NOI for a part-year period scaled to 12 months; whole-year or unknown periods pass through."""
    import datetime
    try:
        a = datetime.datetime.strptime(start, "%m-%d-%Y")
        b = datetime.datetime.strptime(end, "%m-%d-%Y")
    except (TypeError, ValueError):
        return noi
    days = (b - a).days + 1
    return noi * 365.0 / days if 25 <= days <= 340 else noi


def _property_zip(value):
    """A 5-digit ZIP from a filing's property ZIP field; 4 digits get their lost leading zero. Anything shorter is junk, not a ZIP."""
    digits = re.sub(r"\D", "", str(value or "").split("-")[0])
    if len(digits) == 4:
        digits = "0" + digits
    return digits if len(digits) == 5 and digits >= "00501" else None  # no US ZIP sorts below 00501


def _delinquent(status):
    """True for a delinquent status code, False for a code that is not, None for a missing or unlisted code (never counted as current)."""
    code = (status or "").strip().upper()
    if code in DELINQUENT:
        return True
    if code in NOT_DELINQUENT:
        return False
    return None


def _pick(rec, *names):
    for n in names:
        v = num(rec.get(n))
        if v is not None:
            return v
    return None


def parse_submission(path):
    """One submission .txt -> (header dict, property rows). A row is a dict: zip, type, nra, noi, occ, value, dscr, delinq."""
    with open(path, encoding="utf8", errors="replace") as fh:
        text = fh.read()
    head = header_fields(text[:6000])
    start = text.find("<assetData")
    end = text.rfind("</assetData>")
    if start < 0 or end < 0:
        raise SourceUnavailable("submission has no EX-102 asset data")
    try:
        root = ET.fromstring(text[start:end + len("</assetData>")])
    except ET.ParseError as exc:
        raise SourceUnavailable("EX-102 is not valid XML (%s)" % str(exc)[:60])
    rows = []
    for asset in root:
        loan = {_local(c.tag): (c.text or "").strip() for c in asset if len(c) == 0}
        props = [p for p in asset if _local(p.tag) == "property"] or [asset]  # some filers nest the property, some do not
        status = loan.get("paymentStatusLoanCode")
        for prop in props:
            rec = {_local(c.tag): (c.text or "").strip() for c in prop}
            zipcode = _property_zip(rec.get("propertyZip"))
            if not zipcode:
                continue
            noi = _pick(rec, "mostRecentNetOperatingIncomeAmount", "netOperatingIncomeSecuritizationAmount")
            if noi is not None and rec.get("mostRecentNetOperatingIncomeAmount"):
                noi = _annualise(noi, rec.get("mostRecentFinancialsStartDate"), rec.get("mostRecentFinancialsEndDate"))
            if not noi:  # servicers write 0 for a figure they did not report (co-op loans, for one)
                noi = None
            occ = _pick(rec, "mostRecentPhysicalOccupancyPercentage", "physicalOccupancySecuritizationPercentage")
            if occ is not None:
                occ = occ * 100.0 if occ <= 1.5 else occ
                occ = occ if 0 < occ <= 100 else None  # 0 means not reported
            rows.append({
                "zip": zipcode,
                "type": rec.get("propertyTypeCode") or None,
                "nra": _pick(rec, "netRentableSquareFeetNumber", "netRentableSquareFeetSecuritizationNumber"),
                "noi": noi,
                "occ": occ,
                "value": _pick(rec, "mostRecentValuationAmount", "valuationSecuritizationAmount"),
                "dscr": _pick(rec, "mostRecentDebtServiceCoverageNetOperatingIncomePercentage",
                              "debtServiceCoverageNetOperatingIncomeSecuritizationPercentage"),
                "delinq": _delinquent(status),
            })
    if not rows:
        raise SourceUnavailable("EX-102 had no properties with a ZIP")
    return head, rows


def _median(values, digits):
    return round(statistics.median(values), digits) if values else None


def _group(rows, sqft=True):
    """Roll property rows of one group into the plugin metrics (any may be None)."""
    occ = [r["occ"] for r in rows if r["occ"] is not None]
    priced = [r for r in rows if r["noi"] is not None and r["value"] and r["value"] > 0]
    cap = round(100.0 * sum(r["noi"] for r in priced) / sum(r["value"] for r in priced), 2) if priced else None
    psf = [r["noi"] / r["nra"] for r in rows if r["noi"] is not None and r["nra"] and r["nra"] > 0] if sqft else []
    dscr = [r["dscr"] for r in rows if r["dscr"] is not None and r["dscr"] > 0]
    known = [r for r in rows if r["delinq"] is not None]
    delinq = round(100.0 * sum(1 for r in known if r["delinq"]) / len(known), 1) if known else None
    return {"props": len(rows), "occ": _median(occ, 1), "cap": cap, "psf": _median(psf, 2), "dscr": _median(dscr, 2),
            "delinq": delinq, "known": len(known)}


def aggregate(rows):
    """All property rows -> data[zip]."""
    by_zip = {}
    for r in rows:
        if r["zip"] >= "00501":  # rows cached by an earlier read may carry a padded junk ZIP
            by_zip.setdefault(r["zip"], []).append(r)
    kind = {code: name for name, codes in TYPES.items() for code in codes}
    data = {}
    for z, props in by_zip.items():
        allg = _group(props)
        rec = {"cmbs_props": allg["props"], "cmbs_occ_median": allg["occ"], "cmbs_cap_rate": allg["cap"],
               "cmbs_noi_psf_median": allg["psf"], "cmbs_dscr_median": allg["dscr"], "cmbs_delinq_share": allg["delinq"],
               "cmbs_status_known": allg["known"]}
        for name in TYPES:
            sub = [p for p in props if kind.get(p["type"]) == name]
            g = _group(sub, sqft=name in SQFT_TYPES)
            rec["cmbs_%s_props" % name] = g["props"]
            rec["cmbs_%s_occ" % name] = g["occ"]
            rec["cmbs_%s_cap" % name] = g["cap"]
            if name in SQFT_TYPES:
                rec["cmbs_%s_noi_psf" % name] = g["psf"]
        for name in ("office", "retail"):
            rec["cmbs_%s_delinq" % name] = _group([p for p in props if kind.get(p["type"]) == name])["delinq"]
        data[z] = rec
    return data


def parse(paths):
    """Submission .txt path(s) -> (data, rows, as_of): the plugin's ZIP data from those filings."""
    if isinstance(paths, str):
        paths = [paths]
    rows, periods = [], []
    for path in paths:
        head, props = parse_submission(path)
        rows.extend(props)
        if head.get("period"):
            periods.append(head["period"])
    stamp = None
    if periods:
        p = max(periods)
        stamp = "%s-%s-%s" % (p[:4], p[4:6], p[6:8])
    return aggregate(rows), len(rows), stamp


# ------------------------------------------------------------------ network part

def _quarters(today):
    """Quarter indexes to read: the current one, plus the previous one while the window still reaches into it."""
    import datetime
    out = [(today.year, (today.month - 1) // 3 + 1)]
    back = today - datetime.timedelta(days=WINDOW_DAYS)
    prev = (back.year, (back.month - 1) // 3 + 1)
    if prev != out[0]:
        out.append(prev)
    return out


def _is_cmbs(ctx, cik, name_path):
    """True when the trust is CMBS. Remembered per trust in the cache folder (a trust never changes asset class)."""
    mark = os.path.join(ctx.cache_dir, "class_%s.json" % cik)
    if os.path.exists(mark):
        with open(mark, encoding="utf8") as fh:
            return json.load(fh).get("cmbs")
    started = time.monotonic()
    path, meta = ctx.fetch(ARCHIVE + name_path, "head_%s.txt" % cik, min_age=FOREVER, timeout=60, headers={"Range": "bytes=0-4095"})
    _pace(started, meta.get("status"))
    with open(path, encoding="utf8", errors="replace") as fh:
        head = header_fields(fh.read())
    cmbs = (head.get("asset_class") or "").lower().startswith("commercial mortgage")
    with open(mark, "w", encoding="utf8") as fh:
        json.dump({"cmbs": cmbs, "asset_class": head.get("asset_class")}, fh)
    return cmbs


def _filing_rows(ctx, cik, filings):
    """Property rows of the newest usable filing of one trust: (rows, period) or None when it is not CMBS or has no data."""
    for date, name, name_path in filings:
        adsh = os.path.basename(name_path)[:-4]
        cache = os.path.join(ctx.cache_dir, "props_%s.json" % adsh)
        if os.path.exists(cache):
            with open(cache, encoding="utf8") as fh:
                saved = json.load(fh)
            if saved.get("rows"):
                return saved["rows"], saved.get("period")
            continue
        if not STRONG.search(name) and not _is_cmbs(ctx, cik, name_path):
            return None
        started = time.monotonic()
        try:
            path, meta = ctx.fetch(ARCHIVE + name_path, "sub_%s.txt" % adsh, min_age=FOREVER, timeout=180)
        except SourceUnavailable as exc:
            ctx.log("%s: %s" % (name, exc))
            continue
        _pace(started, meta.get("status"))
        try:
            head, rows = parse_submission(path)
        except SourceUnavailable as exc:
            ctx.log("%s %s: %s" % (name, adsh, exc))
            with open(cache, "w", encoding="utf8") as fh:
                json.dump({"rows": [], "reason": str(exc)}, fh)
            continue
        if not (head.get("asset_class") or "").lower().startswith("commercial mortgage"):
            return None
        with open(cache, "w", encoding="utf8") as fh:
            json.dump({"rows": rows, "period": head.get("period"), "name": name}, fh)
        return rows, head.get("period")
    return None


def load(ctx):
    import datetime
    today = datetime.date.today()
    filings = {}
    for year, quarter in _quarters(today):
        started = time.monotonic()
        try:
            path, meta = ctx.fetch(INDEX % (year, quarter), "form_%d_q%d.idx" % (year, quarter), timeout=300, min_bytes=1000)
        except SourceUnavailable as exc:
            if (year, quarter) == _quarters(today)[0]:
                raise
            ctx.log("previous quarter index: %s" % exc)
            continue
        _pace(started, meta.get("status"))
        for cik, rows in parse_index(path, today).items():
            filings.setdefault(cik, []).extend(rows)
    if not filings:
        raise SourceUnavailable("no ABS-EE filings in the last %d days" % WINDOW_DAYS)
    candidates = {cik: sorted(rows, reverse=True) for cik, rows in filings.items() if not SKIP.search(rows[0][1])}
    all_rows, periods, trusts = [], [], 0
    for cik, rows in sorted(candidates.items()):
        got = _filing_rows(ctx, cik, rows)
        if got:
            all_rows.extend(got[0])
            periods.append(got[1] or "")
            trusts += 1
    if trusts < 50 or len(all_rows) < 3000:
        raise SourceUnavailable("only %d CMBS trusts and %d properties could be read" % (trusts, len(all_rows)))
    data = aggregate(all_rows)
    stamp = max(p for p in periods if p)
    return {"as_of": "%s-%s-%s" % (stamp[:4], stamp[4:6], stamp[6:8]), "rows": len(all_rows), "data": data,
            "note": "Newest monthly filing of %d CMBS trusts. Property rows with no ZIP are left out. Delinquent means 30 days or more late or non-performing at maturity (SEC payment status codes 1, 2, 3, 5); properties whose loan reports no status are left out of the share." % trusts}
