"""Read-only public market data for the deck feeds and the daily brief.

Used by deck-feed-markets, deck-feed-portfolio and markets-brief. Nothing here holds a credential,
touches an account, or places an order. Every record carries its source and the epoch of the
price it describes; a failed source gives a FetchError (callers record it and leave the field
null), never a zero.

Sources, all public and keyless:
  quotes             query1.finance.yahoo.com v8 chart (daily bars + regularMarketPrice), Cboe delayed quote as fallback
  crypto             api.kraken.com public Ticker and OHLC
  movers             Yahoo predefined screeners (day_gainers, day_losers, most_actives)
  earnings calendar  api.nasdaq.com calendar/earnings
  macro calendar     BLS bls.ics (via the local scrape gateway, bls.gov refuses plain clients),
                     BEA release schedule, Federal Reserve FOMC calendar, plus two documented
                     rules (weekly jobless claims on Thursdays, ISM on business day 1 and 3)
"""
import datetime as dt
import html
import math
import os
import re
import sys
import urllib.parse
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from deck_feed_common import FetchError, gateway_fetch, http_get, http_json, short_reason  # noqa: E402,F401

ET = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
UA_BROWSER = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/126.0 Safari/537.36"}
# 3 months of daily bars: the quote plus the 1M and 3M charts in one request. range=5d was the quote alone.
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=3mo&interval=1d"
# today's 5-minute bars (the last session when the market is closed): the 1D chart
YAHOO_INTRA = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=5m"
CBOE = "https://cdn.cboe.com/api/global/delayed_quotes/quotes/%s.json"
KRAKEN = "https://api.kraken.com/0/public/"
SCREENER = ("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=%s&count=100")
NASDAQ_EARNINGS = "https://api.nasdaq.com/api/calendar/earnings?date=%s"
FED_CAL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BEA_SCHEDULE = "https://www.bea.gov/news/schedule"
BLS_ICS = "https://www.bls.gov/schedule/news_release/bls.ics"

# NYSE full-day closures (2026). Early closes are not modelled.
NYSE_HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
}

# Kraken response keys differ from the requested pair for the legacy-named assets.
KRAKEN_PAIRS = {"BTC": "XBTUSD", "ETH": "ETHUSD", "SOL": "SOLUSD", "XRP": "XRPUSD", "TRX": "TRXUSD"}


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def rnd(v, places=4):
    n = num(v)
    return None if n is None else round(n, places)


def newest(stamps):
    """Newest valid epoch of an iterable (None when there is none): the "as of" of a block that has many timestamps. A zero, a bool
    or junk is no timestamp. Each block of a feed reports its own as_of; none of them is the feed's generated_at."""
    good = [n for n in (num(s) for s in stamps) if n is not None and n > 0]
    return int(max(good)) if good else None


# ---------------------------------------------------------------- quotes

def series(stamps, closes):
    """Paired [epoch, close] chart points, oldest first. A bar without a close, or with an exact zero close (a feed
    hiccup, the same rule as a quote price), is skipped, never drawn as zero. Six significant digits keep the file
    small and still exceed what a chart can show."""
    out = []
    if not isinstance(stamps, (list, tuple)) or not isinstance(closes, (list, tuple)):
        return out
    for t, c in zip(stamps, closes):
        n, e = num(c), num(t)
        if n and e is not None and e > 0:
            out.append([int(e), float("%.6g" % n)])
    return out


def display_name(d):
    """The name to show for a Yahoo quote. Yahoo cuts shortName at 31 characters ("State Street SPDR S&P 500 ETF T",
    "Korea Electric Power Corporatio"); when the short name is the start of the long one it was cut, so the long name
    is used. Otherwise the short name stays: it is usually the better label."""
    short, full = d.get("shortName"), d.get("longName")
    if (isinstance(short, str) and isinstance(full, str) and len(short) >= 30 and len(full) > len(short)
            and full.lower().startswith(short.rstrip().lower())):
        return full
    return short or full


def parse_yahoo_chart(doc, symbol):
    """One Yahoo v8 chart document -> quote record. `pct` is Yahoo's own regular-session change when
    present (futures and indices carry it), else computed from the last two daily closes; `chg` is derived
    from price and pct so the pair always agrees."""
    try:
        res = doc["chart"]["result"][0]
        meta = res["meta"]
    except (KeyError, IndexError, TypeError) as exc:
        raise FetchError("yahoo: no chart result for %s" % symbol) from exc
    if not isinstance(meta, dict):
        raise FetchError("yahoo: no chart result for %s" % symbol)
    price = num(meta.get("regularMarketPrice"))
    if not price:  # missing or exactly 0: a feed hiccup, not a price
        raise FetchError("yahoo: no price for %s" % symbol)
    stamp = num(meta.get("regularMarketTime"))
    if not stamp or stamp <= 0:  # a price with no time cannot show its age: refuse it so the Cboe fallback (which is timed) can answer
        raise FetchError("yahoo: no quote time for %s" % symbol)
    indicators = res.get("indicators")
    quote_block = ((indicators.get("quote") if isinstance(indicators, dict) else None) or [{}])[0]
    raw_closes = quote_block.get("close") if isinstance(quote_block, dict) else None
    closes = [c for c in (num(x) for x in (raw_closes if isinstance(raw_closes, list) else [])) if c]
    pct = num(meta.get("regularMarketChangePercent"))
    prev = None
    if pct is None and len(closes) >= 2:
        prev = closes[-2]
        pct = (price / prev - 1) * 100
    if pct is not None and prev is None:
        prev = price / (1 + pct / 100) if pct > -100 else None
    return {
        "symbol": symbol,
        "name": display_name(meta),
        "price": rnd(price),
        "prev_close": rnd(prev),
        "chg": rnd(price - prev) if prev is not None else None,
        "pct": rnd(pct, 3),
        "t": int(stamp),
        "src": "yahoo",
        "url": YAHOO % urllib.parse.quote(symbol, safe="=-."),
        "volume": int(meta["regularMarketVolume"]) if num(meta.get("regularMarketVolume")) else None,
        "hist": series(res.get("timestamp"), raw_closes if isinstance(raw_closes, list) else []),
    }


def parse_yahoo_intraday(doc, symbol):
    """One Yahoo 1d/5m chart document -> {pts, prev, open, close}: the session path, the prior close it is measured
    against, and the regular session's bounds (so a chart can show how much of the day is still to come)."""
    try:
        res = doc["chart"]["result"][0]
        meta = res["meta"]
    except (KeyError, IndexError, TypeError) as exc:
        raise FetchError("yahoo: no intraday result for %s" % symbol) from exc
    if not isinstance(meta, dict):
        raise FetchError("yahoo: no intraday result for %s" % symbol)
    indicators = res.get("indicators")
    quote_block = ((indicators.get("quote") if isinstance(indicators, dict) else None) or [{}])[0]
    raw_closes = quote_block.get("close") if isinstance(quote_block, dict) else None
    pts = series(res.get("timestamp"), raw_closes if isinstance(raw_closes, list) else [])
    if len(pts) < 2:
        raise FetchError("yahoo: no intraday bars for %s" % symbol)
    period = meta.get("currentTradingPeriod")
    reg = period.get("regular") if isinstance(period, dict) else None
    reg = reg if isinstance(reg, dict) else {}
    prev = num(meta.get("chartPreviousClose"))
    if not prev:  # missing or exactly 0: a feed hiccup, never a zero baseline for the chart
        prev = num(meta.get("previousClose"))
    if not prev:
        prev = None
    return {"pts": pts, "prev": rnd(prev),
            "open": int(reg["start"]) if num(reg.get("start")) else None,
            "close": int(reg["end"]) if num(reg.get("end")) else None}


def intraday(symbol):
    return parse_yahoo_intraday(http_json(YAHOO_INTRA % urllib.parse.quote(symbol, safe="=-."), UA, 20), symbol)


def parse_cboe_quote(doc, symbol):
    d = doc.get("data") if isinstance(doc, dict) else None
    d = d if isinstance(d, dict) else {}
    price = num(d.get("close")) or num(d.get("current_price"))
    chg = num(d.get("price_change"))
    if not price or chg is None or not d.get("last_trade_time"):
        raise FetchError("cboe: no quote for %s" % symbol)
    try:
        t = dt.datetime.strptime(d["last_trade_time"], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=ET)
    except (TypeError, ValueError) as exc:  # a time we cannot read is no quote time: refuse the quote
        raise FetchError("cboe: unreadable trade time for %s" % symbol) from exc
    prev = price - chg
    known = round(prev, 6) != 0  # a zero prior close is no baseline: the price stays, its change is unknown, never a zero or infinite change
    return {
        "symbol": symbol, "name": None, "price": rnd(price), "prev_close": rnd(prev) if known else None,
        "chg": rnd(chg) if known else None, "pct": rnd(chg / prev * 100, 3) if known else None,
        "t": int(t.timestamp()), "src": "cboe",
        "url": CBOE % symbol, "volume": int(d["volume"]) if num(d.get("volume")) else None,
    }


def quote(symbol, errors=None):
    """Yahoo first, Cboe delayed as the fallback. Raises FetchError only when both fail."""
    try:
        return parse_yahoo_chart(http_json(YAHOO % urllib.parse.quote(symbol, safe="=-."), UA, 20), symbol)
    except FetchError as first:
        if symbol.startswith("^") or "=" in symbol or "-" in symbol:
            raise
        try:
            q = parse_cboe_quote(http_json(CBOE % symbol, UA, 20), symbol)
            if errors is not None:
                errors.append({"source": "yahoo " + symbol, "reason": short_reason(first) + "; used cboe"})
            return q
        except FetchError as second:
            raise FetchError("%s; %s" % (short_reason(first, 70), short_reason(second, 70))) from second


def parse_kraken_ticker(doc, now):
    if not isinstance(doc, dict):
        raise FetchError("kraken: unexpected ticker shape")
    if doc.get("error"):
        raise FetchError("kraken: " + short_reason(doc["error"], 80))
    row = next(iter((doc.get("result") or {}).values()), None)
    if not isinstance(row, dict) or not row:
        raise FetchError("kraken: empty ticker")
    last = num((row.get("c") or [None])[0])
    if not last:
        raise FetchError("kraken: no last price")
    return last, num(row.get("o"))


def kraken_bars(doc):
    """The hourly OHLC bars of one Kraken answer. A bar that is not [open epoch, open, high, low, close, ...] fails the
    whole answer: a malformed history gives no honest reference and no chart."""
    if not isinstance(doc, dict):
        raise FetchError("kraken: unexpected ohlc shape")
    if doc.get("error"):
        raise FetchError("kraken: " + short_reason(doc["error"], 80))
    result = doc.get("result") or {}
    bars = next((v for k, v in result.items() if k != "last" and isinstance(v, list)), None)
    if not bars:
        raise FetchError("kraken: empty ohlc")
    for b in bars:
        if not isinstance(b, (list, tuple)) or len(b) < 5 or num(b[0]) is None:
            raise FetchError("kraken: malformed ohlc bar")
    return bars


def parse_kraken_ohlc_ref(doc, target_epoch):
    """Close of the last hourly bar that opened at or before target_epoch. A bar more than two hours older
    than the target means the history has a gap, so there is no honest 24 h reference."""
    ref, opened = None, None
    for b in kraken_bars(doc):
        if b[0] <= target_epoch:
            ref, opened = num(b[4]), b[0]
        else:
            break
    if not ref:
        raise FetchError("kraken: ohlc history too short")
    if target_epoch - opened > 7200:
        raise FetchError("kraken: ohlc history has a gap")
    return ref


def kraken_series(doc, now):
    """Chart points from the hourly OHLC Kraken already returns (720 bars, 30 days): the last 24 h hourly
    as the 1D path, and one close per day (every 24th bar back from the newest) as the 1M path. A bar is stamped
    at its close; the hour still open has not closed, so its point is stamped now, never in the future."""
    bars = kraken_bars(doc)
    hourly = series([min(b[0] + 3600, max(now, b[0])) for b in bars], [b[4] for b in bars])
    day = [p for p in hourly if p[0] > now - 86400 - 3600]
    return day, hourly[::-24][::-1]


def crypto_quote(asset, now):
    """Spot from the public Ticker, 24 h change against the close of the hourly bar 24 h ago."""
    pair = KRAKEN_PAIRS[asset]
    last, _open = parse_kraken_ticker(http_json(KRAKEN + "Ticker?pair=" + pair, UA, 20), now)
    ohlc = http_json(KRAKEN + "OHLC?pair=%s&interval=60" % pair, UA, 20)
    ref = parse_kraken_ohlc_ref(ohlc, now - 86400)
    pct = (last / ref - 1) * 100 if ref else None
    day, hist = kraken_series(ohlc, now)
    return {
        "symbol": asset, "name": asset, "price": rnd(last), "prev_close": rnd(ref),
        "chg": rnd(last - ref) if ref else None, "pct": rnd(pct, 3), "t": int(now), "src": "kraken",
        "url": KRAKEN + "Ticker?pair=" + pair, "basis": "24h", "hist": hist,
        "intra": {"pts": day, "prev": rnd(ref), "open": None, "close": None} if len(day) >= 2 else None,
    }


# ---------------------------------------------------------------- session

def session_state(now_epoch):
    """US equity session at the given instant: open, pre, after or closed (regular weekdays and the NYSE
    full-day holidays above; early closes are not modelled)."""
    t = dt.datetime.fromtimestamp(now_epoch, ET)
    if t.weekday() >= 5 or t.date().isoformat() in NYSE_HOLIDAYS:
        return "closed"
    m = t.hour * 60 + t.minute
    if 570 <= m < 960:
        return "open"
    if 240 <= m < 570:
        return "pre"
    if 960 <= m < 1200:
        return "after"
    return "closed"


def is_trading_day(d):
    return d.weekday() < 5 and d.isoformat() not in NYSE_HOLIDAYS


def next_trading_days(start, n):
    out, d = [], start
    while len(out) < n:
        if is_trading_day(d):
            out.append(d)
        d += dt.timedelta(days=1)
    return out


# ---------------------------------------------------------------- movers

def parse_screener(doc, min_cap):
    try:
        quotes = doc["finance"]["result"][0]["quotes"]
    except (KeyError, IndexError, TypeError) as exc:
        raise FetchError("yahoo screener: unexpected shape") from exc
    if not isinstance(quotes, list):
        raise FetchError("yahoo screener: unexpected shape")
    out = []
    for q in quotes:
        if not isinstance(q, dict) or not isinstance(q.get("symbol"), str):
            continue
        cap, price, pct = num(q.get("marketCap")), num(q.get("regularMarketPrice")), num(q.get("regularMarketChangePercent"))
        if q.get("quoteType") != "EQUITY" or cap is None or cap < min_cap or not price or pct is None:
            continue
        if "." in q.get("symbol", "") or not re.match(r"^[A-Z]{1,5}$", q.get("symbol", "")):
            continue
        out.append({
            "symbol": q["symbol"], "name": display_name(q), "price": rnd(price),
            "pct": rnd(pct, 2), "volume": int(q["regularMarketVolume"]) if num(q.get("regularMarketVolume")) else None,
            "market_cap": int(cap), "t": int(q["regularMarketTime"]) if (num(q.get("regularMarketTime")) or 0) > 0 else None,
            "src": "yahoo",
        })
    return out


def movers(min_cap=10e9, top=6):
    """US large caps only: a +40% microcap is not a market mover. Relaxes to $2B if the filter leaves too few."""
    res, errors = {}, []
    for key, scr, reverse in (("gainers", "day_gainers", True), ("losers", "day_losers", False),
                              ("active", "most_actives", None)):
        try:
            doc = http_json(SCREENER % scr, UA, 25)
            rows = parse_screener(doc, min_cap)
            if len(rows) < 3:
                rows = parse_screener(doc, 2e9)
            if reverse is None:
                rows.sort(key=lambda r: -(r["volume"] or 0) * (r["price"] or 0))
            else:
                rows.sort(key=lambda r: r["pct"], reverse=reverse)
            res[key] = rows[:top]
        except FetchError as exc:
            res[key] = []
            errors.append({"source": "movers " + key, "reason": short_reason(exc)})
    return res, errors


# ---------------------------------------------------------------- calendars

def parse_money(text):
    """'$19,275,761,700' -> 19275761700.0"""
    m = re.search(r"[\d,]+(?:\.\d+)?", text or "")
    return float(m.group(0).replace(",", "")) if m else None


def parse_nasdaq_earnings(doc, date):
    rows = (doc.get("data") or {}).get("rows") or []
    out = []
    for r in rows:
        when = {"time-pre-market": "BMO", "time-after-hours": "AMC"}.get(r.get("time"), None)
        out.append({"date": date.isoformat(), "symbol": r.get("symbol"), "name": r.get("name"), "when": when,
                    "eps_est": r.get("epsForecast") or None, "market_cap": parse_money(r.get("marketCap"))})
    return out


def earnings_window(days):
    """Earnings rows for the given dates, plus the errors for dates that failed."""
    rows, errors = [], []
    for d in days:
        try:
            rows += parse_nasdaq_earnings(http_json(NASDAQ_EARNINGS % d.isoformat(), UA, 25), d)
        except FetchError as exc:
            errors.append({"source": "earnings " + d.isoformat(), "reason": short_reason(exc)})
    return rows, errors


def parse_fed_calendar(page, year):
    """FOMC decisions (last day of each meeting, 2:00 PM ET) and minutes release dates for `year`."""
    section = page.split("%d FOMC Meetings" % year, 1)
    if len(section) < 2:
        raise FetchError("fed: no %d section" % year)
    body = re.split(r"\d{4} FOMC Meetings", section[1], maxsplit=1)[0]
    events = []
    for blk in re.split(r'<div class="[^"]*fomc-meeting"', body)[1:]:
        month = re.search(r"fomc-meeting__month[^>]*><strong>([A-Za-z]+)</strong>", blk)
        days = re.search(r'fomc-meeting__date[^>]*>([\d\-/]+)\*?\s*<', blk)
        if not month or not days:
            continue
        try:
            first_month = dt.datetime.strptime(month.group(1)[:3], "%b").month
        except ValueError:
            continue
        last_day = int(re.split(r"[-/]", days.group(1))[-1])
        # a meeting written as "Oct/Nov 28-29" is rare; the month label is the start month
        decision = dt.date(year, first_month, last_day)
        events.append({"date": decision.isoformat(), "time_et": "14:00", "title": "FOMC rate decision",
                       "impact": "H", "kind": "macro", "source": "federalreserve.gov FOMC calendar", "url": FED_CAL})
        rel = re.search(r"Released\s+([A-Za-z]+ \d{1,2}, \d{4})", blk)
        minutes_day, why = None, "federalreserve.gov FOMC calendar"
        if rel:
            try:
                minutes_day = dt.datetime.strptime(rel.group(1), "%B %d, %Y").date()
            except ValueError:
                minutes_day = None
        if minutes_day is None:
            # the Fed prints the minutes date only after release; minutes follow the decision by 3 weeks
            minutes_day = decision + dt.timedelta(days=21)
            why = "federalreserve.gov FOMC calendar (minutes follow the decision by 3 weeks)"
        events.append({"date": minutes_day.isoformat(), "time_et": "14:00", "title": "FOMC minutes",
                       "impact": "H", "kind": "macro", "source": why, "url": FED_CAL})
    return events


BLS_KEEP = {
    "Employment Situation": ("Jobs report (BLS)", "H"),
    "Consumer Price Index": ("CPI (BLS)", "H"),
    "Producer Price Index": ("PPI (BLS)", "M"),
    "Job Openings and Labor Turnover Survey": ("JOLTS job openings (BLS)", "M"),
    "Employment Cost Index": ("Employment Cost Index (BLS)", "M"),
}


def parse_bls_ics(text):
    events = []
    for blk in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        summ = re.search(r"SUMMARY:(.*)", blk)
        start = re.search(r"DTSTART[^:\n]*:(\d{8})T(\d{4})", blk)
        if not summ or not start:
            continue
        name = summ.group(1).strip()
        key = next((k for k in BLS_KEEP if name.startswith(k)), None)
        if not key:
            continue
        title, impact = BLS_KEEP[key]
        d = dt.datetime.strptime(start.group(1), "%Y%m%d").date()
        events.append({"date": d.isoformat(), "time_et": start.group(2)[:2] + ":" + start.group(2)[2:],
                       "title": title, "impact": impact, "kind": "macro", "source": "bls.gov release schedule",
                       "url": "https://www.bls.gov/schedule/news_release/"})
    return events


BEA_KEEP = (("GDP", "GDP (BEA)", "H"), ("Gross Domestic Product", "GDP (BEA)", "H"),
            ("Personal Income and Outlays", "PCE inflation (BEA)", "H"))


def parse_bea_schedule(page, today):
    events = []
    for row in re.findall(r"<tr class=\"scheduled-releases-type-[^\"]*\">(.*?)</tr>", page, re.S):
        date = re.search(r'class="release-date">([A-Za-z]+ \d{1,2})<', row)
        clock = re.search(r'text-muted">\s*([\d:]+ [AP]M)\s*<', row)
        title = re.search(r'release-title[^>]*>\s*(.*?)\s*</td>', row, re.S)
        if not date or not title:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", "", title.group(1))).strip()
        hit = next((k for k in BEA_KEEP if name.startswith(k[0])), None)
        if not hit:
            continue
        d = dt.datetime.strptime("%s %d" % (date.group(1), today.year), "%B %d %Y").date()
        if d < today - dt.timedelta(days=180):
            d = d.replace(year=d.year + 1)
        t = dt.datetime.strptime(clock.group(1), "%I:%M %p").strftime("%H:%M") if clock else None
        events.append({"date": d.isoformat(), "time_et": t, "title": hit[1], "impact": hit[2], "kind": "macro",
                       "source": "bea.gov release schedule", "url": BEA_SCHEDULE})
    return events


def rule_events(start, end):
    """Two calendar rules with no public machine-readable feed: weekly jobless claims (DOL, Thursdays 8:30 ET)
    and the ISM PMIs (manufacturing on business day 1, services on business day 3, 10:00 ET)."""
    events, d = [], start
    while d <= end:
        if d.weekday() == 3 and d.isoformat() not in NYSE_HOLIDAYS:
            events.append({"date": d.isoformat(), "time_et": "08:30", "title": "Initial jobless claims (DOL)",
                           "impact": "M", "kind": "macro", "source": "DOL weekly release, Thursdays",
                           "url": "https://www.dol.gov/ui/data.pdf"})
        first = dt.date(d.year, d.month, 1)
        biz = []
        x = first
        while len(biz) < 3:
            if x.weekday() < 5 and x.isoformat() not in NYSE_HOLIDAYS:
                biz.append(x)
            x += dt.timedelta(days=1)
        if d == biz[0]:
            events.append({"date": d.isoformat(), "time_et": "10:00", "title": "ISM manufacturing PMI",
                           "impact": "H", "kind": "macro", "source": "ISM rule: business day 1",
                           "url": "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/"})
        if d == biz[2]:
            events.append({"date": d.isoformat(), "time_et": "10:00", "title": "ISM services PMI",
                           "impact": "H", "kind": "macro", "source": "ISM rule: business day 3",
                           "url": "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/"})
        d += dt.timedelta(days=1)
    return events


def macro_calendar(today, horizon_days=10):
    """Macro events from today through today+horizon. Each source that fails is reported, not guessed."""
    end = today + dt.timedelta(days=horizon_days)
    events, errors = [], []
    try:
        events += parse_fed_calendar(http_get(FED_CAL, UA_BROWSER, 25), today.year)
        if today.month >= 11:
            events += parse_fed_calendar(http_get(FED_CAL, UA_BROWSER, 25), today.year + 1)
    except (FetchError, ValueError) as exc:
        errors.append({"source": "fed calendar", "reason": short_reason(exc)})
    try:
        events += parse_bea_schedule(http_get(BEA_SCHEDULE, UA_BROWSER, 25), today)
    except (FetchError, ValueError) as exc:
        errors.append({"source": "bea schedule", "reason": short_reason(exc)})
    try:
        status, body = gateway_fetch("/impersonate", BLS_ICS, 120)
        if status not in (200, None) or "BEGIN:VCALENDAR" not in body:
            raise FetchError("bls.ics HTTP %s" % status)
        events += parse_bls_ics(body)
    except (FetchError, ValueError) as exc:
        errors.append({"source": "bls schedule", "reason": short_reason(exc)})
    events += rule_events(today, end)
    inside = [e for e in events if today.isoformat() <= e["date"] <= end.isoformat()]
    seen, out = set(), []
    for e in sorted(inside, key=lambda e: (e["date"], e["time_et"] or "99:99", e["title"])):
        k = (e["date"], e["title"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out, errors


def earnings_catalysts(rows, watch, today, bellwether_cap=50e9, per_day=5):
    """Watchlist and holding reports in full, plus up to `per_day` mega-cap reports per day."""
    out, per = [], {}
    for r in sorted(rows, key=lambda r: -(r["market_cap"] or 0)):
        if not r.get("symbol"):
            continue
        mine = r["symbol"] in watch
        big = (r["market_cap"] or 0) >= bellwether_cap and per.get(r["date"], 0) < per_day
        if not (mine or big):
            continue
        if big and not mine:
            per[r["date"]] = per.get(r["date"], 0) + 1
        out.append({"date": r["date"], "time_et": None, "when": r["when"], "kind": "earnings",
                    "symbol": r["symbol"], "title": "%s earnings" % r["symbol"], "detail": r["name"],
                    "eps_est": r["eps_est"], "impact": "H" if mine else "M", "watch": mine,
                    "source": "api.nasdaq.com earnings calendar",
                    "url": NASDAQ_EARNINGS % r["date"]})
    return out
