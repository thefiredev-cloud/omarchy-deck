"""Parsers for the public bulk files behind the national ZIP housing and commercial dataset.

Each `parse_*` takes a local file path (already downloaded by national_fetch) and returns plain dicts keyed by the
5-digit ZIP. Values are what the publisher reports; a missing, suppressed or sentinel value becomes None. Nothing is
estimated, interpolated or carried over from another area.
"""
import csv
import io
import re
import statistics
import zipfile

from national_fetch import read_xlsx_rows

HIST_MONTHS = 60
ZIP_RE = re.compile(r"^\d{5}$")

STATES = {  # FIPS -> (USPS code, name). Reference table, not data.
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"), "05": ("AR", "Arkansas"),
    "06": ("CA", "California"), "08": ("CO", "Colorado"), "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"), "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"), "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"),
    "60": ("AS", "American Samoa"), "66": ("GU", "Guam"), "69": ("MP", "Northern Mariana Islands"),
    "72": ("PR", "Puerto Rico"), "78": ("VI", "U.S. Virgin Islands"),
}
STATE_BY_ABBR = {abbr: (fips, name) for fips, (abbr, name) in STATES.items()}
STATES_51 = sorted(abbr for fips, (abbr, _) in STATES.items() if int(fips) <= 56)

NAICS2 = {
    "11": "Agriculture, forestry, fishing", "21": "Mining, oil and gas", "22": "Utilities", "23": "Construction",
    "31": "Manufacturing", "42": "Wholesale trade", "44": "Retail trade", "48": "Transportation and warehousing",
    "51": "Information", "52": "Finance and insurance", "53": "Real estate and rental", "54": "Professional services",
    "55": "Management of companies", "56": "Administrative and support", "61": "Educational services",
    "62": "Health care and social assistance", "71": "Arts and recreation", "72": "Accommodation and food",
    "81": "Other services", "99": "Unclassified",
}
RETAIL = ("44",)
OFFICE = ("51", "52", "53", "54", "55", "56")
INDUSTRIAL = ("31", "42", "48")


def num(v):
    """Publisher text -> float, or None for blank, '.', 'NA' and non-numbers."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None
    s = str(v).strip().replace(",", "")
    if not s or s in (".", "NA", "N/A", "null", "-"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if f == f else None


def acs_num(v):
    """ACS estimates use large negative sentinels (-666666666 etc.) for 'not available'."""
    f = num(v)
    return None if f is None or f < 0 else f


def rnd(v, nd=2):
    """Round; nd=0 gives an int so counts and dollars serialize without '.0'."""
    if v is None:
        return None
    return int(round(v)) if nd == 0 else round(v, nd)


def zfill_zip(z):
    z = (z or "").strip().strip('"')
    if z.isdigit() and len(z) <= 5:
        z = z.zfill(5)
    return z if ZIP_RE.match(z) else None


def month_key(header):
    """'2026-09-30' -> '2026-09'."""
    return header[:7]


def _shift(ym, months):
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + (m - 1) - months
    return "%04d-%02d" % (t // 12, t % 12 + 1)


def pct_change(new, old):
    if new is None or old in (None, 0):
        return None
    return round((new - old) / old * 100, 2)


# ---------------------------------------------------------------- Zillow Research monthly ZIP files (ZHVI, ZORI)

def parse_zillow_monthly(path, value_round=0):
    """-> ({zip: {value, as_of, yoy, chg_5y, hist, city, state, county, metro}}, {as_of, rows}).
    as_of is the last month with a value for that ZIP; yoy and chg_5y compare against exactly 12 and 60 months
    earlier and are None when either month is unpublished."""
    out, latest, rows = {}, None, 0
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        dates = [(i, month_key(h)) for i, h in enumerate(header) if re.match(r"^\d{4}-\d{2}-\d{2}$", h)]
        for row in reader:
            z = zfill_zip(row[idx["RegionName"]] if len(row) > idx["RegionName"] else "")
            if not z:
                continue
            rows += 1
            series = []
            for i, ym in dates:
                v = num(row[i]) if i < len(row) else None
                if v is not None:
                    series.append((ym, v))
            if not series:
                continue
            by = dict(series)
            as_of, last = series[-1]
            latest = max(latest or as_of, as_of)
            out[z] = {
                "value": round(last, value_round) if value_round else round(last),
                "as_of": as_of,
                "yoy": pct_change(last, by.get(_shift(as_of, 12))),
                "chg_5y": pct_change(last, by.get(_shift(as_of, 60))),
                "hist": [[ym, round(v)] for ym, v in series[-HIST_MONTHS:]],
                "city": (row[idx["City"]] or None) if "City" in idx else None,
                "state": (row[idx["State"]] or None) if "State" in idx else None,
                "county": (row[idx["CountyName"]] or None) if "CountyName" in idx else None,
                "metro": (row[idx["Metro"]] or None) if "Metro" in idx else None,
            }
    return out, {"as_of": latest, "rows": rows}


# ---------------------------------------------------------------- Realtor.com ZIP core metrics

def _rdc_city_state(zip_name):
    """'manville, nj' -> ('Manville', 'NJ')."""
    if not zip_name or "," not in zip_name:
        return None, None
    city, st = zip_name.rsplit(",", 1)
    return (city.strip().title() or None), (st.strip().upper() or None)


def _ym(yyyymm):
    yyyymm = (yyyymm or "").strip()
    return "%s-%s" % (yyyymm[:4], yyyymm[4:6]) if re.match(r"^\d{6}$", yyyymm) else None


def realtor_row(row):
    city, st = _rdc_city_state(row.get("zip_name"))
    share = num(row.get("price_reduced_share"))
    return {
        "list_price": rnd(num(row.get("median_listing_price")), 0),
        "active": rnd(num(row.get("active_listing_count")), 0),
        "dom": rnd(num(row.get("median_days_on_market")), 0),
        "price_cut_share": None if share is None else round(share * 100, 2),
        "quality_flag": rnd(num(row.get("quality_flag")), 0),
        "city": city, "state": st,
    }


def parse_realtor_current(path):
    """Latest month per ZIP. -> ({zip: realtor_row + as_of}, {as_of, rows})."""
    out, latest, rows = {}, None, 0
    with open(path, newline="", encoding="utf8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            z = zfill_zip(row.get("postal_code"))
            ym = _ym(row.get("month_date_yyyymm"))
            if not z or not ym:
                continue
            rows += 1
            if z in out and out[z]["as_of"] >= ym:
                continue
            out[z] = dict(realtor_row(row), as_of=ym)
            latest = max(latest or ym, ym)
    return out, {"as_of": latest, "rows": rows}


def parse_realtor_history(path, months=HIST_MONTHS):
    """Monthly median list price and active listings per ZIP for the last `months` months of the file.
    -> ({zip: {list_price: [[ym, v]...], active: [...], latest: realtor_row + as_of}}, {as_of, rows})."""
    with open(path, encoding="utf8", errors="replace") as fh:
        next(fh)
        latest = None
        for n, line in enumerate(fh):  # the publisher writes newest month first; the head is enough
            m = line[:6]
            if m.isdigit():
                latest = max(latest or m, m)
            if n >= 5000:
                break
    if not latest:
        return {}, {"as_of": None, "rows": 0}
    first = _shift("%s-%s" % (latest[:4], latest[4:6]), months - 1).replace("-", "")
    out, rows, newest = {}, 0, None
    with open(path, encoding="utf8", errors="replace") as fh:
        names = next(csv.reader([fh.readline()]))
        for line in fh:
            m = line[:6]
            if not m.isdigit() or m < first:
                continue
            row = dict(zip(names, next(csv.reader([line]))))
            z = zfill_zip(row.get("postal_code"))
            if not z:
                continue
            rows += 1
            ym = _ym(m)
            newest = max(newest or ym, ym)
            rec = out.setdefault(z, {"list_price": {}, "active": {}, "latest": None})
            lp, ac = num(row.get("median_listing_price")), num(row.get("active_listing_count"))
            if lp is not None:
                rec["list_price"][ym] = round(lp)
            if ac is not None:
                rec["active"][ym] = round(ac)
            if rec["latest"] is None or rec["latest"]["as_of"] < ym:
                rec["latest"] = dict(realtor_row(row), as_of=ym)
    for rec in out.values():
        for key in ("list_price", "active"):
            rec[key] = [[k, rec[key][k]] for k in sorted(rec[key])][-months:]
    return out, {"as_of": newest, "rows": rows}


# ---------------------------------------------------------------- Census geography

def _open_member(path, suffix=".txt"):
    zf = zipfile.ZipFile(path)
    name = next(n for n in zf.namelist() if n.endswith(suffix))
    return io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", errors="replace")


def parse_gazetteer(path):
    """ZCTA gazetteer (zip or txt) -> ({zip: {lat, lon, aland_sqmi}}, {rows})."""
    out = {}
    fh = _open_member(path) if zipfile.is_zipfile(path) else open(path, encoding="utf-8-sig", errors="replace")
    with fh:
        first = fh.readline()
        delim = "|" if "|" in first else "\t"
        names = [h.strip() for h in first.rstrip("\n").split(delim)]
        for line in fh:
            row = dict(zip(names, [c.strip() for c in line.rstrip("\n").split(delim)]))
            z = zfill_zip(row.get("GEOID"))
            if not z:
                continue
            out[z] = {"lat": rnd(num(row.get("INTPTLAT")), 5), "lon": rnd(num(row.get("INTPTLONG")), 5),
                      "aland_sqmi": rnd(num(row.get("ALAND_SQMI")), 3)}
    return out, {"rows": len(out)}


def parse_zcta_county(path):
    """2020 ZCTA to county relationship file -> ({zip: {county_fips, county}}, {rows}). A ZCTA that spans counties
    is assigned to the county holding the largest share of its land area (water when it has no land)."""
    best = {}
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        names = [h.strip() for h in fh.readline().rstrip("\n").split("|")]
        for line in fh:
            row = dict(zip(names, line.rstrip("\n").split("|")))
            z = zfill_zip(row.get("GEOID_ZCTA5_20"))
            if not z:
                continue
            key = (num(row.get("AREALAND_PART")) or 0, num(row.get("AREAWATER_PART")) or 0)
            if z not in best or key > best[z][0]:
                best[z] = (key, {"county_fips": row.get("GEOID_COUNTY_20"), "county": row.get("NAMELSAD_COUNTY_20") or None})
    return {z: v for z, (_, v) in best.items()}, {"rows": len(best)}


def parse_cbsa(path):
    """OMB delineation list 1 (xlsx) -> ({county_fips: {cbsa, metro, kind}}, {rows, as_of})."""
    out, header, as_of = {}, None, None
    for row in read_xlsx_rows(path):
        if header is None:
            joined = " ".join(row)
            m = re.search(r"(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) (\d{4})", joined)
            if m and not as_of:
                as_of = "%s %s" % (m.group(1).title(), m.group(2))
            if "CBSA Code" in row:
                header = {h.strip(): i for i, h in enumerate(row)}
            continue
        def g(name):
            i = header.get(name)
            return (row[i] if i is not None and i < len(row) else "").strip()
        st, co = g("FIPS State Code"), g("FIPS County Code")
        if not (st.isdigit() and co.isdigit() and g("CBSA Code")):
            continue
        kind = "metro" if g("Metropolitan/Micropolitan Statistical Area").startswith("Metropolitan") else "micro"
        out[st.zfill(2) + co.zfill(3)] = {"cbsa": g("CBSA Code"), "metro": g("CBSA Title") or None, "kind": kind}
    return out, {"rows": len(out), "as_of": as_of}


def parse_geonames(path):
    """GeoNames US postal codes -> ({zip: {city, state, county, county_fips, lat, lon}}, {rows})."""
    out = {}
    fh = _open_member(path, "US.txt") if zipfile.is_zipfile(path) else open(path, encoding="utf-8", errors="replace")
    with fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < 11:
                continue
            z = zfill_zip(f[1])
            if not z or z in out:
                continue
            st = f[4] or None
            sf = STATE_BY_ABBR.get(st, (None,))[0]
            out[z] = {"city": f[2] or None, "state": st, "county": f[5] or None,
                      "county_fips": (sf + f[6].zfill(3)) if sf and f[6].isdigit() else None,
                      "lat": rnd(num(f[9]), 5), "lon": rnd(num(f[10]), 5)}
    return out, {"rows": len(out)}


# ---------------------------------------------------------------- ACS 5-year table-based summary file

ACS_TABLES = {
    "b01003": {"E001": "pop"},
    "b01002": {"E001": "median_age"},
    "b19013": {"E001": "hh_income"},
    "b25064": {"E001": "median_gross_rent"},
    "b25002": {"E001": "housing_units", "E003": "vacant_units"},
    "b25003": {"E001": "occupied_units", "E002": "owner_units", "E003": "renter_units"},
    "b25035": {"E001": "median_year_built"},
}
ACS_OPTIONAL = {"b01002"}  # added 2026-11-11 for the area grade; its absence leaves median_age null, nothing else


def parse_acs_table(path, table, into):
    """Merge one ACS table-based summary file (pipe-delimited, all geographies) into `into` for ZCTA rows only."""
    cols = ACS_TABLES[table]
    rows = 0
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        names = fh.readline().rstrip("\n").split("|")
        idx = {}
        for i, n in enumerate(names):
            m = re.match(r"^[A-Z0-9]+_(E\d{3})$", n)
            if m and m.group(1) in cols:
                idx[cols[m.group(1)]] = i
        for line in fh:
            if not line.startswith("860Z200US"):
                continue
            f = line.rstrip("\n").split("|")
            z = zfill_zip(f[0][9:])
            if not z:
                continue
            rows += 1
            rec = into.setdefault(z, {})
            for key, i in idx.items():
                rec[key] = acs_num(f[i]) if i < len(f) else None
    return rows


def acs_derive(rec):
    """Rates from published counts. None when the denominator is missing or zero."""
    hu, vac = rec.get("housing_units"), rec.get("vacant_units")
    occ, own, rent = rec.get("occupied_units"), rec.get("owner_units"), rec.get("renter_units")
    return {
        "pop": rec.get("pop"),
        "median_age": rec.get("median_age"),
        "hh_income": rec.get("hh_income"),
        "median_gross_rent": rec.get("median_gross_rent"),
        "housing_units": hu,
        "median_year_built": rec.get("median_year_built"),
        "vacancy": round(vac / hu * 100, 2) if hu and vac is not None else None,
        "owner_share": round(own / occ * 100, 2) if occ and own is not None else None,
        "renter_share": round(rent / occ * 100, 2) if occ and rent is not None else None,
    }


# ---------------------------------------------------------------- HUD Small Area FMR

def parse_safmr(path):
    """-> ({zip: {br0..br4, area}}, {rows, zips, multi_area}). A ZIP listed under more than one HUD area keeps the
    first row in file order; its area name is kept so the choice is visible."""
    out, header, rows, multi = {}, None, 0, set()
    for row in read_xlsx_rows(path):
        norm = [re.sub(r"\s+", " ", c or "").strip() for c in row]
        if header is None:
            if any(c.lower().startswith("zip") for c in norm) and any(c == "SAFMR 2BR" for c in norm):
                header = {c: i for i, c in enumerate(norm)}
            continue
        z = zfill_zip(norm[header.get("ZIP Code", 0)])
        if not z:
            continue
        rows += 1
        if z in out:
            multi.add(z)
            continue
        rec = {"br%d" % b: rnd(num(norm[header["SAFMR %dBR" % b]]) if header.get("SAFMR %dBR" % b, 10 ** 6) < len(norm) else None, 0)
               for b in range(5)}
        ai = header.get("HUD Fair Market Rent Area Name")
        rec["area"] = norm[ai] if ai is not None and ai < len(norm) else None
        out[z] = rec
    return out, {"rows": rows, "zips": len(out), "multi_area": len(multi)}


# ---------------------------------------------------------------- FHFA annual ZIP5 HPI

def parse_fhfa(path):
    """-> ({zip: {hpi_5y, year}}, {as_of, rows, published}). hpi_5y compares the newest year in the file with the
    year five earlier; None when either is unpublished ('.')."""
    hpi, header, published, rows, years = {}, None, None, 0, set()
    for row in read_xlsx_rows(path):
        if header is None:
            joined = " ".join(row)
            m = re.search(r"Last updated:\s*([A-Za-z]+ \d{1,2}, \d{4})", joined)
            if m:
                published = m.group(1)
            if row and row[0].strip() == "Five-Digit ZIP Code":
                header = {c.strip(): i for i, c in enumerate(row)}
            continue
        z = zfill_zip(row[0] if row else "")
        y = num(row[header["Year"]]) if len(row) > header["Year"] else None
        if not z or y is None:
            continue
        rows += 1
        v = num(row[header["HPI"]]) if len(row) > header["HPI"] else None
        years.add(int(y))
        if v is not None:
            hpi.setdefault(z, {})[int(y)] = v
    if not years:
        return {}, {"as_of": None, "rows": 0, "published": published}
    last = max(years)
    out = {}
    for z, by in hpi.items():
        out[z] = {"hpi_5y": pct_change(by.get(last), by.get(last - 5)), "year": last}
    return out, {"as_of": str(last), "rows": rows, "published": published}


# ---------------------------------------------------------------- Census ZIP Code Business Patterns

def _zbp_reader(path):
    fh = _open_member(path) if zipfile.is_zipfile(path) else open(path, encoding="latin-1", errors="replace")
    return fh, csv.DictReader(fh)


def parse_zbp_totals(path):
    """-> ({zip: {estabs, emp, payroll_k, city, state, county}}, {rows}). Employment flagged 'D' or 'S' (withheld or
    below publication standard) is None; payroll is in thousands of dollars as published."""
    out = {}
    fh, reader = _zbp_reader(path)
    with fh:
        for row in reader:
            row = {(k or "").strip().lower(): v for k, v in row.items()}
            z = zfill_zip(row.get("zip"))
            if not z:
                continue
            emp_flag = (row.get("emp_nf") or "").strip().upper()
            ap_flag = (row.get("ap_nf") or "").strip().upper()
            out[z] = {
                "estabs": num(row.get("est")),
                "emp": None if emp_flag in ("D", "S") else num(row.get("emp")),
                "payroll_k": None if ap_flag in ("D", "S") else num(row.get("ap")),
                "city": (row.get("city") or "").strip().title() or None,
                "state": (row.get("stabbr") or "").strip().upper() or None,
            }
    return out, {"rows": len(out)}


def parse_zbp_detail(path):
    """-> ({zip: {"44": estabs, ...}} for 2-digit NAICS sectors, {rows})."""
    out, rows = {}, 0
    fh, reader = _zbp_reader(path)
    with fh:
        for row in reader:
            code = (row.get("naics") or "").strip()
            if not re.match(r"^\d\d----$", code):
                continue
            z = zfill_zip(row.get("zip"))
            est = num(row.get("est"))
            if not z or est is None:
                continue
            rows += 1
            out.setdefault(z, {})[code[:2]] = int(est)
    return out, {"rows": rows}


def sector_groups(sectors):
    """Retail, office-using and industrial establishment counts from 2-digit sector counts. None when the ZIP has no
    detail rows at all; a sector absent from a ZIP that has detail rows counts as zero, because ZBP lists every
    sector with at least one establishment."""
    if not sectors:
        return None, None, None
    return (sum(sectors.get(s, 0) for s in RETAIL), sum(sectors.get(s, 0) for s in OFFICE),
            sum(sectors.get(s, 0) for s in INDUSTRIAL))


# ---------------------------------------------------------------- commercial listings in the existing realestate feed

ADDR_ZIP = re.compile(r"\b(\d{5})(?:-\d{4})?\s*$")


def commercial_by_zip(feed):
    """realestate.json `commercial` rows grouped by ZIP -> {zip: {com_listings, com_median_price, com_median_cap}}.
    The ZIP comes from the row's `zip` field, else the trailing ZIP of its address; rows with neither are skipped."""
    groups = {}
    for r in (feed or {}).get("commercial") or []:
        z = zfill_zip(str(r.get("zip") or ""))
        if not z:
            m = ADDR_ZIP.search(r.get("addr") or "")
            z = m.group(1) if m else None
        if not z:
            continue
        groups.setdefault(z, []).append(r)
    out = {}
    for z, rs in groups.items():
        prices = [r["price"] for r in rs if isinstance(r.get("price"), (int, float)) and r["price"] > 0]
        caps = [r["cap_rate"] for r in rs if isinstance(r.get("cap_rate"), (int, float))]
        out[z] = {"com_listings": len(rs),
                  "com_median_price": round(statistics.median(prices)) if prices else None,
                  "com_median_cap": round(statistics.median(caps), 2) if caps else None}
    return out
