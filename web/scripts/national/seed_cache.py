#!/usr/bin/env python3
"""One-time seed of the plugin download cache from the old national collector cache (DataArch section 3).

Hard-links every file the wrapped legacy sources use from `~/.cache/deck-housing-national/` into
`~/.cache/deck-data/<id>/` with its `.meta.json` (same URL, ETag, Last-Modified and check times), so the first v2 run
sends conditional requests instead of downloading 1.2 GB again. Files already present are left alone. A hard link
needs both folders on one filesystem; otherwise the file is copied.

Usage: seed_cache.py [--dry-run]
"""
import json
import os
import shutil
import sys

OLD = os.path.expanduser("~/.cache/deck-housing-national")
NEW = os.path.expanduser(os.environ.get("DECK_DATA_CACHE", "~/.cache/deck-data"))
# source id -> cache file names (the same names the wrappers pass to ctx.fetch)
FILES = {
    "zillow_zhvi": ["zhvi_zip.csv"],
    "zillow_zori": ["zori_zip.csv"],
    "realtor_zip": ["rdc_zip.csv"],
    "realtor_zip_history": ["rdc_zip_history.csv"],
    "census_gazetteer": ["gaz_zcta.zip"],
    "census_zcta_county": ["zcta_county.txt"],
    "census_cbsa": ["cbsa_list1.xlsx"],
    "geonames_postal": ["geonames_us.zip"],
    "census_acs5": ["acs5_b01002.dat", "acs5_b01003.dat", "acs5_b19013.dat", "acs5_b25002.dat", "acs5_b25003.dat",
                    "acs5_b25035.dat", "acs5_b25064.dat"],
    "hud_safmr": ["safmr.xlsx"],
    "fhfa_zip5": ["fhfa_zip5.xlsx"],
    "census_zbp": ["zbp_totals_cur.zip"],
    "census_zbp_detail": ["zbp_totals_cur.zip", "zbp_detail_cur.zip"],
    "census_zbp_prior": ["zbp_totals_cur.zip", "zbp_totals_old.zip"],
    "ipeds_hd": ["ipeds_hd.zip"],
    "ipeds_enroll": ["ipeds_drvef.zip"],
    "nces_edge_schools": ["edge_publicsch.zip"],
    "chr_homicides": ["chr_analytic.csv", "chr_measures_2025.pdf"],
}


def seed(old=OLD, new=NEW, dry=False, log=print):
    """Returns (linked, copied, present, missing) counts."""
    counts = {"linked": 0, "copied": 0, "present": 0, "missing": 0}
    for sid, names in FILES.items():
        d = os.path.join(new, sid)
        for name in names:
            src, meta = os.path.join(old, name), os.path.join(old, name + ".meta.json")
            dst, dmeta = os.path.join(d, name), os.path.join(d, name + ".meta.json")
            if not (os.path.exists(src) and os.path.exists(meta)):
                counts["missing"] += 1
                continue
            if os.path.exists(dst) and os.path.exists(dmeta):
                counts["present"] += 1
                continue
            if dry:
                log("would seed %s/%s" % (sid, name))
                continue
            os.makedirs(d, mode=0o700, exist_ok=True)
            if os.path.exists(dst):
                os.unlink(dst)
            try:
                os.link(src, dst)
                counts["linked"] += 1
            except OSError:
                shutil.copy2(src, dst)
                os.chmod(dst, 0o600)
                counts["copied"] += 1
            with open(meta, encoding="utf8") as fh:
                m = json.load(fh)
            with open(dmeta + ".part", "w", encoding="utf8") as fh:
                json.dump(m, fh)
            os.replace(dmeta + ".part", dmeta)
    return counts


if __name__ == "__main__":
    print(json.dumps(seed(dry="--dry-run" in sys.argv[1:])))
