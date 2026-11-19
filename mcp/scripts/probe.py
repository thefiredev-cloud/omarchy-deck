"""Raw JSON-RPC probe: no fastmcp dependency, so any harness path can be checked.

Usage: python3 scripts/probe.py [tool_name [json_args]]
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN = str(ROOT / "run.py")
PY = str(ROOT / ".venv" / "bin" / "python")


def send(proc, message: dict) -> None:
    proc.stdin.write(json.dumps(message) + "\n")
    proc.stdin.flush()


def read(proc) -> dict:
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("server closed stdout")
        try:
            payload = json.loads(line)
        except ValueError:
            continue
        if isinstance(payload, dict) and payload.get("jsonrpc") == "2.0":
            return payload


def main(argv: list[str]) -> int:
    tool = argv[1] if len(argv) > 1 else ""
    args = json.loads(argv[2]) if len(argv) > 2 else {}
    proc = subprocess.Popen([PY, RUN], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        send(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                               "clientInfo": {"name": "deck-feeds-probe", "version": "1"}}})
        print("initialize", json.dumps(read(proc).get("result", {}).get("serverInfo")))
        send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        send(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools = read(proc)["result"]["tools"]
        print("tools", len(tools), [t["name"] for t in tools])
        if tool:
            send(proc, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                        "params": {"name": tool, "arguments": args}})
            reply = read(proc)
            print(f"call {tool} {json.dumps(args)}")
            if "error" in reply:
                print(f"error {json.dumps(reply['error'])}")
                return 1
            result = reply["result"]
            text = result["content"][0]["text"] if result.get("content") else json.dumps(result)
            print(text[:2000])
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
