"""Pixel Deck read-only Hermes plugin candidate (native directory plugin).

Registers five fixed, no-argument tools. Each handler calls the audit engine
`scripts/deck_audit.py` of the pixel-deck checkout, which performs allowlisted GET requests to
127.0.0.1:8796 with the deck credential read by the engine at call time.
The handlers take no URL, host, port, path or credential arguments, and return a JSON string of
sanitized counts, status, source and time. Failures are explicit statuses (auth_failed,
unavailable, route_missing, bad_reply), never zero.

Hermes plugin contract: handler(args: dict, **kwargs) -> str (JSON). Extra dispatcher kwargs
(task_id, session_id, ...) are accepted and ignored.
Candidate only: nothing here activates itself. Install and enable are owner steps.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

# Engine lookup: sibling checkout layout first (integrations/hermes-plugin -> ../../scripts), then the
# fixed home checkout path. Only these two fixed locations are ever loaded.
_HERE = Path(__file__).resolve().parent
_CANDIDATES = (_HERE.parent.parent / "scripts" / "deck_audit.py",
               Path.home() / "projects/meshvault/pixel-deck/scripts/deck_audit.py")
_ENGINE_NAME = "pixel_deck_audit_engine"
_TOOLSET = "pixel_deck"

_NO_ARGS = {"type": "object", "properties": {}, "additionalProperties": False}

# name -> (engine tool key, description)
TOOLS: dict[str, tuple[str, str]] = {
    "deck_today": ("today", ("Read-only Pixel Deck Today summary: gateway, mail unread counts by role, cron counts, "
                             "market headline counts, WHOOP metric presence. Counts, status, source and time only. "
                             "No addresses, subjects, finance or health values.")),
    "deck_traffic": ("traffic", ("Read-only website traffic from the Pixel Deck /api/traffic cache: per-site status, "
                                 "organic search clicks (not total visits), window and timestamp. "
                                 "Returns route_missing when the running binary predates the route.")),
    "deck_cameras": ("cams", ("Read-only camera readiness from the Pixel Deck: ready and reader counts per camera. "
                              "No images, snapshots, stream URLs or camera keys.")),
    "deck_sites": ("sites", "Read-only site uptime counts from the Pixel Deck /api/sites cache with source and time."),
    "deck_endpoint_audit": ("audit", ("Read-only Pixel Deck endpoint audit: liveness, auth enforced, each read "
                                      "route, per-section freshness, and served-versus-disk asset hashes. Flags when "
                                      "embedded assets need cargo rebuild plus an approved restart.")),
}


def _load_engine():
    mod = sys.modules.get(_ENGINE_NAME)
    if mod is not None:
        return mod
    path = next((p for p in _CANDIDATES if p.is_file()), None)
    if path is None:
        raise FileNotFoundError("deck_audit engine not found")
    spec = importlib.util.spec_from_file_location(_ENGINE_NAME, path)
    if spec is None or spec.loader is None:
        raise ImportError("deck_audit engine not loadable")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_ENGINE_NAME] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(_ENGINE_NAME, None)
        raise
    return mod


def _make_handler(tool_key: str):
    def handler(args: dict | None = None, **kwargs: Any) -> str:
        # args and kwargs are deliberately ignored: no caller input can reach the request.
        try:
            eng = _load_engine()
            transport = eng.LoopbackTransport(timeout=5.0)
            result = eng.run_tool(tool_key, transport)
            return eng.render(result, transport)
        except Exception as exc:  # never raise into the dispatcher; never echo details
            return json.dumps({"tool": tool_key, "status": "unavailable",
                               "reason": f"plugin error: {type(exc).__name__}"})

    return handler


def register(ctx) -> None:
    """Register the five read-only tools. No hooks, no commands, no side effects."""
    for name, (key, desc) in TOOLS.items():
        ctx.register_tool(
            name=name,
            toolset=_TOOLSET,
            schema={"name": name, "description": desc, "parameters": _NO_ARGS},
            handler=_make_handler(key),
            description=desc,
            emoji="🎛️",
        )
