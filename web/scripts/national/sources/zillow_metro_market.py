"""Zillow Research metro market series: home values, rents (all homes, multifamily 5+ units, single-family), renter demand,
for-sale listings, sales, market heat, new-buyer and new-renter affordability and the 12-month value forecast. Level "cbsa".

Fifteen wide monthly CSVs, one row per Zillow metro (about 900), one column per month, newest last. Zillow names a metro by its
first principal city and state ("Los Angeles, CA"); each is matched to the 5-digit CBSA of the Census OMB delineation by that
name (see _cbsa_names). A metro that matches no single CBSA is dropped and counted in the note. The ZIP-level Zillow sources
(zillow_zhvi, zillow_zori, zillow_listing_metrics_zip, zillow_zhvf) are separate; this file is the metro rollup Zillow publishes.
"""
import _cbsa_names
import _zillow_market as Z
from ctx import SourceUnavailable

MIN_MATCHED = 300  # Zillow ZHVI carries about 890 metros; a match count under 300 means the name rules broke
MIN_REGIONS = 250

SOURCE = {
    "id": "zillow_metro_market",
    "name": "Zillow Research metro market series",
    "publisher": "Zillow Research",
    "homepage": "https://www.zillow.com/research/data/",
    "level": "cbsa",
    "group": "residential",
    "cadence": "monthly",
    "license": "Zillow Research data: free to use with attribution to Zillow Research",
    "key_env": None,
    "fields": {
        "zm_zhvi": {"label": "Metro typical home value (Zillow)", "unit": "usd", "agg": "pop_weighted_median"},
        "zm_zhvi_yoy": {"label": "Metro typical home value, change from a year ago (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zm_zori_all": {"label": "Metro typical rent, all homes and apartments (Zillow)", "unit": "usd_month", "agg": "pop_weighted_median"},
        "zm_zori_all_yoy": {"label": "Metro typical rent, all homes and apartments, change from a year ago (Zillow)", "unit": "pct",
                            "agg": "pop_weighted_mean"},
        "zm_zori_mf": {"label": "Metro typical rent, multifamily 5+ units (Zillow)", "unit": "usd_month",
                       "agg": "pop_weighted_median"},
        "zm_zori_mf_yoy": {"label": "Metro typical rent, multifamily, change from a year ago (Zillow)", "unit": "pct",
                           "agg": "pop_weighted_mean"},
        "zm_zori_sfr": {"label": "Metro typical rent, single-family (Zillow)", "unit": "usd_month", "agg": "pop_weighted_median"},
        "zm_zori_sfr_yoy": {"label": "Metro typical rent, single-family, change from a year ago (Zillow)", "unit": "pct",
                            "agg": "pop_weighted_mean"},
        "zm_zordi": {"label": "Metro renter demand index (Zillow)", "unit": "index", "agg": "pop_weighted_mean"},
        "zm_inventory": {"label": "Metro homes for sale (Zillow)", "unit": "count", "agg": "sum"},
        "zm_inventory_yoy": {"label": "Metro homes for sale, change from a year ago (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zm_new_listings": {"label": "Metro new listings in the month (Zillow)", "unit": "count", "agg": "sum"},
        "zm_days_pending": {"label": "Metro median days to pending (Zillow)", "unit": "days", "agg": "pop_weighted_median",
                            "better": "lower"},
        "zm_price_cut_share": {"label": "Metro listings with a price cut (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zm_sale_to_list": {"label": "Metro sale price as a share of list price (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
        "zm_sales_count": {"label": "Metro homes sold in the month (Zillow)", "unit": "count", "agg": "sum"},
        "zm_heat": {"label": "Metro market heat index (Zillow)", "unit": "index", "agg": "pop_weighted_mean"},
        "zm_afford_own": {"label": "Metro new-buyer payment as a share of income (Zillow)", "unit": "pct", "agg": "pop_weighted_mean",
                          "better": "lower"},
        "zm_afford_rent": {"label": "Metro new-renter rent as a share of income (Zillow)", "unit": "pct", "agg": "pop_weighted_mean",
                           "better": "lower"},
        "zm_zhvf_12m": {"label": "Metro forecast home value change, 12 months (Zillow)", "unit": "pct", "agg": "pop_weighted_mean"},
    },
}

# key, path under public_csvs, field, kind (d dollars, i count, p fraction as 0 to 100, f one-decimal index).
# yoy: field for the change from the column twelve months earlier. hist: keep the last 72 monthly points for charts.
SERIES = [
    {"key": "zhvi", "file": "zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "field": "zm_zhvi", "kind": "d",
     "yoy": "zm_zhvi_yoy", "hist": True, "required": True},
    {"key": "zori_all", "file": "zori/Metro_zori_uc_sfrcondomfr_sm_month.csv", "field": "zm_zori_all", "kind": "d",
     "yoy": "zm_zori_all_yoy"},
    {"key": "zori_mf", "file": "zori/Metro_zori_uc_mfr_sm_month.csv", "field": "zm_zori_mf", "kind": "d",
     "yoy": "zm_zori_mf_yoy", "hist": True},
    {"key": "zori_sfr", "file": "zori/Metro_zori_uc_sfr_sm_month.csv", "field": "zm_zori_sfr", "kind": "d",
     "yoy": "zm_zori_sfr_yoy"},
    {"key": "zordi", "file": "zordi/Metro_zordi_uc_sfrcondomfr_month.csv", "field": "zm_zordi", "kind": "f"},
    {"key": "invt_fs", "file": "invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv", "field": "zm_inventory", "kind": "i",
     "yoy": "zm_inventory_yoy", "hist": True},
    {"key": "new_listings", "file": "new_listings/Metro_new_listings_uc_sfrcondo_sm_month.csv", "field": "zm_new_listings",
     "kind": "i"},
    {"key": "doz_pending", "file": "med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv",
     "field": "zm_days_pending", "kind": "i"},
    {"key": "price_cut", "file": "perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv",
     "field": "zm_price_cut_share", "kind": "p"},
    {"key": "sale_to_list", "file": "mean_sale_to_list/Metro_mean_sale_to_list_uc_sfrcondo_sm_month.csv",
     "field": "zm_sale_to_list", "kind": "p"},
    {"key": "sales_count", "file": "sales_count_raw/Metro_sales_count_raw_uc_sfrcondo_month.csv", "field": "zm_sales_count",
     "kind": "i"},
    {"key": "heat", "file": "market_temp_index/Metro_market_temp_index_uc_sfrcondo_month.csv", "field": "zm_heat", "kind": "f"},
    {"key": "afford_own", "file": "new_homeowner_affordability/Metro_new_homeowner_affordability_downpayment_0.20_uc_"
                                  "sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "field": "zm_afford_own", "kind": "p"},
    {"key": "afford_rent", "file": "new_renter_affordability/Metro_new_renter_affordability_uc_sfrcondomfr_sm_sa_month.csv",
     "field": "zm_afford_rent", "kind": "p"},
    {"key": "zhvf", "file": "zhvf_growth/Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "field": "zm_zhvf_12m",
     "forecast": True},
]


def parse(path, key, resolve, min_regions=MIN_REGIONS):
    """One series file by its SERIES key -> (data {cbsa: {field: value}}, hist, rows read, newest YYYY-MM, seen). `resolve`
    maps (RegionName, StateName) to a CBSA code or None (see _cbsa_names.resolver)."""
    s = next(x for x in SERIES if x["key"] == key)
    return Z.parse_one(path, "msa", s, resolve, min_regions)


def load(ctx):
    cbsas, vintage = _cbsa_names.load(ctx)
    resolve, memo = _cbsa_names.resolver(cbsas)
    data, hist, rows, newest, missing, seen = Z.collect(ctx, "msa", SERIES, resolve, min_regions=MIN_REGIONS)
    if len(data) < MIN_MATCHED:
        raise SourceUnavailable("Zillow metros matched only %d CBSAs (expected 800 or more)" % len(data))
    matched = sum(1 for k in seen if memo.get(k))
    parts = ["Zillow metros matched to a CBSA by city and state: %d of %d, the rest dropped (census delineation %s)."
             % (matched, len(seen), vintage)]
    lag = Z.lag_note(newest)
    if lag:
        parts.append(lag)
    if missing:
        parts.append("Not loaded, fields empty: %s." % "; ".join(missing))
    return {"as_of": max(newest.values()), "rows": rows, "data": data, "hist": hist, "note": " ".join(parts)}
