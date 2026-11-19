"""HUD CHAS (Comprehensive Housing Affordability Strategy), five-year release 2018-2022 (the first on 2020 census tracts),
census tract. Level "tract", tract vintage 2020.
Reads Table 8 (tenure by household income by housing cost burden by substandard housing) from the zip, streaming the
member. Table 8 has 133 estimate columns T8_est1 to T8_est133 in a fixed layout: est1 is all households, est2 is owners
and est68 renters; inside each tenure there are 5 income bands (at most 30%, 30-50%, 50-80%, 80-100% and over 100% of the
area median) of 13 columns each: the band total, then for each of 4 burden groups (at most 30%, 30-50%, over 50%, not
computed) a subtotal and two substandard-housing details. Shares follow HUD's usual rule and leave households whose burden
is not computed (no or negative income) out of the base."""
import csv
import io
import zipfile

from ctx import SourceUnavailable

SOURCE = {
    "id": "hud_chas_tract",
    "name": "HUD housing cost burden by tract (CHAS)",
    "publisher": "HUD Office of Policy Development and Research",
    "homepage": "https://www.huduser.gov/portal/datasets/cp.html",
    "level": "tract",
    "tract_vintage": 2020,
    "group": "residential",
    "cadence": "static",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "chas_renter_burden": {"label": "Renters paying 30% or more of income", "unit": "pct", "agg": "pop_weighted_mean",
                               "better": "lower", "xwalk": "mean"},
        "chas_owner_burden": {"label": "Owners paying 30% or more of income", "unit": "pct", "agg": "pop_weighted_mean",
                              "better": "lower", "xwalk": "mean"},
        "chas_severe_burden": {"label": "Households paying 50% or more of income", "unit": "pct", "agg": "pop_weighted_mean",
                               "better": "lower", "xwalk": "mean"},
        "chas_low_income_renter_burden": {"label": "Renters earning under 80% of the area median who pay 30% or more of income",
                                          "unit": "pct", "agg": "pop_weighted_mean", "better": "lower", "xwalk": "mean"},
        "chas_low_income_share": {"label": "Households earning under 80% of the area median", "unit": "pct",
                                  "agg": "pop_weighted_mean", "xwalk": "mean"},
    },
}

URL = "https://www.huduser.gov/portal/datasets/cp/%dthru%d-140-csv.zip"
MIN_TRACTS = 50000  # about 73,000 tracts
OWNER, RENTER = 2, 68  # est numbers of the owner and renter totals
BAND_START, BAND_SIZE = 3, 13  # first income band of the owner block; columns per band
LOW_INCOME_BANDS = (0, 1, 2)  # at most 30%, 30-50% and 50-80% of the area median


def _burden_cols(tenure_total, band):
    """est numbers (band total, at most 30%, 30-50%, over 50%, not computed) of one income band of one tenure."""
    start = tenure_total + 1 + band * BAND_SIZE
    return start, start + 1, start + 4, start + 7, start + 10


def _pct(top, bottom):
    return round(top / bottom * 100, 2) if bottom and bottom > 0 else None


def derive(est):
    """Fields of one tract from its estimate list (`est[n]` is T8_est<n>, None when blank)."""
    def g(n):
        return est.get(n)

    def burden(tenure_total, bands):
        """-> (households paying 30%+, households paying 50%+, households with a computed burden, band totals)."""
        over30 = over50 = computed = 0.0
        for band in bands:
            _, low, mid, high, nc = _burden_cols(tenure_total, band)
            vals = [g(low), g(mid), g(high)]
            if any(v is None for v in vals):
                return None
            over30 += vals[1] + vals[2]
            over50 += vals[2]
            computed += sum(vals)
        return over30, over50, computed

    all_bands = range(5)
    owners, renters = burden(OWNER, all_bands), burden(RENTER, all_bands)
    low_renters = burden(RENTER, LOW_INCOME_BANDS)
    total = g(1)
    low_total = None
    parts = [g(_burden_cols(t, b)[0]) for t in (OWNER, RENTER) for b in LOW_INCOME_BANDS]
    if all(p is not None for p in parts):
        low_total = sum(parts)
    row = dict.fromkeys(SOURCE["fields"])
    if renters:
        row["chas_renter_burden"] = _pct(renters[0], renters[2])
    if owners:
        row["chas_owner_burden"] = _pct(owners[0], owners[2])
    if owners and renters:
        row["chas_severe_burden"] = _pct(owners[1] + renters[1], owners[2] + renters[2])
    if low_renters:
        row["chas_low_income_renter_burden"] = _pct(low_renters[0], low_renters[2])
    row["chas_low_income_share"] = _pct(low_total, total) if low_total is not None else None
    return row


def parse(path):
    """-> (data by 11-digit tract GEOID, row count)."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise SourceUnavailable("the CHAS download is not a zip file")
    with zf:
        members = [n for n in zf.namelist() if n.endswith("/Table8.csv") or n == "Table8.csv"]
        if not members:
            raise SourceUnavailable("the CHAS zip has no Table8.csv")
        data, rows = {}, 0
        with zf.open(members[0]) as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding="latin-1", newline=""))
            head = next(reader, None)
            if not head or "geoid" not in head or "T8_est133" not in head:
                raise SourceUnavailable("CHAS Table8.csv has no geoid and T8_est1 to T8_est133 columns")
            ig = head.index("geoid")
            cols = {n: head.index("T8_est%d" % n) for n in range(1, 134)}
            for row in reader:
                if len(row) <= max(cols.values()) or len(row[ig]) < 11:
                    continue
                rows += 1
                est = {}
                for n, i in cols.items():
                    text = row[i].strip()
                    est[n] = float(text) if text and text.lstrip("-").replace(".", "", 1).isdigit() and float(text) >= 0 else None
                tract = row[ig][-11:]
                if tract.isdigit():
                    data[tract] = derive(est)
    if len(data) < MIN_TRACTS:
        raise SourceUnavailable("CHAS Table 8 holds only %d tracts (expected about 73,000)" % len(data))
    return data, rows


def load(ctx):
    # newest five-year release first. The 2018-2022 file is the first one on 2020 census tracts; 2017-2021 and older use
    # 2010 tracts, so they are not offered as a fallback (the tract vintage below would be wrong).
    urls = [URL % (y - 4, y) for y in (2024, 2023, 2022)]
    url, path, _ = ctx.first(urls, "chas_140.zip", timeout=1800)
    end = int(url.rsplit("/", 1)[1].split("thru")[1][:4])
    data, rows = parse(path)
    return {"as_of": "%d-%d" % (end - 4, end), "rows": rows, "data": data,
            "note": "Shares leave out households whose cost burden HUD could not compute (no or negative income)."}
