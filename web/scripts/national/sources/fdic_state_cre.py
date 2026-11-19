"""FDIC call-report loan balances grouped by each bank's headquarters state.

These are bank portfolios, not loans located in the state. Nonfarm nonresidential
includes owner-occupied property (LNRENRES), unlike the narrower LNRENROT line.
"""
import datetime
import json
import os
import time
import urllib.parse

from ctx import SourceUnavailable, num

SOURCE = {
    "id": "fdic_state_cre",
    "name": "FDIC commercial real estate lending by bank headquarters state",
    "publisher": "Federal Deposit Insurance Corporation",
    "homepage": "https://api.fdic.gov/banks/docs/",
    "level": "state",
    "group": "commercial",
    "cadence": "quarterly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fdics_cre_loans": {
            "label": "Headquartered banks' commercial real estate loans", "unit": "usd", "agg": "sum",
            "note": "FDIC LNRENRES + LNREMULT + LNRECONS, thousands converted to dollars. LNRENRES includes owner-occupied nonfarm nonresidential property."},
        "fdics_cre_loans_yoy": {
            "label": "Headquartered banks' commercial real estate loans, 1-year change", "unit": "pct", "agg": "none",
            "note": "Change in state sums of FDIC LNRENRES + LNREMULT + LNRECONS from the same quarter last year."},
        "fdics_mf_loans": {
            "label": "Headquartered banks' multifamily loans", "unit": "usd", "agg": "sum",
            "note": "FDIC LNREMULT: loans secured by multifamily residential property with five or more units, thousands converted to dollars."},
        "fdics_mf_loans_yoy": {
            "label": "Headquartered banks' multifamily loans, 1-year change", "unit": "pct", "agg": "none",
            "note": "Change in state sums of FDIC LNREMULT from the same quarter last year."},
        "fdics_noncurrent_cre_rate": {
            "label": "Headquartered banks' noncurrent commercial real estate loan share", "unit": "pct", "agg": "none",
            "better": "lower",
            "note": "100 * sum(NCRENRES + NCREMULT + NCRECONS) / sum(LNRENRES + LNREMULT + LNRECONS), using only banks reporting all six lines. Published when those banks hold at least 90% of the state's CRE loan dollars. FDIC noncurrent means 90 or more days past due or nonaccrual."},
        "fdics_noncurrent_coverage": {
            "label": "CRE loan dollars covered by noncurrent reporting", "unit": "pct", "agg": "none",
            "note": "Share of the state's LNRENRES + LNREMULT + LNRECONS held by banks also reporting NCRENRES, NCREMULT and NCRECONS. Null when total state CRE is unknown or zero."},
        "fdics_construction_loans_yoy": {
            "label": "Headquartered banks' construction loans, 1-year change", "unit": "pct", "agg": "none",
            "note": "Change in state sums of FDIC LNRECONS, construction and land development loans, from the same quarter last year."},
    },
}
API = "https://api.fdic.gov/banks/financials"
PAGE = 1000
LOANS = ("LNRENRES", "LNREMULT", "LNRECONS")
NONCURRENT = ("NCRENRES", "NCREMULT", "NCRECONS")
MIN_COVERAGE = 0.9
CODES = LOANS + NONCURRENT
FIELDS = ",".join(("CERT", "REPDTE", "STALP") + CODES)
STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
NOTE = ("Bank portfolios are assigned to headquarters state (STALP), not the location of collateral. "
        "CRE includes owner-occupied nonfarm nonresidential, multifamily and construction loans. "
        "Yearly changes compare all reporting banks in each quarter, not a fixed bank cohort. "
        "Territories and records without a headquarters state are excluded. "
        "Noncurrent rates use only banks reporting both CRE and noncurrent balances, with at least 90% "
        "coverage of the state's CRE loan dollars. The reporting share is shown separately. "
        "Missing principal lines leave affected state totals and dependent ratios unavailable because "
        "their loan-dollar coverage cannot be established.")


def _body(path):
    try:
        with open(path, encoding="utf8") as fh:
            body = json.load(fh)
    except (ValueError, OSError) as exc:
        raise SourceUnavailable("FDIC financials page is not readable JSON") from exc
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise SourceUnavailable("FDIC financials page has no data array")
    return body


def _quarter(value):
    try:
        date = datetime.datetime.strptime(str(value), "%Y%m%d").date()
    except ValueError as exc:
        raise SourceUnavailable("FDIC financials has no valid report date") from exc
    if date.strftime("%m%d") not in ("0331", "0630", "0930", "1231"):
        raise SourceUnavailable("FDIC report date is not a quarter end")
    return date.strftime("%Y%m%d")


def parse(paths):
    """Read one quarter of API pages into state sums in publisher thousands."""
    if isinstance(paths, (str, os.PathLike)):
        paths = [paths]
    states, seen, quarter = {}, {}, None
    for path in paths:
        for item in _body(path)["data"]:
            row = item.get("data") if isinstance(item, dict) else None
            if not isinstance(row, dict) or not row.get("CERT"):
                raise SourceUnavailable("FDIC financials row has no bank")
            stamp = _quarter(row.get("REPDTE"))
            quarter = quarter or stamp
            if stamp != quarter:
                raise SourceUnavailable("FDIC financials pages mix report quarters")
            cert = str(row["CERT"])
            if cert in seen:
                if seen[cert] != row:
                    raise SourceUnavailable("FDIC financials has conflicting duplicate banks")
                continue
            seen[cert] = row
            state = str(row.get("STALP") or "").strip().upper()
            if state not in STATES:
                continue
            totals = states.setdefault(state, dict.fromkeys(LOANS + ("covered_cre", "covered_noncurrent"), 0))
            balances = {}
            for code in CODES:
                value = num(row.get(code))
                balances[code] = value if value is not None and value >= 0 else None
            for code in LOANS:
                value = balances[code]
                if value is None or totals[code] is None:
                    totals[code] = None
                else:
                    totals[code] += value
            cre, noncurrent = _sum(balances, LOANS), _sum(balances, NONCURRENT)
            if cre is not None and noncurrent is not None:
                totals["covered_cre"] += cre
                totals["covered_noncurrent"] += noncurrent
    if not states:
        raise SourceUnavailable("FDIC financials pages had no US state banks")
    return states, len(seen), quarter


def _sum(row, codes):
    values = [row.get(code) for code in codes]
    return None if any(value is None for value in values) else sum(values)


def _yoy(now, before):
    return round(100 * (now / before - 1), 4) if now is not None and before and before > 0 else None


def combine(current, prior):
    """Convert state balances to dollars and compute ratios of state sums."""
    data = {}
    for state, row in current.items():
        before = prior.get(state, {})
        cre, old_cre = _sum(row, LOANS), _sum(before, LOANS)
        covered_cre, noncurrent = row.get("covered_cre"), row.get("covered_noncurrent")
        coverage = covered_cre / cre if covered_cre is not None and cre else None
        mf = row.get("LNREMULT")
        data[state] = {
            "fdics_cre_loans": round(cre * 1000) if cre is not None else None,
            "fdics_cre_loans_yoy": _yoy(cre, old_cre),
            "fdics_mf_loans": round(mf * 1000) if mf is not None else None,
            "fdics_mf_loans_yoy": _yoy(mf, before.get("LNREMULT")),
            "fdics_noncurrent_cre_rate": round(100 * noncurrent / covered_cre, 4)
            if coverage is not None and coverage >= MIN_COVERAGE and covered_cre and noncurrent is not None else None,
            "fdics_noncurrent_coverage": round(100 * coverage, 4) if coverage is not None else None,
            "fdics_construction_loans_yoy": _yoy(row.get("LNRECONS"), before.get("LNRECONS")),
        }
    return data


def _fetch(ctx, query, name):
    # Waiting after the preceding response also limits warm-cache calls to 2/s.
    time.sleep(0.5)
    return ctx.fetch(API + "?" + urllib.parse.urlencode(query), name, timeout=180)[0]


def _pages(ctx, quarter):
    paths, offset, total = [], 0, None
    while total is None or offset < total:
        path = _fetch(ctx, {"filters": "REPDTE:" + quarter, "fields": FIELDS,
                            "sort_by": "CERT", "sort_order": "ASC", "limit": PAGE, "offset": offset},
                      "financials_%s_%d.json" % (quarter, offset))
        body = _body(path)
        count = (body.get("meta") or {}).get("total")
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            raise SourceUnavailable("FDIC financials quarter has no total")
        if total is not None and total != count:
            raise SourceUnavailable("FDIC financials total changed while paging")
        total = count
        if len(body["data"]) != min(PAGE, total - offset):
            raise SourceUnavailable("FDIC financials returned an incomplete page")
        paths.append(path)
        offset += len(body["data"])
    states, rows, stamp = parse(paths)
    if rows != total or stamp != quarter:
        raise SourceUnavailable("FDIC financials pages do not cover the requested quarter")
    return states, rows


def load(ctx):
    latest = _body(_fetch(ctx, {"fields": "REPDTE", "sort_by": "REPDTE", "sort_order": "DESC", "limit": 1},
                          "latest_quarter.json"))["data"]
    if not latest or not isinstance(latest[0].get("data"), dict):
        raise SourceUnavailable("FDIC financials did not publish a latest quarter")
    quarter = _quarter(latest[0]["data"].get("REPDTE"))
    current, rows = _pages(ctx, quarter)
    prior_quarter = str(int(quarter[:4]) - 1) + quarter[4:]
    prior, prior_rows = _pages(ctx, prior_quarter)
    if set(current) != STATES:
        raise SourceUnavailable("FDIC financials did not cover all 50 headquarters states and DC")
    return {"as_of": "%s-%s-%s" % (quarter[:4], quarter[4:6], quarter[6:]), "rows": rows + prior_rows,
            "data": combine(current, prior), "note": NOTE}
