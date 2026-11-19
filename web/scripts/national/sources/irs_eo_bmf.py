"""IRS Exempt Organizations Business Master File: tax-exempt organizations per mailing ZIP. Source tag: irseo.
Four keyless regional CSV files (about 350 MB, about 2 million organizations) refreshed monthly. Only organizations with
status 01 (unconditional exemption) count. The ZIP is the organization's mailing address, which for many small groups is a
PO box or an officer's home, so counts are strongest for the larger institutions (hospitals, universities, large charities),
whose dollar fields come from their latest filing."""
import csv
import email.utils

from ctx import SourceUnavailable, num, zfill_zip

URL = "https://www.irs.gov/pub/irs-soi/eo%d.csv"
REGIONS = (1, 2, 3, 4)
MIN_ORGS = 1000000  # about 1.98 million active organizations

SOURCE = {
    "id": "irs_eo_bmf",
    "name": "IRS tax-exempt organizations by ZIP",
    "publisher": "Internal Revenue Service",
    "homepage": "https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "side": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "irseo_orgs": {"label": "Tax-exempt organizations", "unit": "count", "agg": "sum"},
        "irseo_charities": {"label": "Public charities (501(c)(3))", "unit": "count", "agg": "sum"},
        "irseo_assets": {"label": "Assets reported by tax-exempt organizations", "unit": "usd", "agg": "sum"},
        "irseo_revenue": {"label": "Revenue reported by tax-exempt organizations", "unit": "usd", "agg": "sum"},
    },
}


def parse(paths):
    """EO BMF region files -> (data {zip: fields}, organization rows read)."""
    data, rows, orgs = {}, 0, 0
    for path in paths:
        with open(path, encoding="latin-1", newline="") as fh:
            reader = csv.DictReader(fh)
            need = {"ZIP", "STATUS", "SUBSECTION", "ASSET_AMT", "REVENUE_AMT"}
            if not reader.fieldnames or need - set(reader.fieldnames):
                raise SourceUnavailable("IRS EO file lacks columns: %s" % ", ".join(sorted(need - set(reader.fieldnames or []))[:4]))
            for row in reader:
                rows += 1
                if (row["STATUS"] or "").strip() != "01":
                    continue
                zipc = zfill_zip((row["ZIP"] or "").strip()[:5])
                if not zipc or zipc == "00000":  # 00000 marks a foreign address
                    continue
                orgs += 1
                rec = data.setdefault(zipc, {"irseo_orgs": 0, "irseo_charities": 0})
                rec["irseo_orgs"] += 1
                if (row["SUBSECTION"] or "").strip() == "03":
                    rec["irseo_charities"] += 1
                assets, revenue = num(row["ASSET_AMT"]), num(row["REVENUE_AMT"])
                if assets is not None:
                    rec["irseo_assets"] = rec.get("irseo_assets", 0) + int(assets)
                if revenue is not None:
                    rec["irseo_revenue"] = rec.get("irseo_revenue", 0) + int(revenue)
    if orgs < MIN_ORGS:
        raise SourceUnavailable("IRS EO files had %d active US organizations, expected over %d" % (orgs, MIN_ORGS))
    return data, rows


def _published(meta):
    """Last-Modified header of a downloaded file -> 'YYYY-MM-DD', or None."""
    try:
        when = email.utils.parsedate_to_datetime(meta.get("last_modified"))
        return when.strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def load(ctx):
    paths, dates = [], []
    for region in REGIONS:
        path, meta = ctx.fetch(URL % region, "eo%d.csv" % region, timeout=600)
        paths.append(path)
        dates.append(_published(meta))
    if not all(dates):
        raise SourceUnavailable("IRS EO files do not say when they were published")
    data, rows = parse(paths)
    note = "Mailing addresses: many small organizations use a PO box or an officer's address. Dollar fields are the latest filing and are blank for organizations that file no return."
    return {"as_of": max(dates), "rows": rows, "data": data, "note": note}
