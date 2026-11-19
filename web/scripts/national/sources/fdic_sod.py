"""FDIC Summary of Deposits: bank branches and deposits per ZIP, with the change from the year before. Source tag: sod.
The SOD is the June 30 snapshot of every FDIC-insured branch. Pulled from the keyless FDIC BankFind API in pages of 10,000."""
import json
import urllib.parse

from ctx import SourceUnavailable, zfill_zip

SOURCE = {
    "id": "fdic_sod",
    "name": "FDIC Summary of Deposits, branches and deposits by ZIP",
    "publisher": "Federal Deposit Insurance Corporation",
    "homepage": "https://banks.data.fdic.gov/docs/",
    "level": "zip",
    "group": "commercial",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "sod_branches": {"label": "Bank branches", "unit": "count", "agg": "sum"},
        "sod_banks": {"label": "Banks with a branch here", "unit": "count", "agg": "none"},
        "sod_deposits": {"label": "Bank deposits at branches here", "unit": "usd", "agg": "sum"},
        "sod_deposits_yoy": {"label": "Bank deposits here, change from last year", "unit": "pct", "agg": "pop_weighted_mean",
                             "better": "higher"},
    },
}
API = "https://api.fdic.gov/banks/sod"
PAGE = 10000


def _url(year, offset):
    query = {"filters": "YEAR:%d" % year, "fields": "CERT,ZIPBR,DEPSUMBR", "limit": PAGE, "offset": offset}
    return API + "?" + urllib.parse.urlencode(query)


def parse(paths):
    """FDIC SOD API page files for one year -> ({zip: {branches, banks (set of CERT), deposits_k}}, branch rows, API total).
    Duplicate branch ids across pages are dropped, so a shifting page boundary cannot double count."""
    if isinstance(paths, str):
        paths = [paths]
    acc, seen, total = {}, set(), None
    for path in paths:
        with open(path, encoding="utf8") as fh:
            try:
                body = json.load(fh)
            except ValueError as exc:
                raise SourceUnavailable("FDIC SOD page is not JSON (%s)" % str(exc)[:60])
        if "data" not in body:
            raise SourceUnavailable("FDIC SOD page has no data")
        if total is None:
            total = (body.get("meta") or {}).get("total")
        for item in body["data"]:
            row = item.get("data") or {}
            ident = row.get("ID")
            if ident in seen:
                continue
            seen.add(ident)
            z = zfill_zip(row.get("ZIPBR"))
            dep = row.get("DEPSUMBR")
            if not z or dep is None:
                continue
            rec = acc.setdefault(z, {"branches": 0, "banks": set(), "deposits_k": 0})
            rec["branches"] += 1
            rec["banks"].add(row.get("CERT"))
            rec["deposits_k"] += dep
    if not acc:
        raise SourceUnavailable("FDIC SOD pages had no branches")
    return acc, len(seen), total


def combine(current, prior):
    """Merge two years of parse() output into the plugin's data dict. Deposits come in thousands of dollars."""
    data = {}
    for z, rec in current.items():
        before = (prior.get(z) or {}).get("deposits_k")
        data[z] = {
            "sod_branches": rec["branches"],
            "sod_banks": len(rec["banks"]),
            "sod_deposits": rec["deposits_k"] * 1000,
            "sod_deposits_yoy": round(100.0 * (rec["deposits_k"] - before) / before, 1) if before else None,
        }
    return data


def fetch_year(ctx, year):
    """All pages of one SOD year through ctx. Raises SourceUnavailable when the year is not published or incomplete."""
    paths, offset, total = [], 0, None
    while total is None or offset < total:
        path, _ = ctx.fetch(_url(year, offset), "sod_%d_%d.json" % (year, offset // PAGE), timeout=180)
        with open(path, encoding="utf8") as fh:
            head = json.load(fh)
        total = (head.get("meta") or {}).get("total")
        if not total:
            raise SourceUnavailable("FDIC SOD %d is empty" % year)
        paths.append(path)
        offset += PAGE
    acc, rows, total = parse(paths)
    if rows != total:
        raise SourceUnavailable("FDIC SOD %d returned %d of %d branches" % (year, rows, total))
    return acc, rows


def load(ctx):
    last = None
    for year in (ctx.year, ctx.year - 1, ctx.year - 2):
        try:
            current, rows = fetch_year(ctx, year)
            last = year
            break
        except SourceUnavailable as exc:
            ctx.log("SOD %d: %s" % (year, exc))
    if last is None:
        raise SourceUnavailable("no FDIC SOD year answered")
    prior, _ = fetch_year(ctx, last - 1)
    data = combine(current, prior)
    if len(data) < 15000:
        raise SourceUnavailable("FDIC SOD covered only %d ZIPs" % len(data))
    return {"as_of": "%d-06-30" % last, "rows": rows, "data": data}
