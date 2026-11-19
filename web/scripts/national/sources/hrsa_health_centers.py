"""HRSA Health Center Program: federally funded community health center sites per ZIP. Source tag: hrsa.
One keyless CSV (about 14 MB, about 19,600 active sites) refreshed from the HRSA data warehouse every day. A site is a
permanent clinic (service delivery), an administrative office, or both; mobile vans and seasonal sites are not counted
as clinics. Medical-office and health-services demand signal for commercial property."""
import csv

from ctx import SourceUnavailable, zfill_zip

URL = "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
MIN_SITES = 10000  # about 19,600 active sites

SOURCE = {
    "id": "hrsa_health_centers",
    "name": "HRSA health center clinics and offices by ZIP",
    "publisher": "Health Resources and Services Administration",
    "homepage": "https://data.hrsa.gov/data/download",
    "level": "zip",
    "native": "zip",
    "group": "commercial",
    "side": "commercial",
    "cadence": "daily",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "hrsa_clinic_sites": {"label": "Community health center clinics", "unit": "count", "agg": "sum"},
        "hrsa_admin_offices": {"label": "Community health center administrative offices", "unit": "count", "agg": "sum"},
        "hrsa_orgs": {"label": "Health center organizations with a clinic here", "unit": "count", "agg": "none"},
    },
}


def _date(text):
    """'11/14/2026' -> '2026-11-14'."""
    try:
        month, day, year = text.strip().split()[0].split("/")
        return "%04d-%02d-%02d" % (int(year), int(month), int(day))
    except ValueError:
        return None


def parse(path):
    """HRSA site CSV -> (data {zip: fields}, site rows read, extract date 'YYYY-MM-DD')."""
    data, seen, rows, dates = {}, set(), 0, set()
    with open(path, encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        need = {"Site Postal Code", "Site Status Description", "Health Center Location Type Description",
                "Health Center Type Description", "Health Center Number", "BPHC Assigned Number",
                "Data Warehouse Record Create Date"}
        if not reader.fieldnames or need - set(reader.fieldnames):
            raise SourceUnavailable("HRSA file lacks columns: %s" % ", ".join(sorted(need - set(reader.fieldnames or []))[:4]))
        for row in reader:
            rows += 1
            if (row["Site Status Description"] or "").strip().lower() != "active":
                continue
            site = (row["BPHC Assigned Number"] or "").strip()
            zipc = zfill_zip((row["Site Postal Code"] or "").strip()[:5])
            if not site or site in seen or not zipc:
                continue
            seen.add(site)
            when = _date(row["Data Warehouse Record Create Date"] or "")
            if when:
                dates.add(when)
            kind = (row["Health Center Type Description"] or "").lower()
            permanent = (row["Health Center Location Type Description"] or "").strip().lower() == "permanent"
            clinic = "service delivery" in kind and permanent
            office = "administrative" in kind
            if not (clinic or office):
                continue  # mobile vans and seasonal sites: no record, so the ZIP is missing rather than zero
            rec = data.setdefault(zipc, {"hrsa_clinic_sites": 0, "hrsa_admin_offices": 0, "_orgs": set()})
            if clinic:
                rec["hrsa_clinic_sites"] += 1
                rec["_orgs"].add((row["Health Center Number"] or "").strip())
            if office:
                rec["hrsa_admin_offices"] += 1
    if len(seen) < MIN_SITES:
        raise SourceUnavailable("HRSA file had %d active sites with a ZIP, expected over %d" % (len(seen), MIN_SITES))
    if not dates:
        raise SourceUnavailable("HRSA file carries no extract date")
    for rec in data.values():
        orgs = rec.pop("_orgs")
        if rec["hrsa_clinic_sites"]:
            rec["hrsa_orgs"] = len(orgs)
    return data, rows, max(dates)


def load(ctx):
    path, _ = ctx.fetch(URL, "health_center_sites.csv", min_age=12 * 3600)
    data, rows, as_of = parse(path)
    note = "Sites listed as active on the extract date. Mobile vans and seasonal sites are left out of the clinic count; 2% of sites have no ZIP."
    return {"as_of": as_of, "rows": rows, "data": data, "note": note}
