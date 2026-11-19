"""Live smoke: start the stdio server and call every tool once. Prints quoted output."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastmcp import Client

RUN = str(Path(__file__).resolve().parent.parent / "run.py")

CALLS = [
    ("deck_feeds_status", {}),
    ("feed_freshness", {}),
    ("job_taxonomy", {}),
    ("job_market", {"category": "ai_software"}),
    ("jobs_search", {"category": "fire_ems", "limit": 3}),
    ("jobs_search", {"query": "paramedic", "limit": 2}),
    ("interest_profile_summary", {}),
    ("housing_market", {"scope": "market"}),
    ("housing_segments", {"geo": "CA", "segment": "multifamily"}),
    ("surf_report", {}),
    ("hockey", {"team": "ANA"}),
    ("crons_attention", {"limit": 3}),
    ("fleet_status", {}),
    ("cluster_status", {}),
    ("release_status", {"attention_only": True}),
    ("deadlines", {"limit": 3}),
    ("network", {"limit": 3}),
    ("stalls", {"limit": 3}),
    ("deck_needs", {"limit": 3}),
    ("photos_on_this_day", {}),
    ("photo_years", {}),
    ("feed_contract", {"feed": "jobs"}),
]


async def main() -> int:
    async with Client(Path(RUN)) as client:
        tools = await client.list_tools()
        print(f"tool_count {len(tools)}: {', '.join(t.name for t in tools)}")
        for name, args in CALLS:
            result = await client.call_tool(name, args)
            payload = result.data if result.data is not None else {
                "content": [getattr(block, "text", None) for block in result.content]}
            text = json.dumps(payload, default=str)
            print(f"\n--- {name}({json.dumps(args)})")
            print(text[:900])
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
