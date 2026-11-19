"""Census Bureau Small Area Income and Poverty Estimates (SAIPE), county. Level "county".
Reads the fixed-width `est<yy>all.txt` file (the `.xls` twin holds the same numbers). Columns, 0-based slices:
state [0:2], county [3:6], poverty count all ages [7:15], poverty percent all ages [34:38], poverty percent ages 0-17
[76:80], median household income [133:139]. Missing cells are printed as a dot."""
from ctx import SourceUnavailable, num

SOURCE = {
    "id": "census_saipe_county",
    "name": "Census small area income and poverty estimates by county",
    "publisher": "US Census Bureau",
    "homepage": "https://www.census.gov/programs-surveys/saipe.html",
    "level": "county",
    "group": "people",
    "cadence": "annual",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "saipe_hh_income_median": {"label": "Median household income (county estimate)", "unit": "usd", "agg": "pop_weighted_median",
                                   "better": "higher", "xwalk": "assign", "metric": "income"},
        "saipe_poverty_rate": {"label": "People in poverty (county estimate)", "unit": "pct", "agg": "pop_weighted_mean",
                               "better": "lower", "xwalk": "assign"},
        "saipe_child_poverty_rate": {"label": "Children in poverty (county estimate)", "unit": "pct", "agg": "pop_weighted_mean",
                                     "better": "lower", "xwalk": "assign"},
        "saipe_poverty_count": {"label": "People in poverty", "unit": "count", "agg": "sum"},
    },
}

URL = "https://www2.census.gov/programs-surveys/saipe/datasets/%d/%d-state-and-county/est%02dall.txt"
MIN_COUNTIES = 2500  # about 3,140
MIN_LINE = 139


def parse(path):
    """-> (data by county FIPS, county row count)."""
    data, rows = {}, 0
    with open(path, encoding="latin-1") as fh:
        for line in fh:
            if len(line) < MIN_LINE:
                continue
            state, county = line[0:2], line[3:6].strip()
            if not state.isdigit() or not county.isdigit() or int(county) == 0:  # skip the national and state rows
                continue
            rows += 1
            pov = num(line[7:15])
            data[state + county.zfill(3)] = {
                "saipe_hh_income_median": num(line[133:139]),
                "saipe_poverty_rate": num(line[34:38]),
                "saipe_child_poverty_rate": num(line[76:80]),
                "saipe_poverty_count": int(pov) if pov is not None else None,
            }
    if rows < MIN_COUNTIES:
        raise SourceUnavailable("SAIPE file holds only %d counties (expected about 3,140)" % rows)
    return data, rows


def load(ctx):
    urls = [URL % (y, y, y % 100) for y in (ctx.year - 1, ctx.year - 2, ctx.year - 3)]
    url, path, _ = ctx.first(urls, "est_all.txt")
    year = int(url.split("/datasets/")[1][:4])
    data, rows = parse(path)
    return {"as_of": str(year), "rows": rows, "data": data}
