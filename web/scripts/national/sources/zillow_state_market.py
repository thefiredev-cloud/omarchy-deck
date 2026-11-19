"""Zillow Research state market series: home values, for-sale listings, sales, market heat and new-buyer affordability.
Level "state".

Zillow publishes these series by state (50 states and DC): ZHVI, for-sale inventory, new listings, median days to pending,
share of listings with a price cut, sale-to-list, sales count (raw), market heat index and new-homeowner affordability.
It does not publish rents (ZORI, ZORDI), renter affordability or the value forecast by state, so no zs_zori_* or zs_zhvf
field exists. Sister source: zillow_metro_market (level cbsa, prefix zm_). Parsing is shared in _zillow_market.
"""
import _zillow_market as Z
from _counties import STATE_USPS
from ctx import SourceUnavailable

MIN_STATES = 45  # 50 states and DC are published
MIN_REGIONS = 45

SOURCE = {
    "id": "zillow_state_market",
    "name": "Zillow Research state market series",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "state",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow Research",
    "key_env": None,
    "fields": {
        "zs_zhvi": {"label": "State typical home value (Zillow)", "unit": "usd", "agg": "pop_weighted_median"},
        "zs_zhvi_yoy": {"label": "State typical home value, change from a year ago (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zs_inventory": {"label": "State homes for sale (Zillow)", "unit": "count", "agg": "sum"},
        "zs_inventory_yoy": {"label": "State homes for sale, change from a year ago (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zs_new_listings": {"label": "State new listings in the month (Zillow)", "unit": "count", "agg": "sum"},
        "zs_days_pending": {"label": "State median days to pending (Zillow)", "unit": "days", "agg": "pop_weighted_median",
                            "better": "lower"},
        "zs_price_cut_share": {"label": "State listings with a price cut (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zs_sale_to_list": {"label": "State sale price as a share of list price (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zs_sales_count": {"label": "State homes sold in the month (Zillow)", "unit": "count", "agg": "sum"},
        "zs_heat": {"label": "State market heat index (Zillow)", "unit": "index", "agg": "pop_weighted_mean"},
        "zs_afford_own": {"label": "State new-buyer payment as a share of income (Zillow)", "unit": "pct", "agg": "pop_weighted_mean",
                          "better": "lower"},
    },
}

# Same series, files and units as zillow_metro_market, state files only. hist: last 72 monthly points for charts.
SERIES = [
    {"key": "zhvi", "file": "zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "field": "zs_zhvi", "kind": "d",
     "yoy": "zs_zhvi_yoy", "hist": True, "required": True},
    {"key": "invt_fs", "file": "invt_fs/State_invt_fs_uc_sfrcondo_sm_month.csv", "field": "zs_inventory", "kind": "i",
     "yoy": "zs_inventory_yoy", "hist": True},
    {"key": "new_listings", "file": "new_listings/State_new_listings_uc_sfrcondo_sm_month.csv", "field": "zs_new_listings",
     "kind": "i"},
    {"key": "doz_pending", "file": "med_doz_pending/State_med_doz_pending_uc_sfrcondo_sm_month.csv",
     "field": "zs_days_pending", "kind": "i"},
    {"key": "price_cut", "file": "perc_listings_price_cut/State_perc_listings_price_cut_uc_sfrcondo_sm_month.csv",
     "field": "zs_price_cut_share", "kind": "p"},
    {"key": "sale_to_list", "file": "mean_sale_to_list/State_mean_sale_to_list_uc_sfrcondo_sm_month.csv",
     "field": "zs_sale_to_list", "kind": "p"},
    {"key": "sales_count", "file": "sales_count_raw/State_sales_count_raw_uc_sfrcondo_month.csv", "field": "zs_sales_count",
     "kind": "i"},
    {"key": "heat", "file": "market_temp_index/State_market_temp_index_uc_sfrcondo_month.csv", "field": "zs_heat", "kind": "f"},
    {"key": "afford_own", "file": "new_homeowner_affordability/State_new_homeowner_affordability_downpayment_0.20_uc_"
                                  "sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "field": "zs_afford_own", "kind": "p"},
]


def resolve(name, state=""):
    """Zillow state name ('California') -> USPS code, or None for a name that is not a state or territory."""
    return STATE_USPS.get(name)


def parse(path, key, min_regions=MIN_REGIONS):
    """One series file by its SERIES key -> (data {USPS: {field: value}}, hist, rows read, newest YYYY-MM, seen)."""
    s = next(x for x in SERIES if x["key"] == key)
    return Z.parse_one(path, "state", s, resolve, min_regions)


def load(ctx):
    data, hist, rows, newest, missing, seen = Z.collect(ctx, "state", SERIES, resolve, min_regions=MIN_REGIONS)
    if len(data) < MIN_STATES:
        raise SourceUnavailable("Zillow state files parsed to %d states (expected 51)" % len(data))
    dropped = sorted(n for n, _ in seen if resolve(n) is None)
    parts = ["Zillow publishes no state rent, renter demand or forecast series, so those fields are not here."]
    lag = Z.lag_note(newest)
    if lag:
        parts.append(lag)
    if dropped:
        parts.append("Not a state, dropped: %s." % ", ".join(dropped))
    if missing:
        parts.append("Not loaded, fields empty: %s." % "; ".join(missing))
    return {"as_of": max(newest.values()), "rows": rows, "data": data, "hist": hist, "note": " ".join(parts)}
