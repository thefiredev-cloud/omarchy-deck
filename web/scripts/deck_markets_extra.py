"""Shared pieces for the extra Invest collectors and their merge into markets.json.

deck-feed-markets-calendar writes ~/.kodros/status/house-feeds/markets-calendar.json;
deck-feed-markets-filings writes ~/.kodros/status/deck/markets-filings.json. Both hold a `catalysts` list in
exactly the item shape markets.json already uses (date, time_et, title, detail, impact, kind, source, url,
optional symbol, watch, when, eps_est), so the deck needs no new endpoint. deck-feed-markets reads them
every run and merges the items into markets.json: upcoming events stay one list in date order, and the
recent items (kind "filing" and "news", already published) follow it, newest first.

Read-only public sources only: no account, no key, no order. A collector that fails leaves its error in its
own file and a stale or missing file is reported in markets.json `errors`, never silently dropped.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from deck_feed_common import HOUSE_OUT_DIR, OUT_DIR  # noqa: E402

PLUGIN_WATCHLIST = os.path.expanduser("~/.local/state/omarchy/costafot.markets/watchlist.json")
EXTRA = os.path.expanduser("~/.config/deck-markets/watchlist.json")
BASE_WATCH = ["NVDA", "AAPL", "MSFT", "SPY", "XLV"]

RECENT_KINDS = ("filing", "news")
EXTRA_FEEDS = ("markets-calendar", "markets-filings")
# markets-calendar is a public house-wall feed (canonical in house-feeds); markets-filings stays
# owner-only beside the rest of the deck feeds.
FEED_DIRS = {"markets-calendar": HOUSE_OUT_DIR, "markets-filings": OUT_DIR}
UPCOMING_MAX = 120
RECENT_MAX = 80
IMPACT_ORDER = {"H": 0, "M": 1, "L": 2}
FUTURE_SLACK = 60  # seconds a feed stamp may run ahead of the reader's clock before it counts as a bad clock


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def norm(sym):
    return (sym or "").strip().upper().replace(" ", "-")


def held_symbols():
    """Held stocks and ETFs: the IBKR Flex end-of-day report when it is at least as new as the owner snapshot (deck_holdings,
    files named by DECK_FLEX_CACHES and DECK_HOLDINGS_FILE). Neither named: nothing is held, never a guessed path."""
    import deck_holdings as H

    def iso_epoch(text):
        import datetime as dt
        try:
            return int(dt.datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None

    return [s for s, _q in H.best(H.read_snapshot() or {}, iso_epoch)["equities"]]


def watch_symbols(held):
    """Held symbols, the Markets bar plugin watchlist (stocks and ETFs), a small base list, then the optional
    extra list. Order is stable and de-duplicated."""
    syms = list(held)
    for e in read_json(PLUGIN_WATCHLIST) or []:
        if isinstance(e, dict) and e.get("category") == "stock" and (e.get("in_watchlist") or e.get("is_favorite")):
            syms.append(norm(e.get("symbol")))
    syms += BASE_WATCH
    syms += [norm(s) for s in ((read_json(EXTRA) or {}).get("extra") or []) if isinstance(s, str)]
    out = []
    for s in syms:
        if s and s not in out:
            out.append(s)
    return out


def load_extra(name, now):
    """(items, src, errors) from one extra collector file. A missing, unreadable or out-of-date file gives no
    items and one error, so the Invest tab says the source is not reporting instead of showing old rows."""
    doc = read_json(os.path.join(FEED_DIRS.get(name, OUT_DIR), name + ".json"))
    if not isinstance(doc, dict):
        return [], [], [{"source": name, "reason": "feed file missing or unreadable"}]
    errors = [e for e in doc.get("errors") or [] if isinstance(e, dict)]
    t, refresh = doc.get("t"), doc.get("refresh")
    # a stamp ahead of the clock (a few seconds of skew aside) or no positive refresh period cannot show its age: it is out of date
    if not isinstance(t, int) or not isinstance(refresh, int) or refresh <= 0 or t - now > FUTURE_SLACK or now - t > 3 * refresh:
        age = ("unknown age" if not isinstance(t, int) or not isinstance(refresh, int) or refresh <= 0
               else "stamped in the future" if t > now else "%d min old" % ((now - t) // 60))
        return [], [], errors + [{"source": name, "reason": "feed is out of date (%s)" % age}]
    items = [c for c in doc.get("catalysts") or []
             if isinstance(c, dict) and isinstance(c.get("date"), str) and isinstance(c.get("title"), str)]
    return items, [s for s in doc.get("src") or [] if isinstance(s, str)], errors


def _upcoming_key(c):
    return (c["date"], c.get("time_et") or ("08:00" if c.get("when") == "BMO" else "16:30"),
            IMPACT_ORDER.get(c.get("impact"), 3), c["title"])


def merge_catalysts(core, extras):
    """One catalysts list for markets.json: upcoming events in date order, then recent filings and news,
    newest first. The same event from two sources (same date, symbol and title) is kept once, core first."""
    seen, upcoming, recent = set(), [], []
    for c in list(core) + list(extras):
        key = (c["date"], c.get("symbol") or "", c["title"].lower())
        if key in seen:
            continue
        seen.add(key)
        (recent if c.get("kind") in RECENT_KINDS else upcoming).append(c)
    upcoming.sort(key=_upcoming_key)
    recent.sort(key=lambda c: (c["date"], c.get("time_et") or "00:00"), reverse=True)
    return upcoming[:UPCOMING_MAX] + recent[:RECENT_MAX]
