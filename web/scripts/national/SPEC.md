# Source plugin spec (Deck national dataset v2)

One source = one Python file. Stdlib only (no pandas, no requests). It runs standalone with `ctx.py` in this folder and unchanged inside the core runner. In the repo it lives at `scripts/national/sources/<id>.py`, with its test at `tests/national/test_<id>.py` and a small fixture (50 KB at most) at `tests/fixtures/national/<id>/`.

## The file

```python
from ctx import SourceUnavailable, num, zfill_zip   # helpers; in the repo the import is the same name

SOURCE = {
    "id": "lodes_wac",                      # snake_case, unique, stable; it becomes the cache folder and the manifest id
    "name": "LEHD LODES workplace jobs by sector",       # plain name shown in the Data sheet
    "publisher": "US Census Bureau",
    "homepage": "https://lehd.ces.census.gov/data/",    # human page, not the file URL
    "level": "zip",                         # geography of load()'s data keys: zip | tract | county | cbsa | state | us
    "group": "commercial",                  # residential | commercial | people | risk | cost | geo
    "cadence": "annual",                    # how often the publisher updates
    "license": "Public domain (US government work)",   # one line; name the terms page when it is not public domain
    "key_env": None,                        # or "CENSUS_API_KEY" when a key is required
    "fields": {
        "jobs_total": {"label": "Jobs located here", "unit": "count", "agg": "sum"},
        "jobs_office_share": {"label": "Office-using share of jobs", "unit": "pct", "agg": "pop_weighted_mean",
                              "metric": "office_demand", "xwalk": "mean"},
    },
}

def parse(path):            # pure: file in, dict out. This is what the unit test feeds a fixture to.
    ...

def load(ctx):              # network through ctx only
    path, meta = ctx.fetch(URL, "wac.csv.gz")
    data, rows, as_of = parse(path)
    return {"as_of": as_of, "rows": rows, "data": data}
```

## Rules

1. **Keys of `data`** match `SOURCE["level"]`: ZIP is 5 characters (`zfill_zip`), tract is the 11-digit GEOID, county the 5-digit FIPS, cbsa the 5-digit code, state the 2-letter USPS code, us the single key `"US"`. Return the publisher's own geography. Do not crosswalk to ZIP yourself unless the file gives a ZIP per row (then aggregate rows to ZIP yourself and use level `zip`). The core does tract to ZIP and county to ZIP.
2. **Field specs**: `label` (plain words, sentence case), `unit` (one of: usd, usd_month, usd_sqft, pct, pct_pts, count, ratio, index, days, years, year, score, per_1k, per_100k, sqft, acres, kwh_cents, text, flag, date), `agg` for rollups to metro, state and US (sum | pop_weighted_mean | pop_weighted_median | ratio_of_sums | none). Optional: `metric` (the headline metric this field feeds, see the metric list in CONTRACT.md), `xwalk` for tract or county sources (`sum` apportions counts by weight, `mean` averages rates by weight, `assign` copies the value down; default `sum` for unit count, `mean` otherwise), `better` (`higher` | `lower`) when a direction is obvious.
3. **Percent values are 0 to 100**, not 0 to 1. Money is whole dollars. Counts are integers. Missing is `None`, never 0 and never a guess.
4. **`as_of`** is the period the publisher states (`2026-10`, `2024`, `2020-2024`, `FY2027`, `2026-11-12`). **`rows`** is how many publisher rows were read.
5. **History** is optional: `"hist": {geo: {field: [[period, value], ...]}}`, oldest first, 72 points at most per field, only for fields a chart needs.
6. **A note** is optional: `"note": "one plain sentence"` for a caveat the Data sheet should show (county-level proxy, suppressed cells, a partial year).
7. **Network** only through `ctx`: `ctx.fetch(url, name, min_age=, timeout=, headers=, data=)` returns `(path, meta)` and caches under `~/.cache/deck-data/<id>/` with conditional requests; `ctx.first([urls newest first], name)`; `ctx.get_json(url)`; `ctx.arcgis(layer_url, where=, fields=, geometry=)` pages a FeatureServer or MapServer layer; `ctx.key("ENV")` or `ctx.need_key("ENV")`; `ctx.zip_points()` and `ctx.nearest_zip(lat, lon)` for point data with no ZIP; `ctx.log(msg)`. `ctx.py` already sends the right User-Agent for FRED, sec.gov and api.weather.gov.
8. **Failure**: raise `SourceUnavailable("plain reason")`. The runner records the source as unavailable with that reason and every other source still loads. Never return partial junk silently; if a file parses to under half the rows you expect, raise.
9. **Size and manners**: stream big files (csv module over a text wrapper, gzip and zipfile members); keep peak memory under 2 GB per source; one download of a file per run; at most 4 requests per second to any host and 1 per second to sec.gov; stay under 15 minutes for a cold run and 3 minutes warm. If the publisher only offers per-state or per-county files, loop and cache each.
10. **Test**: `tests/national/test_<id>.py` (unittest) feeds `parse()` a real excerpt of the publisher file (fixture) and asserts the parsed values of two or three known rows, the ZIP or FIPS padding, and that a broken file raises. No network in tests.
11. **Proof**: run `lowprio python3 scripts/national/ctx.py scripts/national/sources/<id>.py` once for real and paste its report (status, as_of, rows, geos, coverage) into your lane report.
12. **Helpers**: a file in `sources/` whose name starts with `_` is a shared helper for one format family (`_acs.py`, `_openfema.py`), never a source. The runner skips it. A source imports it by name (`import _acs`). One source per file still holds, so each source keeps its own id, status and test.
13. **Optional SOURCE keys** (added 2026-11-14, both backward compatible): `native` says the publisher's own geography when the plugin had to aggregate to reach a level the runner knows (`zip3`, `block`, `blockgroup`, `point`, `place`); it feeds the confidence geography factor. `tract_vintage` (2010 or 2020, default 2020) on a tract-level source tells the runner which Census tracts the keys are; it converts 2010 tracts.

## What the runner does with it

Loads every file in `sources/`, runs `load`, converts to ZIP by `level`, merges all fields into each ZIP record, blends the fields that share a `metric` into one headline value with a confidence (how many sources, how well they agree, how fresh), scores, rolls up to metro, state and US with `agg`, and writes the manifest (one row per source with status and reason) and the shards.

## Validity (2026-11-15)

Plausibility of a headline value is the blend's job, not a plugin's. The blend checks it once, for every source, against the validity table in `metrics.json` (`validity.rules`): per metric, derived field or source field an allowed range and the least evidence it needs (homes for sale, a population scope, agreement with another field). A value outside it is written null with a short reason (`too few listings`, `no listing count`, `placeholder value`, `seasonal rentals`, `sources disagree`, `out of range`), never clamped, and a value computed from it is null with the same reason. A source field is checked before any blend, percentile or derived field reads it. The reason travels like any missing value's: the ZIP record's `m[name]` is `{v: null, reason, from}`, the manifest's `metrics[id]` carries `limits` and `nulled` counts, and `methods.validity` holds the table. A score treats a nulled input as missing, so its coverage confidence drops.
