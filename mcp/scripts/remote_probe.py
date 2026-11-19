"""Call one deck-feeds tool through a remote stdio hop, e.g. OMP on Dell over ssh.

Usage:
  python3 scripts/remote_probe.py TOOL '{"json": "args"}'
  DECK_FEEDS_REMOTE="ssh -o BatchMode=yes pc-desktop-user /path/run.py" ...

The command defaults to the local venv server, so this doubles as a handshake
test that waits for each response instead of racing the stream.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = f"{ROOT}/.venv/bin/python {ROOT}/run.py"


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
    tool = argv[1] if len(argv) > 1 else "deck_feeds_status"
    args = json.loads(argv[2]) if len(argv) > 2 else {}
    command = shlex.split(os.environ.get("DECK_FEEDS_REMOTE") or DEFAULT)
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    assert proc.stdin is not None and proc.stdout is not None
    try:
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "deck-feeds-remote-probe", "version": "1"}}}) + "\n")
        proc.stdin.flush()
        print("initialize", json.dumps(read(proc)["result"]["serverInfo"]))
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        proc.stdin.flush()
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}) + "\n")
        proc.stdin.flush()
        tools = read(proc)["result"]["tools"]
        print("tools", len(tools))
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                     "params": {"name": tool, "arguments": args}}) + "\n")
        proc.stdin.flush()
        result = read(proc)
        if "error" in result:
            print("error", json.dumps(result["error"]))
            return 1
        blocks = result["result"].get("content") or []
        print(blocks[0]["text"][:800] if blocks else json.dumps(result["result"])[:800])
    finally:
        proc.stdin.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
