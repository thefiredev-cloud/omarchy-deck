"""Regenerate deck_feeds_mcp/taxonomy_contract.json from the Jobs collector's canonical taxonomy.

The collector module ``deck_jobs_taxonomy.py`` (pure constants and functions, no I/O) is the source of
truth. This script imports it and writes the same data this server loads, so the seed cannot drift
from the feed. ``rules.remote_min_pay`` comes from ``MIN_PAY_REMOTE`` in the collector script
``deck-feed-jobs``; when that line cannot be read the value already in the contract is kept.

Usage:
    python3 scripts/gen_taxonomy_contract.py            # rewrite the contract
    python3 scripts/gen_taxonomy_contract.py --check    # exit 1 if the contract differs, write nothing
    python3 scripts/gen_taxonomy_contract.py --bin DIR  # collector directory, default ~/ops/bin
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "deck_feeds_mcp" / "taxonomy_contract.json"
HOME = "Huntington Beach, CA"
IN_PERSON = ["south_oc", "oc", "sd", "la"]


def load_collector(bin_dir: Path):
    path = bin_dir / "deck_jobs_taxonomy.py"
    spec = importlib.util.spec_from_file_location("deck_jobs_taxonomy", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def remote_min_pay(bin_dir: Path, current: dict) -> int:
    try:
        text = (bin_dir / "deck-feed-jobs").read_text(encoding="utf-8")
        found = re.search(r"^MIN_PAY_REMOTE\s*=\s*(\d+)", text, re.MULTILINE)
        if found:
            return int(found.group(1))
    except OSError:
        pass
    return int((current.get("rules") or {}).get("remote_min_pay") or 100000)


def build(bin_dir: Path, current: dict) -> dict:
    t = load_collector(bin_dir)
    return {
        "sources": "ops/bin/deck_jobs_taxonomy.py (the Jobs collector's canonical taxonomy)",
        "home": HOME,
        "metros": {"south_oc": list(t.SOUTH_OC), "oc": list(t.OC), "la": list(t.LA), "sd": list(t.SD)},
        "taxonomy": t.TAXONOMY,
        "rules": {"home": HOME, "in_person_metros": IN_PERSON, "remote_min_pay": remote_min_pay(bin_dir, current)},
        "default_sub": dict(t.DEFAULT_SUB),
        "title_drop": t.TITLE_DROP.pattern,
        "keyword_rules": [{"category": c, "subcategory": s, "weight": w, "pattern": p} for c, s, w, p in t.MATCH],
        "context_rules": [{"category": c, "weight": w, "pattern": p} for c, (w, p) in t.CONTEXT.items()],
        "remote_foreign_pattern": t._FOREIGN.pattern,
        "remote_us_ok_pattern": t._US_OK.pattern,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bin", default="~/ops/bin", help="collector directory")
    parser.add_argument("--check", action="store_true", help="compare only; exit 1 when the contract is stale")
    args = parser.parse_args()
    bin_dir = Path(args.bin).expanduser()
    current = json.loads(CONTRACT.read_text(encoding="utf-8")) if CONTRACT.is_file() else {}
    wanted = build(bin_dir, current)
    if args.check:
        if wanted == current:
            print("taxonomy_contract.json matches the collector")
            return 0
        print("taxonomy_contract.json is stale: run scripts/gen_taxonomy_contract.py")
        return 1
    CONTRACT.write_text(json.dumps(wanted, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {CONTRACT.relative_to(ROOT)}: {len(wanted['taxonomy'])} categories, "
          f"{len(wanted['keyword_rules'])} keyword rules, {len(wanted['context_rules'])} context rules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
