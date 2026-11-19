"""Parsing helpers for Census HVS state and metropolitan workbooks."""
import re
import zipfile

import _xlsx
from ctx import SourceUnavailable, num

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}


def _state_code(label):
    for name, code in sorted(STATES.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(r"\b" + re.escape(name) + r"\b", label, re.I):
            return code
    return None


def _periods(row):
    out = []
    quarters = {"First": "Q1", "Second": "Q2", "Third": "Q3", "Fourth": "Q4"}
    for i, value in enumerate(row):
        text = str(value or "").strip()
        match = re.search(r"(First|Second|Third|Fourth)\s+Quarter\s+(20\d{2})", text, re.I)
        if match:
            out.append((i, match.group(2) + quarters[match.group(1).title()]))
    return out


def parse_table(path, field, geo_kind, history=False):
    try:
        rows = list(_xlsx.read_xlsx_rows(path))
    except (OSError, KeyError, IndexError, zipfile.BadZipFile) as exc:
        raise SourceUnavailable("Census HVS workbook could not be read: %s" % exc)
    result, series, active_periods = {}, {}, []
    for row in rows:
        periods = _periods(row)
        if periods:
            active_periods = periods
            continue
        if not active_periods or not row:
            continue
        label_cell = next((str(cell).strip() for cell in row if cell and num(cell) is None), "")
        label_cell = re.sub(r"\.+$", "", label_cell).strip()
        geo = _state_code(label_cell) if geo_kind == "state" else _metro_name(label_cell)
        if not geo:
            continue
        points = [[period, num(row[col])] for col, period in active_periods
                  if col < len(row) and num(row[col]) is not None]
        if points:
            series.setdefault(geo, []).extend(points)
    hist = {}
    for geo, points in series.items():
        points.sort(key=lambda point: point[0])
        latest = points[-1]
        result[geo] = {field: latest[1]}
        if history and field.endswith("rental_vacancy"):
            annual = [point for point in points if point[0].endswith("Q4")]
            hist[geo] = {field: (annual or points)[-20:]}
    if not result:
        raise SourceUnavailable("Census HVS workbook has no usable %s observations" % geo_kind)
    latest_period = max((points[-1][0] for points in series.values()), default=None)
    return result, hist, latest_period




def _metro_name(label):
    label = re.sub(r"\s*\([^)]*\)\s*$", "", label).strip()
    label = re.sub(r"\s+Metropolitan Statistical Area\s*$", "", label, flags=re.I)
    return label if len(label) >= 3 and re.search(r"[A-Za-z]", label) else None
