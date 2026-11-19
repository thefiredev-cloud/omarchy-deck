#!/usr/bin/env python3
"""Validate the live deck feeds against their contract, and say what was measured.

    .venv/bin/python scripts/validate_feeds.py            # all three feeds, exit 1 on failure
    .venv/bin/python scripts/validate_feeds.py jobs       # one feed
    .venv/bin/python scripts/validate_feeds.py --json     # raw report

Reads only. Counts come from the file on disk, and a missing feed fails instead of passing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from deck_feeds_mcp import contract

CHECKS = {"jobs": contract.validate_jobs,
          "interest-profile": contract.validate_interest_profile,
          "launch": contract.validate_launch}


def report(name: str) -> dict:
    return CHECKS[name]()


def line(check: dict) -> str:
    mark = "PASS" if check["ok"] else "FAIL"
    return f"  [{mark}] {check['check']}: {check['detail']}"


def show(name: str) -> bool:
    found = report(name)
    print(f"{name}: {'ok' if found.get('ok') else 'FAILED'}")
    source = found.get("source") or {}
    if source.get("file"):
        print(f"  file {source['file']} · generated {source.get('generated_at')} · "
              f"age {source.get('age_s')}s · stale {source.get('stale')}")
    if "error" in found:
        print(f"  error: {found['error']}")
        return False
    if name == "jobs":
        print(f"  rows {found['rows']} · categories " +
              ", ".join(f"{slug}={count}" for slug, count in sorted(found["categories"].items())))
        print("  metros " + ", ".join(f"{slug}={count}" for slug, count in sorted(found["metros"].items())))
        print(f"  remote-pay violations {found['remote_pay_violations']}")
    elif name == "interest-profile":
        print(f"  keys {', '.join(found['keys'])}")
        print(f"  interests {found['interests']} · job_targets {found['job_targets']} · "
              f"pending {found['pending']}")
    elif name == "launch":
        print(f"  keys {', '.join(found['keys'])}")
        print(f"  items {found['items']} · kinds " +
              ", ".join(f"{kind}={count}" for kind, count in sorted(found["kinds"].items())))
    for check in found["checks"]:
        print(line(check))
    return bool(found.get("ok"))


def main(argv: list[str]) -> int:
    raw = "--json" in argv
    names = [arg for arg in argv if not arg.startswith("-")] or list(CHECKS)
    unknown = [name for name in names if name not in CHECKS]
    if unknown:
        print(f"unknown feed(s): {', '.join(unknown)}; allowed: {', '.join(CHECKS)}", file=sys.stderr)
        return 2
    if raw:
        print(json.dumps({name: report(name) for name in names}, indent=1))
        return 0
    results = [show(name) for name in names]
    print("contract " + ("holds" if all(results) else "does not hold"))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
