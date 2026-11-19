"""Realtor.com listings core metrics by state, newest month. Level "state".

One small public file (about 17 KB, 50 states and DC). Realtor.com publishes hotness for ZIPs and metros but not for states,
so there are no rds_hotness, rds_supply_score or rds_demand_score fields.
"""
import re

import _realtor_core as core

CORE_URL = core.BASE + "/Core/RDC_Inventory_Core_Metrics_State.csv"
MIN_STATES = 40  # 50 states and DC

SOURCE = {
    "id": "realtor_state",
    "name": "Realtor.com listings core metrics, state",
    "publisher": "Realtor.com Economic Research",
    "homepage": core.HOMEPAGE,
    "level": "state",
    "native": "state",
    "group": "residential",
    "cadence": "monthly",
    "license": core.LICENSE,
    "key_env": None,
    "fields": {
        **{"rds_" + s: {"label": core.labelled("State", label), "unit": unit, "agg": "none", **({"better": better} if better else {})}
           for s, (label, unit, better) in core.FIELD_SPECS.items()},
        "rds_low_quality": {"label": "Realtor.com flags this state's data as thin", "unit": "flag", "agg": "none"},
    },
}


def state_key(value):
    text = (value or "").strip().upper()
    return text if re.fullmatch(r"[A-Z]{2}", text) else None


def parse(path, min_rows=MIN_STATES):
    """Newest month of the core state file. -> (data, rows, as_of, info). Keys are 2-letter USPS codes."""
    return core.parse_core(path, "rds_", "state_id", state_key, "state core metrics", min_rows)


def load(ctx):
    path, meta = ctx.fetch(CORE_URL, "state.csv", timeout=60, min_bytes=5_000)
    data, rows, as_of, info = parse(path)
    ctx.log("%d state rows for %s (%s)" % (len(data), as_of, meta.get("status")))
    notes = ["Source month %s" % as_of,
             "Realtor.com flagged %d of %d states as thin data" % (info["flagged"], len(data)),
             "hotness is not published for states",
             "shares and year-over-year changes are percent"]
    if info["no_key"]:
        notes.insert(2, "%d row with no state code was skipped" % info["no_key"])
    return {"as_of": as_of, "rows": rows, "data": data, "note": "; ".join(notes) + "."}
