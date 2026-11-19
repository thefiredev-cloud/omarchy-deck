# deck-feeds-mcp

A read-only MCP server that lets an AI agent read the deck's feed files. It runs on the same server as the deck, speaks MCP over stdio, opens no network connection and writes nothing.

## What it reads

JSON files under `~/.meshvault/status/` (`deck/`, `house-feeds/` and a few shared feeds at the top level). Set `DECK_FEEDS_ROOT` to read another tree, for example `../samples/home/.meshvault/status`.

Every feed-backed answer carries a `source` object: `file`, `read_at`, `generated_at`, `age_s`, `refresh_s`, `stale`, `feed_errors` and `feed_src`. An agent can see how old a number is before it repeats it. A missing feed answers `ok: false` instead of an empty list.

## Tools

29 tools, grouped by feed:

| Area | Tools |
|---|---|
| Work | `jobs_search`, `job_market`, `job_taxonomy`, `gigs`, `interest_profile_summary` |
| Housing | `housing_market`, `housing_segments` |
| Outdoors and life | `surf_report`, `outdoors`, `life`, `travel_deals`, `shop_deals`, `hockey`, `history_goodnews` |
| Fleet and ops | `cluster_status`, `fleet_status`, `crons_attention`, `stalls`, `network`, `deck_needs`, `deadlines`, `reply_block`, `rank_watch`, `release_status` |
| Photos | `photos_on_this_day`, `photo_years` |
| Meta | `feed_freshness`, `feed_contract`, `deck_feeds_status` |

`feed_contract` checks a feed against its published contract (field shapes, allowed values, freshness). `scripts/validate_feeds.py` runs the same checks from the command line.

## Run

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests
.venv/bin/python run.py
```

Register `run.py` in your MCP client as a stdio server. `scripts/probe.py` sends raw JSON-RPC without the fastmcp dependency.

## Limits

- Single user. It trusts the files it reads and the user it runs as.
- The job tools expect the feed's own `taxonomy` and `rules` blocks; `deck_feeds_mcp/taxonomy_contract.json` is the fallback.
