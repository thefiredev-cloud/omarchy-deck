"""FDIC call reports joined to the Summary of Deposits: how much commercial real estate lending the banks in a ZIP carry.
For each ZIP the bank ratios are averaged with weights equal to each bank's deposits at branches in the ZIP. Source tag: fdiccre.
Pulls the branch list (SOD) and the quarterly financials from the keyless FDIC BankFind API."""
import json
import urllib.parse

from ctx import SourceUnavailable, num, zfill_zip

SOURCE = {
    "id": "fdic_call_cre",
    "name": "Local bank commercial real estate lending, FDIC call reports weighted by ZIP deposits",
    "publisher": "Federal Deposit Insurance Corporation",
    "homepage": "https://banks.data.fdic.gov/docs/",
    "level": "zip",
    "group": "commercial",
    "cadence": "quarterly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "fdiccre_pct_assets": {"label": "Local banks' commercial real estate loans, share of assets", "unit": "pct",
                               "agg": "pop_weighted_mean"},
        "fdiccre_pct_equity": {"label": "Local banks' commercial real estate loans, share of total equity capital (FDIC EQ, not regulatory capital)", "unit": "pct",
                               "agg": "pop_weighted_mean"},
        "fdiccre_mf_pct_assets": {"label": "Local banks' multifamily loans, share of assets", "unit": "pct",
                                  "agg": "pop_weighted_mean"},
    },
}
SOD = "https://api.fdic.gov/banks/sod"
FIN = "https://api.fdic.gov/banks/financials"
PAGE = 10000
FIELDS = "CERT,REPDTE,LNRECONS,LNRENROT,LNREMULT,ASSET,EQ"
MIN_COVER = 0.5  # share of a ZIP's deposits held by banks that have a call report


def _url(base, query):
    return base + "?" + urllib.parse.urlencode(query)


def parse_financials(paths):
    """Financials API page file(s) -> ({CERT: {assets, equity, cre, mf}}, report date). Amounts are thousands of dollars."""
    if isinstance(paths, str):
        paths = [paths]
    banks, repdte = {}, None
    for path in paths:
        with open(path, encoding="utf8") as fh:
            try:
                body = json.load(fh)
            except ValueError as exc:
                raise SourceUnavailable("FDIC financials page is not JSON (%s)" % str(exc)[:60])
        for item in body.get("data") or []:
            row = item.get("data") or {}
            assets, equity = num(row.get("ASSET")), num(row.get("EQ"))
            parts = [num(row.get(k)) for k in ("LNRECONS", "LNRENROT", "LNREMULT")]
            if not assets or any(p is None for p in parts):
                continue
            banks[row.get("CERT")] = {"assets": assets, "equity": equity, "cre": sum(parts), "mf": parts[2]}
            repdte = repdte or row.get("REPDTE")
    if not banks:
        raise SourceUnavailable("FDIC financials page had no banks")
    return banks, repdte


def parse_branches(paths):
    """SOD page files -> {zip: {CERT: deposits in thousands}}. Duplicate branch ids across pages are dropped."""
    if isinstance(paths, str):
        paths = [paths]
    out, seen = {}, set()
    for path in paths:
        with open(path, encoding="utf8") as fh:
            try:
                body = json.load(fh)
            except ValueError as exc:
                raise SourceUnavailable("FDIC SOD page is not JSON (%s)" % str(exc)[:60])
        for item in body.get("data") or []:
            row = item.get("data") or {}
            if row.get("ID") in seen:
                continue
            seen.add(row.get("ID"))
            z, dep = zfill_zip(row.get("ZIPBR")), row.get("DEPSUMBR")
            if z and dep:
                out.setdefault(z, {}).setdefault(row.get("CERT"), 0)
                out[z][row.get("CERT")] += dep
    if not out:
        raise SourceUnavailable("FDIC SOD pages had no branches")
    return out


def parse(branches, banks):
    """Deposit-weighted bank ratios per ZIP. `branches` from parse_branches, `banks` from parse_financials."""
    data = {}
    for z, by_cert in branches.items():
        total = sum(by_cert.values())
        covered = {c: d for c, d in by_cert.items() if c in banks}
        if not total or sum(covered.values()) / total < MIN_COVER:
            continue
        weight = sum(covered.values())
        rec = {
            "fdiccre_pct_assets": round(sum(d * 100.0 * banks[c]["cre"] / banks[c]["assets"] for c, d in covered.items()) / weight, 2),
            "fdiccre_mf_pct_assets": round(sum(d * 100.0 * banks[c]["mf"] / banks[c]["assets"] for c, d in covered.items()) / weight, 2),
        }
        with_equity = {c: d for c, d in covered.items() if banks[c]["equity"]}
        if with_equity and sum(with_equity.values()) / total >= MIN_COVER:
            w = sum(with_equity.values())
            rec["fdiccre_pct_equity"] = round(sum(d * 100.0 * banks[c]["cre"] / banks[c]["equity"] for c, d in with_equity.items()) / w, 1)
        else:
            rec["fdiccre_pct_equity"] = None
        data[z] = rec
    if not data:
        raise SourceUnavailable("no ZIP had call report coverage")
    return data


def _pages(ctx, base, query, tag):
    paths, offset, total = [], 0, None
    while total is None or offset < total:
        path, _ = ctx.fetch(_url(base, dict(query, limit=PAGE, offset=offset)), "%s_%d.json" % (tag, offset // PAGE), timeout=180)
        with open(path, encoding="utf8") as fh:
            total = (json.load(fh).get("meta") or {}).get("total")
        if not total:
            raise SourceUnavailable("FDIC %s is empty" % tag)
        paths.append(path)
        offset += PAGE
    return paths, total


def load(ctx):
    year, branch_paths = None, None
    for y in (ctx.year, ctx.year - 1, ctx.year - 2):
        try:
            branch_paths, total = _pages(ctx, SOD, {"filters": "YEAR:%d" % y, "fields": "CERT,ZIPBR,DEPSUMBR"}, "sod_%d" % y)
            year = y
            break
        except SourceUnavailable as exc:
            ctx.log("SOD %d: %s" % (y, exc))
    if year is None:
        raise SourceUnavailable("no FDIC SOD year answered")
    banks, repdte = None, None
    for q in ("%d%s" % (yy, md) for yy in (ctx.year, ctx.year - 1) for md in ("1231", "0930", "0630", "0331")):
        try:
            paths, _ = _pages(ctx, FIN, {"filters": "REPDTE:%s" % q, "fields": FIELDS}, "fin_%s" % q)
        except SourceUnavailable:
            continue
        banks, repdte = parse_financials(paths)
        if len(banks) > 3000:
            break
        banks = None
    if not banks:
        raise SourceUnavailable("no FDIC call report quarter answered")
    data = parse(parse_branches(branch_paths), banks)
    if len(data) < 15000:
        raise SourceUnavailable("call report join covered only %d ZIPs" % len(data))
    stamp = "%s-%s-%s" % (repdte[:4], repdte[4:6], repdte[6:8]) if repdte and len(repdte) == 8 else str(repdte)
    return {"as_of": stamp, "rows": total, "data": data,
            "note": "Bank-level ratios averaged by each bank's deposits in the ZIP. Banks without a call report are left out."}
