"""Deterministic market-gap scoring for deck-feed-gaps (and its tests).

A gap is demand that outruns supply. Each domain builder in deck-feed-gaps turns its public evidence into two
indexes in [0, 1]: `demand` (1 = the strongest demand in that domain's universe) and `supply` (1 = the most supply or
competition). gap_score() turns them into 0-100. No randomness, no model: the same inputs always give the same score.
"""
import datetime as dt
import math
import re

W_DEMAND = 0.55
W_SUPPLY = 0.45
FIT_BONUS = 8  # points added at full owner-interest fit (interest-profile tag weight 1.0)
MIN_EVIDENCE = 2

METHOD = (
    "gap_score = round(clamp(100 * (0.55 * demand + 0.45 * (1 - supply)) * confidence + 8 * fit, 0, 100)). "
    "demand and supply are 0-1 indexes built per domain from public evidence: a percentile rank inside the domain's "
    "universe (metros with 300k+ people, CRE county and property-type groups, job categories, gig skills, store "
    "categories) or a fixed linear scale where the universe is too small; each builder lists its inputs in "
    "demand_signal and supply_signal. confidence = 0.7 + 0.1 per evidence row, capped at 1.0 (2 rows 0.9, 3+ rows 1.0); "
    "items with fewer than 2 evidence rows are never published. fit = the interest-profile tag weight (0-1) for the "
    "item's domain, a ranking nudge only, never evidence. Top 30 by score, with a per-domain cap so one domain cannot "
    "fill the list; slots a domain cannot use go to the next best items."
)


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def scale(x, lo, hi):
    """Linear 0-1 position of x between lo and hi (clamped). None stays None."""
    x = num(x)
    if x is None or hi == lo:
        return None
    return clamp((x - lo) / (hi - lo))


def pct_rank(universe, v):
    """Share of the universe's known values at or below v (0-1). None when v or the universe is unknown."""
    v = num(v)
    vals = [n for n in (num(u) for u in universe) if n is not None]
    if v is None or not vals:
        return None
    below = sum(1 for n in vals if n < v)
    equal = sum(1 for n in vals if n == v)
    return clamp((below + 0.5 * equal) / len(vals))


def mean(xs):
    """Mean of the known values; None when none are known."""
    vals = [n for n in (num(x) for x in xs) if n is not None]
    return sum(vals) / len(vals) if vals else None


def gap_score(demand, supply, evidence_n, fit=0.0):
    """0-100 gap score, or None when the item cannot be published (unknown index or under 2 evidence rows)."""
    demand, supply = num(demand), num(supply)
    if demand is None or supply is None or not isinstance(evidence_n, int) or evidence_n < MIN_EVIDENCE:
        return None
    base = 100.0 * (W_DEMAND * clamp(demand) + W_SUPPLY * (1.0 - clamp(supply)))
    confidence = min(1.0, 0.7 + 0.1 * evidence_n)
    bonus = FIT_BONUS * clamp(num(fit) or 0.0)
    return int(round(clamp(base * confidence + bonus, 0.0, 100.0)))


def iso_as_of(v):
    """A source's as-of label as an ISO date or timestamp: '2026-10' -> '2026-10-01', '2026-Q1' -> '2026-01-01',
    '2025' -> '2025-01-01', '2025-10 to 2026-09' and '2020-2024' take the end, an epoch becomes an ISO timestamp.
    Unknown text gives None (the caller drops the evidence row rather than inventing a date)."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        if v <= 0:
            return None
        return dt.datetime.fromtimestamp(v, dt.timezone.utc).replace(microsecond=0).isoformat()
    s = str(v).strip()
    if " to " in s:
        s = s.split(" to ")[-1].strip()
    m = re.fullmatch(r"(\d{4})-(\d{4})", s)
    if m:
        s = m.group(2)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(T[\d:.]+([+-]\d{2}:\d{2}|Z)?)?$", s)
    if m:
        return s
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        return "%s-%s-01" % m.groups()
    m = re.fullmatch(r"(\d{4})-?Q([1-4])", s, re.I)
    if m:
        return "%s-%02d-01" % (m.group(1), 3 * int(m.group(2)) - 2)
    m = re.fullmatch(r"(\d{4})", s)
    if m:
        return s + "-01-01"
    return None
