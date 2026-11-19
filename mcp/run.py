#!/usr/bin/env python3
"""Run the deck-feeds stdio MCP server.

No credentials and no environment file: the server only reads JSON feeds under
~/.meshvault/status. Set DECK_FEEDS_ROOT to point it at another status tree.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deck_feeds_mcp.server import mcp

if __name__ == "__main__":
    mcp.run()
