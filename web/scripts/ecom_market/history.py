"""The feed's own memory between runs: daily product prices and ranks, daily Tranco and App Store ranks, and page
values (container rates, USPS prices) that have no published history. One JSON file, written atomically, mode 600.

Shape: {"v": 1, "prices": {gid: {"t": title, "c": category, "d": {day: price}, "n": {day: platforms}}},
        "ranks": {gid: {day: rank}},
        "series": {"tranco": {domain: {day: rank}}, "app": {app_id: {day: rank}}, "macro": {key: {period: value}},
                   "watch_n": {slug: {day: listings}}, "watch_sample": {slug: {day: {pack, ml, g}}}}}"""
import json
import os
import tempfile

from .util import days_between

STATE = os.path.expanduser(os.environ.get("DECK_ECOM_STATE", "~/.local/state/deck-ecom-market/history.json"))
KEEP_DAYS = 45
MAX_PRODUCTS = 6000


class History:
    def __init__(self, path=None):
        self.path = path or STATE
        try:
            with open(self.path, encoding="utf8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            data = {}
        if not isinstance(data, dict) or data.get("v") != 1:
            data = {}
        self.prices = data.get("prices") or {}
        self.ranks = data.get("ranks") or {}
        self.series = data.get("series") or {}

    # ------------------------------------------------------------ writes
    def put_price(self, gid, day, price, title=None, category=None, platforms_n=None):
        if price is None:
            return
        rec = self.prices.setdefault(gid, {"t": title, "c": category, "d": {}})
        if title:
            rec["t"] = title
        if category:
            rec["c"] = category
        rec["d"][day] = round(float(price), 2)
        if platforms_n:
            rec.setdefault("n", {})[day] = int(platforms_n)

    def put_rank(self, gid, day, rank):
        if rank is not None:
            self.ranks.setdefault(gid, {})[day] = int(rank)

    def put(self, series, key, period, value):
        if value is not None and key:
            self.series.setdefault(series, {}).setdefault(str(key), {})[period] = value

    # ------------------------------------------------------------ reads
    def price_days(self, gid):
        return (self.prices.get(gid) or {}).get("d") or {}

    def platform_days(self, gid):
        return (self.prices.get(gid) or {}).get("n") or {}

    def rank_days(self, gid):
        return self.ranks.get(gid) or {}

    def get(self, series, key):
        return (self.series.get(series) or {}).get(str(key)) or {}

    # ------------------------------------------------------------ upkeep
    def prune(self, today):
        def keep(days):
            return {d: v for d, v in days.items() if len(d) != 10 or days_between(d, today) <= KEEP_DAYS}
        for gid in list(self.prices):
            self.prices[gid]["d"] = keep(self.prices[gid]["d"])
            if "n" in self.prices[gid]:
                self.prices[gid]["n"] = keep(self.prices[gid]["n"])
            if not self.prices[gid]["d"]:
                del self.prices[gid]
        for gid in list(self.ranks):
            self.ranks[gid] = keep(self.ranks[gid])
            if not self.ranks[gid]:
                del self.ranks[gid]
        if len(self.prices) > MAX_PRODUCTS:  # drop the products seen longest ago
            order = sorted(self.prices, key=lambda g: max(self.prices[g]["d"]), reverse=True)
            for gid in order[MAX_PRODUCTS:]:
                self.prices.pop(gid, None)
                self.ranks.pop(gid, None)
        for name, keys in self.series.items():
            if name == "macro":  # page values: keep the newest 36 periods
                for k in keys:
                    keys[k] = dict(sorted(keys[k].items())[-36:])
            else:
                for k in list(keys):
                    keys[k] = keep(keys[k])

    def save(self):
        d = os.path.dirname(self.path)
        os.makedirs(d, mode=0o700, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".history.", dir=d)
        try:
            with os.fdopen(fd, "w", encoding="utf8") as fh:
                json.dump({"v": 1, "prices": self.prices, "ranks": self.ranks, "series": self.series}, fh,
                          separators=(",", ":"))
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
