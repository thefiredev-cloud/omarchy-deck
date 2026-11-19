"""Derived fields and blended headline metrics with a confidence (DataArch section 5, `metrics.json`).

Every metric in metrics.json lists member fields in priority order with a base weight, a tier and a normalizer. A
ZIP's value comes from its present parts by the metric's blend rule; its confidence is

    conf = round(S x A x F x G x C, 2)
    S  part count after tier selection: 1 -> 0.6, 2 -> 0.85, 3+ -> 1.0
    A  agreement (levels: coefficient of variation, rates: spread in points with a sign check, scores: spread in
       percentile points, forecast: sign against value_trend_1y, single part: 1)
    F  blend-weighted mean over used parts of 0.5 ** (age_months / half_life_months)
    G  blend-weighted mean over used parts of the geography factor (ZIP 1.0 ... US 0.1; the catalog grain when coarser)
    C  blend-weighted mean over used parts of the reporting share of members with `coverage` (else 1)

and a value from tier 2 or lower caps the confidence at 0.45, so a fallback reads low (0.4 for safety from the homicide
proxy alone).
Member values keep their own fields; `parts(metric, i)` rebuilds {v, c, n, p: [[field, weight, tier]]} for a shard.
Nothing is invented: a part whose normalizer lacks an input is left out, never guessed.

Validity (metrics.json `validity`, SeeData 2026-11-15): a metric or derived field outside its allowed range, or without
the least evidence it needs (homes for sale, population), is null with a short reason, never clamped; a value computed
from a nulled input is null with that input's reason. `why` holds the reasons, `nulled_at(name, i)` gives the shard's
{v: null, reason, from}. A nulled score input is a missing input, so the score's coverage confidence drops with it.

Area fallback (metrics.json `area_fallback`, 2026-11-17): days_on_market and price_cuts fill a ZIP they left empty from
its county (the listing-weighted value of the county's ZIPs that kept their own) or its metro context series, with conf
x 0.6 (county) or 0.4 (metro), capped at 0.45; the shard parts say from: county | metro. Counts are never filled. A
fallback value is shown but never enters a rollup or a score (meta `fallback`, score.Scorer).
"""
import json
import math
import os
import re
import statistics
import time

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "metrics.json"), encoding="utf8") as _fh:
    SPEC = json.load(_fh)
METRICS = SPEC["metrics"]
BY_ID = {m["id"]: m for m in METRICS}
G = {k: v for k, v in SPEC["confidence"]["G_geography"].items()}
# A field's true grain from the catalog when it is coarser than its source's level (a statewide price a county
# source repeats for every county counts as state grain), and its own period when the catalog states one (a source
# that carries two school years has one as_of; each year's field keeps its year).
with open(os.path.join(HERE, "fields.json"), encoding="utf8") as _fh:
    _CAT = json.load(_fh)["fields"]
CATALOG_NATIVE = {f["name"]: f["native"] for f in _CAT if f.get("native") in G}
CATALOG_AS_OF = {f["name"]: f["as_of"] for f in _CAT if f.get("as_of")}
del _CAT
S_COUNT = {1: 0.6, 2: 0.85}
ACS_MID = (2022, 7)  # midpoint of the ACS 2020-2024 period the levels are rolled forward from
# roll_forward_income's growth series (2026-11-15, SeeData D10 follow-up): the county BEA per-capita income 5-year
# annual rate, a broad and slow series, compounded only up to BEA's own latest year. It replaced the ZIP's single-year
# IRS AGI-per-return change compounded to today, which turned capital-gains swings into income (10022: ACS $172,026,
# rolled $12,426; 92629: $142,807, rolled $200,298).
INCOME_GROWTH = "bea_per_capita_income_5y_cagr"
TIER2_CAP = 0.45  # Main 2026-11-14: a fallback value reads low (dots: medium starts at 0.5)
# metrics other metrics' normalizers, agreement or validity checks read: computed first
FIRST = ["rent_trend_1y", "sale_to_list", "value_trend_1y", "income_trend", "inventory"]
VALIDITY = SPEC["validity"]["rules"]
# legacy field -> metrics computed from its published inputs: the field is null where one of them was nulled
FOLLOWS = {k: v for k, v in SPEC["validity"]["follows"].items() if k != "note"}


def invalid(checks, v, listings, pop, get=None):
    """The reason of the first validity check value v fails, else None. `listings` is the ZIP's homes for sale
    (inventory) and `pop` its population; an unknown listing count fails min_listings with the check's
    reason_unknown (else its reason), an unknown population is 0. `get(field)` reads another field at the ZIP for
    max_ratio_to: v fails when it is more than max_ratio times that field or less than 1 / max_ratio of it (a check
    that cannot be made, the field missing or not positive, passes)."""
    p = pop or 0
    for c in checks:
        if p < c.get("if_pop_at_least", 0) or p >= c.get("if_pop_below", math.inf):
            continue
        if "min_listings" in c and listings is None:
            return c.get("reason_unknown") or c["reason"]
        if "min_listings" in c and listings < c["min_listings"]:
            return c["reason"]
        if v < c.get("min", -math.inf) or v > c.get("max", math.inf):
            return c["reason"]
        if "max_ratio_to" in c and get is not None:
            ref = get(c["max_ratio_to"])
            if isinstance(ref, (int, float)) and ref > 0 and v > 0 and max(v / ref, ref / v) > c["max_ratio"]:
                return c["reason"]
    return None


# Derived fields (fields.json kind "derived"): name -> (inputs, function of a values dict). None when an input that the
# formula needs is missing; a sum of optional parts needs at least one part.
def _div(a, b, k=1.0):
    return None if a is None or not b else a / b * k


def _sum_present(*vals):
    got = [v for v in vals if v is not None]
    return sum(got) if got else None


def _coalesce(*vals):
    return next((v for v in vals if v is not None), None)


def _minus(a, b):
    return None if a is None or b is None else a - b


def affordability(price, income, rate, tax=None, down=0.2, months=360):
    """Payment to income in percent (metrics.json affordability.formula): the monthly principal and interest on
    price x (1 - down) at the annual `rate` (percent) over `months`, plus price x tax / 1200 when the effective
    property tax rate (percent a year) is known, over income / 12. None without a price, income or rate."""
    if not price or not income or rate is None:
        return None
    r, loan = rate / 1200.0, price * (1 - down)
    pi = loan * r / (1 - (1 + r) ** -months) if r else loan / months
    return (pi + (price * tax / 1200.0 if tax is not None else 0.0)) / (income / 12.0) * 100


DERIVED = {
    "cap_spread_retail": (("crel_cap_retail", "com_median_cap", "fred_treasury_10y"),
                          lambda v: _minus(_coalesce(v["crel_cap_retail"], v["com_median_cap"]), v["fred_treasury_10y"])),
    "cap_spread_office": (("crel_cap_office", "com_median_cap", "fred_treasury_10y"),
                          lambda v: _minus(_coalesce(v["crel_cap_office"], v["com_median_cap"]), v["fred_treasury_10y"])),
    "cap_spread_industrial": (("crel_cap_industrial", "com_median_cap", "fred_treasury_10y"),
                              lambda v: _minus(_coalesce(v["crel_cap_industrial"], v["com_median_cap"]),
                                               v["fred_treasury_10y"])),
    "cap_spread_multifamily": (("crel_cap_multifamily", "com_median_cap", "fred_treasury_10y"),
                               lambda v: _minus(_coalesce(v["crel_cap_multifamily"], v["com_median_cap"]),
                                                v["fred_treasury_10y"])),
    "com_sqft_per_job": (("bldg_commercial_sqft", "lodes_jobs_total"),
                         lambda v: _div(v["bldg_commercial_sqft"], v["lodes_jobs_total"])),
    "ind_sqft_per_job": (("bldg_industrial_sqft", "lodes_jobs_industrial"),
                         lambda v: _div(v["bldg_industrial_sqft"], v["lodes_jobs_industrial"])),
    "lodes_daytime_pop": (("pop", "lodes_jobs_total", "lodes_res_workers"),
                          lambda v: None if None in (v["pop"], v["lodes_jobs_total"], v["lodes_res_workers"])
                          else v["pop"] + v["lodes_jobs_total"] - v["lodes_res_workers"]),
    "lodes_daytime_ratio": (("lodes_daytime_pop", "pop"), lambda v: _div(v["lodes_daytime_pop"], v["pop"])),
    "lodes_jobs_per_sqmi": (("lodes_jobs_total", "land_sqmi"), lambda v: _div(v["lodes_jobs_total"], v["land_sqmi"])),
    "retail_sales_per_cap": (("econ_retail_sales", "pop"), lambda v: _div(v["econ_retail_sales"], v["pop"])),
    "retail_sqft_per_cap": (("bldg_commercial_sqft", "pop"), lambda v: _div(v["bldg_commercial_sqft"], v["pop"])),
    "sba_dollars_per_estab": (("sba504_dollars_5y", "sba7a_dollars_5y", "biz_estabs"),
                              lambda v: _div(_sum_present(v["sba504_dollars_5y"], v["sba7a_dollars_5y"]),
                                             v["biz_estabs"])),
    "affordable_units_per_1k": (("lihtc_units", "hud_assisted_units", "pop"),
                                lambda v: _div(_sum_present(v["lihtc_units"], v["hud_assisted_units"]), v["pop"],
                                               1000.0)),
    "bps_units_per_1k": (("bps_units_12m", "pop"), lambda v: _div(v["bps_units_12m"], v["pop"], 1000.0)),
    "coa_net_per_1k": (("coa_net_moves_12m", "pop"), lambda v: _div(v["coa_net_moves_12m"], v["pop"], 1000.0)),
    "nfip_claims_per_1k": (("nfip_claims_10y", "acs_housing_units"),
                           lambda v: _div(v["nfip_claims_10y"], v["acs_housing_units"], 1000.0)),
    "storm_damage_per_cap": (("storm_damage_10y", "pop"), lambda v: _div(v["storm_damage_10y"], v["pop"])),
}
# A derived field never rolls up into a ZIP count past what its inputs justify; these are the inputs it needs.
DERIVED_REQUIRED = {k: [f for f in ins if not f.startswith(("crel_cap_", "com_median_cap", "sba504", "sba7a", "lihtc",
                                                            "hud_assisted"))]
                    for k, (ins, _) in DERIVED.items()}
# Rollup of a derived field (writer.v2_rollups): a count adds up over ZIPs; rates and ratios are population-weighted.
DERIVED_AGG = {"lodes_daytime_pop": "sum"}
# Per-1,000-people rates of a count published for a whole area (Blender.area_rate): name -> inputs, first present at
# the ZIP wins. The count is divided by the population of the area it was published for (the ZIP for ZIP data and
# apportioned county shares, else the county, metro or state, summed over its ZIPs), never by the ZIP's alone.
AREA_RATES = {"mf_permits_5plus_per_1k": ("bps_units_5plus_12m", "bpm_units_5plus_12m")}
AREA_COL = {"county": "county_fips", "cbsa": "cbsa", "state": "state"}
# Fields a normalizer reads besides the member itself (Blender.part), and the inputs of the derived metrics
# (Blender.derived_metric): what a metric depends on, for the dataset-use count (writer.used_fields).
NORMALIZE_INPUTS = {"sales_floor_10": ["redfin_homes_sold"], "roll_forward_value": ["fhfa_zip3_index_ratio"],
                    "roll_forward_rent": ["rent_trend_1y"], "roll_forward_income": ["bea_per_capita_income_5y_cagr"],
                    "list_to_sale": ["sale_to_list", "active"], "metro_ratio_zori": ["rent_zori"],
                    "ratio_to_national": ["hh_income"], "min3_props": ["cmbs_props"],
                    "pctile_higher_min10_policies": ["nfip_policies"]}
METRIC_INPUTS = {"gross_yield": ["typical_rent", "home_value"],
                 "affordability": ["home_value", "income", "mortgage_30y", "property_tax_rate"],
                 "cap_spread": ["asking_cap", "fred_treasury_10y"]}


def rnd(v, unit):
    if v is None:
        return None
    if unit in ("usd", "usd_month", "count", "sqft") and abs(v) >= 100:
        return int(round(v))
    if unit == "score":
        return round(v, 1)
    return round(v, 2) if abs(v) >= 1 else round(v, 4)


def period_end(as_of):
    """(year, month) when a stated period ends: '2026-10' -> (2026, 10); '2020-2024' -> (2024, 12); 'FY2027' ->
    (2026, 10); '2024-25' -> (2025, 6); 'fall 2023' -> (2023, 10); '2026-06-30' -> (2026, 6). None when unreadable."""
    s = str(as_of or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})(?:-\d{2})?$", s)
    if m and int(m.group(2)) <= 12:
        return int(m.group(1)), int(m.group(2))
    if m and not m.group(0)[7:]:  # '2024-25': an academic or fiscal span ending mid-year
        return int(m.group(1)) // 100 * 100 + int(m.group(2)), 6
    m = re.match(r"^FY\s?(\d{4})$", s, re.I)
    if m:
        return int(m.group(1)) - 1, 10
    years = [int(y) for y in re.findall(r"(?<!\d)(\d{4})(?!\d)", s)]
    if not years:
        return None
    month = 10 if s.lower().startswith("fall") else 7 if re.search(r"july|jul", s, re.I) else 12
    return max(years), month


def age_months(as_of, now=None):
    pe = period_end(as_of)
    if pe is None:
        return None
    t = time.localtime(now or time.time())
    return max(0, (t.tm_year - pe[0]) * 12 + (t.tm_mon - pe[1]))


def fresh(as_of, half_life, now=None):
    a = age_months(as_of, now)
    return 1.0 if a is None or not half_life else 0.5 ** (a / float(half_life))


def weighted_median(pairs):
    pairs = sorted((v, w) for v, w in pairs if w > 0)
    if not pairs:
        return None
    half, acc = sum(w for _, w in pairs) / 2.0, 0.0
    for v, w in pairs:
        acc += w
        if acc >= half:
            return v
    return pairs[-1][0]


def percentiles(values):
    """[(i, v)] -> {i: percentile 0-100} with mid-rank ties (the same rule as the v1 scores)."""
    ordered = sorted(v for _, v in values)
    n = len(ordered)
    out = {}
    import bisect  # noqa: PLC0415
    for i, v in values:
        lo, hi = bisect.bisect_left(ordered, v), bisect.bisect_right(ordered, v)
        out[i] = (lo + 0.5 * (hi - lo)) / n * 100
    return out


class Blender:
    """Blends every metric over a columnar store (xwalk.Store). `now` fixes the freshness clock in tests."""

    def __init__(self, store, now=None):
        self.s = store
        self.now = now or time.time()
        self._pct = {}
        self._metro_ratio = {}
        self._national = {}
        self.why = {}  # name -> {ZIP index: (reason, nulled input it came from or None)}
        self._fields_checked = False
        self._income_roll = False  # not computed yet
        self._income_growth_fallback = None  # ({state: median rate}, national median), built on first need
        self._area_pop = {}
        self.fallback = {}  # metric -> {ZIP index: shard parts of an area fallback value} (area_fallback)

    # ---------------------------------------------------------------- validity
    def check(self, name, v, i):
        """The reason the validity table rejects value v of `name` at ZIP i (kept in self.why), else None."""
        checks = VALIDITY.get(name)
        why = invalid(checks, v, self.s.get("inventory", i), self.s.get("pop", i),
                      lambda f: self.s.get(f, i)) if checks else None
        if why:
            self.why.setdefault(name, {})[i] = (why, None)
        return why

    def check_fields(self):
        """Run the validity table over the source fields it names (not metrics or derived fields, which are checked
        when computed): a rejected value leaves the store before any blend, percentile or derived field reads it.
        Runs once. Returns {field: ZIPs nulled}."""
        out = {}
        if self._fields_checked:
            return out
        self._fields_checked = True
        for name in VALIDITY:
            if name in BY_ID or name in DERIVED or not self.s.has(name):
                continue
            n = 0
            for i, v in self.s.values(name):
                if isinstance(v, (int, float)) and not isinstance(v, bool) and self.check(name, v, i):
                    self.s.drop(name, i)
                    n += 1
            out[name] = n
        return out

    def income_roll(self):
        """(growth field, years) for roll_forward_income: from the ACS midpoint to the middle of the latest year the
        county BEA per-capita income series reports, never past it; None when that series did not load."""
        if self._income_roll is False:
            pe = period_end((self.s.meta.get(INCOME_GROWTH) or {}).get("as_of"))
            self._income_roll = None if pe is None else (
                INCOME_GROWTH, max(0.0, (pe[0] + 0.5) - (ACS_MID[0] + (ACS_MID[1] - 1) / 12.0)))
        return self._income_roll

    def income_growth(self, i):
        """The county growth rate at ZIP i; where the county has none but other ZIPs of the state do (Virginia, Hawaii,
        Alaska) the median rate of the state's ZIPs; where the state has none (Connecticut, whose BEA planning regions
        match no county FIPS, and Puerto Rico) the national median. Published rates only."""
        t = self.s.get(INCOME_GROWTH, i)
        if t is not None:
            return t
        if self._income_growth_fallback is None:
            by, allv = {}, []
            for j, v in self.s.values(INCOME_GROWTH):
                allv.append(v)
                if self.s.get("state", j):
                    by.setdefault(self.s.get("state", j), []).append(v)
            self._income_growth_fallback = ({k: statistics.median(v) for k, v in by.items()},
                                            statistics.median(allv) if allv else None)
        state, nat = self._income_growth_fallback
        return state.get(self.s.get("state", i), nat)

    def income_method(self):
        """The roll-forward the income metric used, for the manifest's methods (the Data sheet's method line)."""
        roll = self.income_roll()
        as_of = (self.s.meta.get(INCOME_GROWTH) or {}).get("as_of")
        pe = period_end(as_of)
        return {"series": INCOME_GROWTH, "series_as_of": as_of, "from": "%04d-%02d" % ACS_MID,
                "to": "%04d-07" % pe[0] if pe else None, "years": round(roll[1], 2) if roll else None,
                "text": ("Household income is the Census survey median for 2020 to 2024, carried forward to mid-%d by "
                         "the county's per-capita income growth (BEA, 5-year annual rate); by the state's median rate "
                         "where the county has none, and by the national median where the state has none "
                         "(Connecticut, Puerto Rico)." % pe[0]) if pe else
                        "Household income is not carried forward: the county income growth series did not load."}

    def inherit(self, name, inputs, i):
        """A value that is null because an input was nulled carries that input's reason."""
        for f in inputs:
            got = self.why.get(f, {}).get(i)
            if got:
                self.why.setdefault(name, {})[i] = (got[0], got[1] or f)
                return got[0]
        return None

    def nulled_at(self, name, i):
        """{v: null, reason, from} for a value the validity table nulled at ZIP i, else None."""
        got = self.why.get(name, {}).get(i)
        if not got:
            return None
        return dict({"v": None, "reason": got[0]}, **({"from": got[1]} if got[1] else {}))

    def nulled(self):
        """{name: {reason: ZIPs}} for every metric and derived field with nulled values, inherited ones included."""
        out = {}
        for name, by in sorted(self.why.items()):
            counts = out.setdefault(name, {})
            for why, _ in by.values():
                counts[why] = counts.get(why, 0) + 1
        return out

    # ---------------------------------------------------------------- per-field facts
    def geo_factor(self, field):
        meta = self.s.meta.get(field) or {}
        g = G.get(meta.get("native") or meta.get("level") or "zip", 1.0)
        cat = CATALOG_NATIVE.get(field)
        return min(g, G[cat]) if cat else g

    def coverage(self, mem, i):
        """Reporting share of one part: a member with `coverage: [known, total]` multiplies the confidence by
        known / total at the ZIP (CMBS loans that report a payment status among all CMBS properties); 1 otherwise or
        when either count is missing."""
        pair = mem.get("coverage")
        if not pair:
            return 1.0
        known, total = self.s.get(pair[0], i), self.s.get(pair[1], i)
        if known is None or not total:
            return 1.0
        return max(0.0, min(1.0, known / total))

    def field_fresh(self, field, half_life):
        as_of = CATALOG_AS_OF.get(field) or (self.s.meta.get(field) or {}).get("as_of")
        return fresh(as_of, half_life, self.now)

    def pct(self, field, lower=False, cond=None):
        key = (field, cond)
        if key not in self._pct:
            vals = self.s.values(field)
            if cond == "min10_policies":
                vals = [(i, v) for i, v in vals if (self.s.get("nfip_policies", i) or 0) >= 10]
            self._pct[key] = percentiles([(i, v) for i, v in vals if isinstance(v, (int, float))])
        p = self._pct[key]
        return p, lower

    def metro_ratio(self, field):
        """({cbsa: ratio}, {state: ratio}, national ratio) of median(rent_zori / field) over ZIPs with both values.
        A ZIP outside every ZORI metro (rural areas, small metros) uses its state's ratio, else the national one:
        the ratio of two published values, never an estimate of the rent itself (fix 2026-11-14: tier 2 rents
        were rejected outside ZORI metros, 5,511 populated ZIPs had no typical_rent)."""
        if field not in self._metro_ratio:
            by, st, allr = {}, {}, []
            for i, v in self.s.values(field):
                z = self.s.get("rent_zori", i)
                if not (z and v):
                    continue
                r = z / v
                allr.append(r)
                if self.s.get("cbsa", i):
                    by.setdefault(self.s.get("cbsa", i), []).append(r)
                if self.s.get("state", i):
                    st.setdefault(self.s.get("state", i), []).append(r)
            self._metro_ratio[field] = ({c: statistics.median(r) for c, r in by.items()},
                                        {s: statistics.median(r) for s, r in st.items()},
                                        statistics.median(allr) if allr else None)
        return self._metro_ratio[field]

    def national_ratio(self, field):
        if field not in self._national:
            inc = [v for _, v in self.s.values("hh_income")]
            fv = [v for _, v in self.s.values(field) if isinstance(v, (int, float))]
            self._national[field] = statistics.median(inc) / statistics.median(fv) if inc and fv else None
        return self._national[field]

    def years_since(self, ym):
        t = time.localtime(self.now)
        return ((t.tm_year - ym[0]) * 12 + (t.tm_mon - ym[1])) / 12.0

    # ---------------------------------------------------------------- one part
    def part(self, mem, i):
        """(normalized value, weight factor) of one member at ZIP i, or None when absent or not normalizable."""
        f, norm = mem["field"], mem.get("normalize") or "none"
        v = self.s.get(f, i)
        if v is None or isinstance(v, str):
            return None
        if isinstance(v, bool):
            v = 1.0 if v else 0.0
        wf = 1.0
        if norm == "sales_floor_10":
            if f.startswith("redfin_") and (self.s.get("redfin_homes_sold", i) or 0) < 10:
                wf = 0.4
        elif norm == "roll_forward_value":
            r = self.s.get("fhfa_zip3_index_ratio", i)
            if not r:
                return None
            v = v * r
        elif norm == "roll_forward_rent":
            t = self.s.get("rent_trend_1y", i)
            if t is None:
                return None
            v = v * (1 + t / 100.0) ** self.years_since(ACS_MID)
        elif norm == "roll_forward_income":
            roll = self.income_roll()
            t = self.income_growth(i) if roll else None
            if t is None:
                return None
            v = v * (1 + t / 100.0) ** roll[1]
        elif norm == "list_to_sale":
            stl = self.s.get("sale_to_list", i)
            if stl is None or (self.s.get("active", i) or 0) < 10:
                return None
            v = v * stl / 100.0
        elif norm == "metro_ratio_zori":
            metro, state, nat = self.metro_ratio(f)
            r = metro.get(self.s.get("cbsa", i)) or state.get(self.s.get("state", i)) or nat
            if not r:
                return None
            v = v * r
        elif norm == "ratio_to_national":
            r = self.national_ratio(f)
            if not r:
                return None
            v = v * r
        elif norm == "annualize_5y":
            v = ((1 + v / 100.0) ** 0.2 - 1) * 100
        elif norm == "x52":
            v = v * 52
        elif norm in ("pctile_higher", "pctile_lower", "pctile_higher_min10_policies"):
            p, _ = self.pct(f, cond="min10_policies" if norm.endswith("policies") else None)
            if i not in p:
                return None
            v = 100 - p[i] if norm == "pctile_lower" else p[i]
        elif norm == "min3_props":
            if (self.s.get("cmbs_props", i) or 0) < 3:
                return None
        elif norm == "flag_x100":
            v = v * 100
        return v, wf

    # ---------------------------------------------------------------- one metric at one ZIP
    def one(self, m, i):
        """-> (value, conf, n, parts [[field, weight, tier]]) or (None, None, 0, []), also when the validity table
        rejects the value or one of its inputs (the reason goes to self.why)."""
        if m["blend"] == "context":
            return None, None, 0, []
        got = self.derived_metric(m, i) if m["blend"] == "derived" else self.blended(m, i)
        if got[0] is None:
            self.inherit(m["id"], METRIC_INPUTS.get(m["id"]) or [x["field"] for x in m.get("members") or []], i)
            return got
        return (None, None, 0, []) if self.check(m["id"], got[0], i) else got

    def blended(self, m, i):
        """One metric's value from its member parts by the metric's blend rule, before the validity checks."""
        hl = m.get("half_life_months") or 12
        got = []  # (tier, field, value, weight, fresh, geo, coverage)
        for mem in m.get("members") or []:
            p = self.part(mem, i)
            if p is None:
                continue
            v, wf = p
            fr, g = self.field_fresh(mem["field"], hl), self.geo_factor(mem["field"])
            got.append((mem.get("tier") or 1, mem["field"], v, (mem.get("weight") or 1.0) * wf * fr * g, fr, g,
                        self.coverage(mem, i)))
        if not got:
            return None, None, 0, []
        blend = m["blend"]
        if blend in ("weighted_median", "tiered_weighted_median", "percentile_weighted_median", "weighted_mean"):
            best = min(t for t, *_ in got)
            used = [x for x in got if x[0] == best]
        else:
            used = got
        if blend == "first_present":
            value = used[0][2]
            scored = used
            chosen = [used[0]]
        elif blend == "max":
            chosen = [max(used, key=lambda x: x[2])]
            value, scored = chosen[0][2], used
        elif blend == "weighted_mean":
            tw = sum(x[3] for x in used)
            value = sum(x[2] * x[3] for x in used) / tw if tw else None
            chosen = scored = used
        else:
            value = weighted_median([(x[2], x[3]) for x in used])
            chosen = scored = used
        if value is None:
            return None, None, 0, []
        n = len(scored)
        S = S_COUNT.get(n, 1.0)
        if m["id"] == "asking_cap":
            S = S_COUNT.get(int(self.s.get("com_listings", i) or 0), 1.0) if (self.s.get("com_listings", i) or 0) else 0.6
        A = self.agreement(m, scored, i)
        tw = sum(x[3] for x in chosen) or 1.0
        F = sum(x[4] * x[3] for x in chosen) / tw
        Gf = sum(x[5] * x[3] for x in chosen) / tw
        conf = S * A * F * Gf * (sum(x[6] * x[3] for x in chosen) / tw)
        tier = max(x[0] for x in chosen)
        if tier > 1:
            conf = min(conf, TIER2_CAP)
        if m["id"] == "safety" and [x[1] for x in chosen] == ["homicide_rate"]:
            conf = min(conf, 0.4)
        parts = [[x[1], round(x[3], 3), x[0]] for x in scored]
        return rnd(value, m["unit"]), round(conf, 2), n, parts

    def agreement(self, m, scored, i):
        if len(scored) < 2 and m.get("agreement") != "forecast":
            return 1.0
        vals = [x[2] for x in scored]
        kind = m.get("agreement")
        if kind == "levels":
            w = [x[3] or 1e-9 for x in scored]
            tw = sum(w)
            mean = sum(v * wi for v, wi in zip(vals, w)) / tw
            if not mean:
                return 0.3
            sd = math.sqrt(sum(wi * (v - mean) ** 2 for v, wi in zip(vals, w)) / tw)
            return max(0.3, 1 - min(1.0, abs(sd / mean) / 0.25))
        if kind == "rates":
            a = max(0.3, 1 - min(1.0, (max(vals) - min(vals)) / 10.0))
            if any(v > 0 for v in vals) and any(v < 0 for v in vals):
                a = min(a, 0.4)
            return a
        if kind == "scores":
            return max(0.3, 1 - min(1.0, (max(vals) - min(vals)) / 40.0))
        if kind == "forecast":
            trend = self.s.get("value_trend_1y", i)
            if trend is not None and vals and (vals[0] > 0) != (trend > 0) and vals[0] != 0 and trend != 0:
                return 0.7
            return 1.0
        return 1.0

    def derived_metric(self, m, i):
        s = self.s
        mid = m["id"]
        if mid == "gross_yield":
            rent, price = s.get("typical_rent", i), s.get("home_value", i)
            ins = ("typical_rent", "home_value")
            v = rent * 12 / price * 100 if rent is not None and price else None
        elif mid == "affordability":
            # monthly P&I on 80% of the typical home value at the 30-year rate over 360 months, plus property tax at the
            # ZIP's effective rate when it is known (the parts list property_tax_rate only then), over monthly income
            price, inc, rate = s.get("home_value", i), s.get("income", i), s.get("mortgage_30y", i)
            tax = s.get("property_tax_rate", i)
            ins = ("home_value", "income")
            if None in (price, inc, rate) or not inc:
                v = None
            else:
                v = affordability(price, inc, rate, tax)
                if v is not None:
                    confs = [s.get(k + "_conf", i) for k in ins]
                    conf = min(c for c in confs if c is not None) if any(c is not None for c in confs) else None
                    used = ins + (("mortgage_30y", "property_tax_rate") if tax is not None else ("mortgage_30y",))
                    return rnd(v, m["unit"]), conf, len(used), [[k, 1.0, 1] for k in used]
        elif mid == "cap_spread":
            cap, ten = s.get("asking_cap", i), s.get("fred_treasury_10y", i)
            ins = ("asking_cap",)
            v = cap - ten if cap is not None and ten is not None else None
        else:
            return None, None, 0, []
        if v is None:
            return None, None, 0, []
        confs = [s.get(k + "_conf", i) for k in ins]
        conf = min(c for c in confs if c is not None) if any(c is not None for c in confs) else None
        return rnd(v, m["unit"]), conf, len(ins), [[k, 1.0, 1] for k in ins]

    # ---------------------------------------------------------------- whole store
    def derive_fields(self):
        """Compute every DERIVED field into the store; meta takes the coarsest geography and oldest as_of of its
        inputs. Source fields the validity table names are checked first. A value the validity table rejects, or one
        from a rejected input, stays out with its reason. Returns {field: ZIPs with a value}."""
        self.check_fields()
        s, out = self.s, {}
        for name, (ins, fn) in DERIVED.items():
            if s.has(name) or not all(s.has(f) for f in DERIVED_REQUIRED[name]):
                continue
            n = 0
            for i in range(s.n):
                vals = {f: s.get(f, i) for f in ins}
                v = fn(vals)
                if v is None:
                    self.inherit(name, ins, i)
                elif not self.check(name, v, i):
                    s.put(name, i, v)
                    n += 1
            metas = [s.meta.get(f) or {} for f in ins if s.has(f)]
            coarse = min(metas, key=lambda x: G.get(x.get("native") or x.get("level") or "zip", 1.0), default={})
            ages = [x.get("as_of") for x in metas if x.get("as_of")]
            s.meta[name] = {"source": "derived", "level": coarse.get("level", "zip"),
                            "native": coarse.get("native") or coarse.get("level", "zip"), "unit": None,
                            "agg": DERIVED_AGG.get(name, "pop_weighted_mean"),
                            "as_of": min(ages, key=lambda a: period_end(a) or (9999, 12)) if ages else None,
                            "inputs": list(ins)}
            out[name] = n
        out.update(self.derive_area_rates())
        return out

    def area_pop(self, level):
        """{county | cbsa | state | 'US': population summed over its ZIPs} (ACS ZIP population)."""
        if level not in self._area_pop:
            col = self.s.obj.get(AREA_COL.get(level)) if level != "us" else None
            out = {}
            for i, p in self.s.values("pop"):
                key = "US" if level == "us" else (col[i] if col else None)
                if key:
                    out[key] = out.get(key, 0) + p
            self._area_pop[level] = out
        return self._area_pop[level]

    def area_rate(self, field, i, per=1000.0):
        """`field` at ZIP i per `per` people of the area it was published for (AREA_RATES), or None."""
        v = self.s.get(field, i)
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            return None
        meta = self.s.meta.get(field) or {}
        level = meta.get("level") or "zip"
        if level == "zip" or meta.get("xwalk") == "sum":
            return _div(v, self.s.get("pop", i), per)
        if level == "us":
            return _div(v, self.area_pop("us").get("US"), per)
        col = self.s.obj.get(AREA_COL.get(level, ""))
        return _div(v, self.area_pop(level).get(col[i]), per) if col else None

    def derive_area_rates(self):
        """Fill every AREA_RATES field from its first input present at each ZIP. Returns {field: ZIPs with a value}."""
        s, out = self.s, {}
        for name, ins in AREA_RATES.items():
            have = [f for f in ins if s.has(f)]
            if s.has(name) or not have:
                continue
            n = 0
            for i in range(s.n):
                v = next((r for r in (self.area_rate(f, i) for f in have) if r is not None), None)
                if v is not None:
                    s.put(name, i, round(v, 4))
                    n += 1
            metas = [s.meta[f] for f in have]
            ages = [x.get("as_of") for x in metas if x.get("as_of")]
            s.meta[name] = {"source": "derived", "level": metas[0].get("level", "zip"),
                            "native": metas[0].get("native") or metas[0].get("level", "zip"), "unit": "per_1k",
                            "agg": "pop_weighted_mean",
                            "as_of": min(ages, key=lambda a: period_end(a) or (9999, 12)) if ages else None,
                            "inputs": list(have)}
            out[name] = n
        return out

    def area_fallback(self, m):
        """Fill a ZIP the metric left empty (no source, or nulled by the validity table) from a larger area, by the
        metric's `area_fallback` (metrics.json, blend.area_fallback): first the county value, the listing-weighted
        median (or mean) of the ZIPs of the ZIP's county that kept their own value; else the median of the metro
        context fields present (Realtor.com and Zillow metro series), range-checked. conf = the area value's conf x
        G of the area (county 0.6, metro 0.4), capped at TIER2_CAP: a county value's conf is the listing-weighted
        median of its ZIPs' confs, a metro value's S x F. The shard parts say {from: county | metro, area}; a ZIP
        whose own value was nulled keeps that reason as zip_reason. Counts are never filled from an area (inventory
        has no area_fallback). Returns {county: ZIPs, metro: ZIPs}."""
        spec, mid, s = m.get("area_fallback"), m["id"], self.s
        if not spec:
            return None
        ranges = [c for c in VALIDITY.get(mid) or [] if "min_listings" not in c and "max_ratio_to" not in c]
        fips = s.obj.get("county_fips") or [None] * s.n
        cbsa = s.obj.get("cbsa") or [None] * s.n
        by = {}
        for i, v in s.values(mid):
            w = s.get(spec["weight"], i) or 0
            if fips[i] and w > 0:
                by.setdefault(fips[i], []).append((v, w, s.get(mid + "_conf", i)))
        county = {}
        for c, rows in by.items():
            pairs = [(v, w) for v, w, _ in rows]
            tw = sum(w for _, w in pairs)
            val = weighted_median(pairs) if spec["how"] == "weighted_median" else sum(v * w for v, w in pairs) / tw
            confs = [(cf, w) for _, w, cf in rows if cf is not None]
            county[c] = (rnd(val, m["unit"]), weighted_median(confs) if confs else None, len(rows), int(tw))
        metro = [f for f in spec.get("metro") or [] if s.has(f)]
        hl = m.get("half_life_months") or 12
        fb, counts = {}, {"county": 0, "metro": 0}
        for i in range(s.n):
            if s.get(mid, i) is not None:
                continue
            got = county.get(fips[i])
            if got and not invalid(ranges, got[0], None, None):
                v, cconf, nz, listings = got
                conf = round(min(TIER2_CAP, (cconf or 0) * G["county"]), 2)
                parts = {"v": v, "c": conf, "n": nz, "p": [[mid, G["county"], 2]], "from": "county",
                         "area": fips[i], "listings": listings}
            else:
                vals = [(f, s.get(f, i)) for f in metro]
                vals = [(f, v) for f, v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)
                        and not invalid(ranges, v, None, None)]
                if not vals:
                    continue
                v = rnd(statistics.median(x for _, x in vals), m["unit"])
                fr = sum(self.field_fresh(f, hl) for f, _ in vals) / len(vals)
                conf = round(min(TIER2_CAP, S_COUNT.get(len(vals), 1.0) * fr * G["cbsa"]), 2)
                parts = {"v": v, "c": conf, "n": len(vals), "p": [[f, G["cbsa"], 2] for f, _ in vals],
                         "from": "metro", "area": cbsa[i]}
            own = self.why.get(mid, {}).get(i)
            if own:
                parts["zip_reason"] = own[0]
            s.put(mid, i, parts["v"])
            s.put(mid + "_conf", i, parts["c"])
            fb[i] = parts
            counts[parts["from"]] += 1
        self.fallback[mid] = fb
        s.meta[mid]["fallback"] = {i: p["from"] for i, p in fb.items()}
        return counts

    def blend_all(self):
        """Fill <metric> and <metric>_conf columns for every metric. Returns {metric: {zips, median_conf, nulled}};
        nulled is {reason: ZIPs} of the values the validity table nulled, or None."""
        self.check_fields()
        order = [BY_ID[k] for k in FIRST if k in BY_ID]
        order += [m for m in METRICS if m["id"] not in FIRST and m["blend"] != "derived"]
        order += [m for m in METRICS if m["blend"] == "derived"]
        stats = {}
        for m in order:
            confs = []
            for i in range(self.s.n):
                v, c, _, _ = self.one(m, i)
                if v is None:
                    continue
                self.s.put(m["id"], i, v)
                if c is not None:
                    self.s.put(m["id"] + "_conf", i, c)
                    confs.append(c)
            self.s.meta[m["id"]] = {"source": "blend", "level": "zip", "unit": m["unit"], "agg": "pop_weighted_median"}
            self.s.meta[m["id"] + "_conf"] = {"source": "blend", "level": "zip", "unit": "ratio", "agg": "none"}
            why = [w for w, _ in self.why.get(m["id"], {}).values()]
            own = self.s.count(m["id"])
            fell = self.area_fallback(m)
            stats[m["id"]] = {"zips": own, "median_conf": round(statistics.median(confs), 2) if confs else None,
                              "nulled": {w: why.count(w) for w in sorted(set(why))} or None}
            if fell:
                stats[m["id"]]["fallback"] = fell
        self.follow_legacy()
        return stats

    def follow_legacy(self):
        """Null each legacy field of the validity table's `follows` where a metric it shares inputs with was nulled,
        with that metric's reason (rent_to_income after a rejected seasonal rent). Returns {field: ZIPs nulled}."""
        out = {}
        for name, metrics in FOLLOWS.items():
            n = 0
            for i, _ in self.s.values(name):
                if self.inherit(name, metrics, i):
                    self.s.drop(name, i)
                    n += 1
            out[name] = n
        return out

    def parts(self, metric, i):
        """{v, c, n, p} of one ZIP for its shard (an area fallback's parts with from and area), or None."""
        got = self.fallback.get(metric, {}).get(i)
        if got:
            return got
        m = BY_ID[metric]
        v, c, n, p = self.one(m, i)
        return None if v is None else {"v": v, "c": c, "n": n, "p": p}
