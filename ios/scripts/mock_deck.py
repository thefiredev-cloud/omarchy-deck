#!/usr/bin/env python3
"""Local stand-in for the deck, for simulator checks only. NOT the real deck, holds no real token.
Mirrors the deck's contract: GET / without cookie -> 401; ?t=<token> sets cookie pdeck.
GET /__fixture/hold makes later deck requests return 503. GET /__fixture/release clears that.
Hold after release returns later deck requests to 503 again. No extra state.
GET /__fixture/expire makes the server reject the saved session cookie (401) until release; a ?t= token still signs in.
GET /__fixture/redirect makes a later authenticated deck GET return 302 Location on this origin.
Hold still returns 503 while that mode is on. Release clears hold and the redirect mode.
GET /__fixture/status returns held or up. GET /__fixture/requests returns deck-request counts
by client class and path, excluding fixture controls. Hold accepts delay_ms for scene tests;
plain hold still returns 503 immediately. Those control paths never set a cookie.
The page reports touchstart and scroll to /__gesture/<event> (plain deck paths, counted like any other).
A document whose navigation type is "reload" (WKWebView.reload(), which the pull-to-refresh control calls; a
load of the root URL is type "navigate") also reports /__gesture/reload, so a test can tell a real reload from a
root GET that some other path (for example an app retry) made.
The page carries navigation and resource cases for the client's delegate and origin rules:
a plain external anchor, a target=_blank external anchor, a script window.open, a script
location.href assignment, a same-origin anchor and a same-origin target=_blank anchor (any
non-control path serves this page), and a cross-origin camera <img>. The /pad-page link
opens a cookie-protected /pad WebSocket and reports the echoed text frame. Nothing here
fetches example.net; the client is expected to block it.
GET /almanac/ is a same-origin server page (like the real deck's Almanac) with no link home; the shell's
Back to deck control is the way back to /. GET /api/whoami answers {"role":"owner"} for the token's cookie and
{"role":"guest"} for the guest token, "guest-" + TOKEN, which signs in like the real deck's guest token.
GET /api/<feed> for ecom, travel-deals, outdoors, life, history-goodnews and realestate serves scripts/fixtures/feeds/<feed>.json
(the collectors' own file shapes) reshaped the way the deck server's generic feed route reshapes them, stamped 15 min
old so a stale label only appears on purpose. GET /api/cre (Markets > Commercial deal desk) and GET /api/housing/profile
(the owner's Housing budget) serve cre.json and housing-profile.json in the shape the deck's own routes answer. A guest gets
403, like the real deck. GET /__fixture/feeds-missing makes every feed answer {"error":"file missing"} (the "not collected
yet" state, and a deal desk that is not reporting) until release.
GET /api/surf-coast, /api/surf-coast/region/<id> and /api/ecom-market (2026-11-14) serve the cut fixtures surf-coast.json,
surf-coast-region-<id>.json and ecom-market.json, passed through with the server's age, stale and refresh keys and stamped
15 min old. A known region without a fixture answers {"status":"not_reporting"}, an unknown region 404, as the deck does.
GET /__fixture/old-deck makes those three routes answer 404 (a deck server that predates them) until release.
GET /__fixture/surf-alerts-far makes /api/surf-coast keep only the alerts outside the pinned spots' regions, and
GET /__fixture/surf-alerts-home adds four test alerts on the home region, least severe first, until release.
GET /api/housing/fields, /api/housing/national?part=segments|states|metros and /api/housing/rank?...&cols= (2026-11-17)
serve the Best ZIPs catalog, the Markets spec and lists and the columned rank rows captured from the live deck API
(housing-fields.json, housing-national-segments|states|metros.json, housing-rank-cols.json); see served_national."""
import base64
import hashlib
import html
import http.server
import json
import os
import ssl
import sys
import threading
import time
import urllib.parse
TOKEN = sys.argv[4] if len(sys.argv) > 4 else "mock-token-0000"
TITLE = sys.argv[5] if len(sys.argv) > 5 else "MOCK DECK (not the real deck)"
GUEST_TOKEN = "guest-" + TOKEN
CAM_KEY = "fixture-camera-key"
with open(os.path.join(os.path.dirname(__file__), "fixtures/camera-segment.ts"), "rb") as segment_file:
    CAM_SEGMENT = segment_file.read()
CAM_SNAPSHOT = base64.b64decode(
    "/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAxAP/bAEMACAYGBwYHCAgICAgICQkJCgoKCQkJCQoKCgoKCgwMDAoKCgoKCgoMDAwMDQ4NDQ0MDQ4ODw8PEhIRERUVFRkZH//EAEsAAQEAAAAAAAAAAAAAAAAAAAAIAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAEAAQAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8An8AH/9k="
)
FEED_DIR = os.path.join(os.path.dirname(__file__), "fixtures/feeds")
# Mirrors pixel-deck rust/src/sources.rs: route name -> (file under ~/.meshvault/status, refresh seconds, kept keys).
FEEDS = {
    "ecom": ("house-feeds/ecom.json", 3600, ["generated_at", "as_of", "setup", "coverage", "watch", "movers", "deals", "macro"]),
    "travel-deals": ("travel-deals.json", 21600, ["generated_at", "items", "summary"]),
    "outdoors": ("outdoors.json", 7200, ["generated_at", "items"]),
    "life": ("life.json", 86400, ["generated_at", "items"]),
    "history-goodnews": ("history-goodnews.json", 86400, ["generated_at", "items"]),
    "realestate": ("house-feeds/realestate.json", 3600, ["homes", "commercial", "market"]),
}
# The 14 region ids of pixel-deck rust/src/surf.rs, south to north.
SURF_REGIONS = ["baja-sur", "baja-norte", "san-diego", "orange-county", "los-angeles", "ventura", "santa-barbara",
                "san-luis-obispo", "monterey-santa-cruz", "san-francisco-marin", "sonoma-del-norte", "oregon-south",
                "oregon-central", "oregon-north"]
# Four test alerts on the home region for /__fixture/surf-alerts-home, least severe first so the page must sort them.
# Simulator fixture only, never deck data.
HOME_TEST_ALERTS = [("Beach Hazards Statement", "Minor"), ("Rip Current Statement", "Moderate"),
                    ("High Surf Warning", "Severe"), ("Coastal Flood Warning", "Extreme")]
def surf_alerts(out, mode):
    """Rewrites the overview's alerts for the surf-alerts fixtures: "far" keeps the alerts outside the pinned spots'
    regions; "home" keeps those and adds HOME_TEST_ALERTS on the first pinned spot's region."""
    home = {s["region"] for s in out.get("spots", []) if s.get("pinned")}
    far = [a for a in out.get("alerts", []) if not home & set(a.get("regions") or [])]
    if mode == "home":
        region = next(s["region"] for s in out["spots"] if s.get("pinned"))
        far = [{"id": "fixture-home-%d" % i, "event": event, "severity": severity,
                "text": "Test alert for the simulator checks.", "regions": [region], "zones": [],
                "until_label": "Sun 10 am"} for i, (event, severity) in enumerate(HOME_TEST_ALERTS)] + far
    out["alerts"] = far
def served_new_route(path, missing, alerts=""):
    """/api/surf-coast, /api/surf-coast/region/<id>, /api/ecom-market: (status, body). Nothing is reshaped: these routes
    pass the contract keys through and add age, stale and refresh."""
    t = int(time.time()) - 900
    if path == "/api/ecom-market":
        name, refresh = "ecom-market", 3600
    elif path == "/api/surf-coast":
        name, refresh = "surf-coast", 1800
    else:
        region = path[len("/api/surf-coast/region/"):]
        if region not in SURF_REGIONS:
            return 404, {"error": "unknown region"}
        name, refresh = "surf-coast-region-" + region, 1800
    file = os.path.join(FEED_DIR, name + ".json")
    if missing or not os.path.exists(file):
        if name == "ecom-market":
            return 200, {"error": "file missing", "refresh": refresh, "stale": True}
        return 200, {"status": "not_reporting", "error": "the surf writer has not run yet"}
    with open(file, encoding="utf-8") as f:
        out = json.load(f)
    out.update({"t": t, "age": 900, "stale": False, "refresh": refresh})
    if alerts and name == "surf-coast":
        surf_alerts(out, alerts)
    return 200, out
# The rank route's housing sorts the app sends: (column, lowest first). Aliases as the deck maps them on v2 data, then
# the v2 columns the catalog marks rankable, best first by the catalog's direction.
RANK_SORTS = {"score": ("h_score", False), "price": ("home_value", True), "change_1y": ("value_trend_1y", False),
              "rent": ("typical_rent", False), "gross_yield": ("gross_yield", False), "yield": ("yield_gross", False),
              "days_on_market": ("days_on_market", True), "price_cuts": ("price_cuts", True),
              "inventory": ("inventory", False), "affordability": ("affordability", True),
              "multifamily_score": ("multifamily_score", False), "rent_trend_1y": ("rent_trend_1y", False)}
def field_names(text, most):
    """A comma list of distinct field names the deck takes (a-z, 0-9, _; 1 to 40), at most `most`, else None."""
    names = (text or "").split(",")
    ok = all(n and len(n) <= 40 and all(c.islower() or c.isdigit() or c == "_" for c in n) for n in names)
    return names if ok and 0 < len(names) <= most and len(set(names)) == len(names) else None
def row_states(row, part):
    """The state codes a states row is, or a metros row covers (its name's suffix: "..., NY-NJ-PA")."""
    if part == "states":
        return [str(row.get("state") or "").upper()]
    name = str(row.get("name") or "")
    return [s.strip().upper() for s in name.rsplit(", ", 1)[1].split("-")] if ", " in name else []
def served_national(path, query, missing):
    """/api/housing/national?part=summary|sources|segments|states|metros, /api/housing/fields, /api/housing/rank and
    /api/housing/zip/<zip> from the cut fixtures (NationalApi.md shapes; the catalog, segments, lists and the columned
    rank rows were captured from the live deck API on 2026-11-17, values unchanged). Rank filters by state and q and
    sorts the fixture rows; with `cols=` it answers like housing.rs v2 (only columns the catalog says the ZIP table has,
    else 400 bad cols; each row cut to those columns plus the sort column, `from` cut to them). Lists take `fields=`
    (at most 100) and `state=`. A ZIP with a cut body (housing-zip-<zip>.json: 92647, 79607, the top-ranked card, and
    62927, a synthetic row whose home value the build rejected) answers it; other ZIPs answer 404 unknown zip."""
    if missing:
        return 200, {"status": "not_reporting", "reason": "the national build has not run yet"}
    def load(name):
        with open(os.path.join(FEED_DIR, name + ".json"), encoding="utf-8") as f:
            return json.load(f)
    if path == "/api/housing/fields":
        out = load("housing-fields")
        out.update({"age": 900, "refresh": 604800, "stale": False})
        return 200, out
    if path == "/api/housing/national":
        part = query.get("part", [""])[0]
        if part in ("states", "metros"):
            fields = field_names(query.get("fields", [""])[0], 100)
            if fields is None:
                return 400, {"error": "bad fields"}
            state = query.get("state", [None])[0]
            data = load("housing-national-" + part)
            rows = [r for r in data[part] if not state or state.upper() in row_states(r, part)]
            data[part] = [{k: r[k] for k in fields if k in r} for r in rows]
            return 200, data
        if part not in ("summary", "sources", "segments"):
            return 400, {"error": "bad part"}
        out = load("housing-national-" + part)
        if part in ("summary", "segments"):
            # The server's freshness keys (NationalServer #230): weekly build, stamped 15 min old like the other feeds.
            out.update({"age": 900, "refresh": 604800, "stale": False})
        return 200, out
    if path == "/api/housing/rank":
        asked = query.get("cols", [None])[0]
        data = load("housing-rank-cols" if asked is not None else "housing-rank-rows")
        cols = None
        if asked is not None:
            table = {f["name"] for f in load("housing-fields")["fields"] if f.get("in_zips")}
            cols = field_names(asked, 200)
            if cols is None or any(c not in table for c in cols):
                return 400, {"error": "bad cols"}
        rows = data["rows"]
        state, q = query.get("state", [None])[0], (query.get("q", [""])[0] or "").lower()
        if state:
            rows = [r for r in rows if r.get("state") == state]
        if q:
            rows = [r for r in rows if r["zip"].startswith(q) or q in (r.get("city") or "").lower()]
        # As the deck: `yield` is the v1 alias of the raw `yield_gross`; the app sorts on the blended `gross_yield`.
        sort = query.get("sort", ["score"])[0]
        if sort not in RANK_SORTS:
            return 400, {"error": "bad sort"}
        col, asc = RANK_SORTS[sort]
        direction = query.get("dir", [None])[0]
        if direction is not None:
            if direction not in ("asc", "desc"):
                return 400, {"error": "bad dir"}
            asc = direction == "asc"
        # Missing values sort last either way, as the deck's `table::order`.
        rows = sorted(rows, key=lambda r: (r.get(col) is None, (r.get(col) or 0) if asc else -(r.get(col) or 0), r["zip"]))
        limit = int(query.get("limit", ["50"])[0])
        out = []
        for i, r in enumerate(rows[:limit]):
            row = dict(r, rank=i + 1, price=r.get("home_value") or r.get("zhvi"), price_src="zhvi")
            if cols is not None:
                keep = ["zip"] + cols + [col]
                row = {k: v for k, v in row.items() if k in keep or k in ("rank", "price", "price_src")}
                marks = {k: v for k, v in (r.get("from") or {}).items() if k in keep}
                if marks:
                    row["from"] = marks
            out.append(row)
        body = {"kind": "housing", "dataset": "v2", "total": len(rows), "zips_total": data["zips_total"],
                "offset": 0, "limit": limit, "sort": sort, "rows": out, "generated_at": data["generated_at"]}
        if cols is not None:
            body.update({"cols": ["zip"] + [c for c in cols if c != "zip"] + ([col] if col not in cols else []),
                         "sort_col": col, "sort_dir": "asc" if asc else "desc"})
        return 200, body
    zip_code = path[len("/api/housing/zip/"):]
    if len(zip_code) == 5 and zip_code.isdigit() and os.path.exists(os.path.join(FEED_DIR, "housing-zip-%s.json" % zip_code)):
        return 200, load("housing-zip-" + zip_code)
    return 404, {"error": "unknown zip"}
def served_desk(name, missing):
    """The deck's own /api/cre and /api/housing/profile answers (cre.rs, housing.rs), stamped 15 min old."""
    t = int(time.time()) - 900
    if missing:
        if name == "cre":
            return {"status": "not_reporting", "reason": "the realestate collector has not written the deal desk yet"}
        return {"error": "file missing"}
    with open(os.path.join(FEED_DIR, ("cre" if name == "cre" else "housing-profile") + ".json"), encoding="utf-8") as f:
        out = json.load(f)
    out["t"] = t
    if name == "cre":
        out["generated_at"] = t
    return out
def served_feed(name, missing):
    rel, refresh, keys = FEEDS[name]
    src = "~/.meshvault/status/" + rel
    if missing:
        return {"error": "file missing", "src": src, "refresh": refresh, "stale": True}
    with open(os.path.join(FEED_DIR, name + ".json"), encoding="utf-8") as f:
        raw = json.load(f)
    t = int(time.time()) - 900
    sources = raw.get("src") or [s.get("name") for s in raw.get("sources", []) if isinstance(s, dict)]
    errors = [{"source": e.get("source", ""), "reason": e.get("reason") or e.get("error", "")} for e in raw.get("errors", [])]
    out = {k: raw[k] for k in keys if k in raw}
    out.update({"sources": sources, "errors": errors, "src": src, "refresh": refresh, "t": t, "age": 900, "stale": False})
    if isinstance(out.get("as_of"), (int, float)):
        out["as_of"] = t
    return out
PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>body{margin:0;background:#16161a;color:#f2f1ee;font:15px system-ui}
.top{background:#1f1f25;min-height:44px;padding:max(env(safe-area-inset-top),16px) calc(12px + var(--shell-reserve-top-right,0px)) 8px 12px;font-weight:800;letter-spacing:.1em}
.c{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px}.t{background:#1f1f25;border-radius:12px;padding:10px;min-height:90px}
a{color:#e8b36a;display:block;padding:12px}
.frow{background:#222;border-radius:12px;margin:0 12px 8px}.frow b{display:block}.frow small{display:block;color:#999}</style>
<div class=top>MOCK DECK (not the real deck)</div>
<div class=c><div class=t>TODAY<br><b>mock</b></div><div class=t>HOME<br><b>mock</b></div></div>
<a id=ext href="https://example.com/">External link (must open Safari)</a>
<a id=blank target=_blank href="https://example.org/">External _blank (must open Safari)</a>
<!-- Hockey game row in the deck server's exact markup (pixel-deck static/deck.js row(): a.frow, target=_blank, rel=noopener noreferrer).
     The href is the server's /gamecenter/ path for a real LAK game, prefixed with https://www.nhl.com as hockeyLink() does. -->
<a id=game class=frow href="https://www.nhl.com/gamecenter/lak-vs-sjs/2026/10/03/2026020034" target="_blank" rel="noopener noreferrer"><span class="fl"><b>LAK vs SJS</b><small>Game row (must open Safari)</small></span></a>
<a id=same href="/same">Same-origin link (must stay in the deck)</a>
<a id=samenew target=_blank href="/same">Same-origin new-window link (must stay in the deck)</a>
<a id=pad-page href="/pad-page">Pad socket fixture</a>
<a id=cam-page href="/cam-page">Camera fixture</a>
<a id=life-page href="/life-page">Life and research fixture</a>
<a id=almanac href="/almanac/">Almanac (server page)</a>
<!-- Script-driven navigations carry navigationType .other, not .linkActivated. The client cancels both
     (DeckModel.swift decidePolicyFor action and createWebViewWith); neither may open Safari or load in-app. -->
<button id=jsopen onclick="window.open('https://example.net/')">JS window.open (must do nothing)</button>
<button id=jsloc onclick="location.href='https://example.net/path'">JS location.href (must do nothing)</button>
<!-- Cross-origin camera image. The client's content rules block every non-deck-origin resource. -->
<img id=cam alt="Cross-origin camera (must stay blocked)" src="https://example.net/cam.jpg" width=1 height=1>
<div style="height:1400px"></div>
<!-- Gesture isolation for the simulator tests: the first touchstart and scroll in each 300 ms window is reported to
     /__gesture/<event>. Those are ordinary deck paths, so /__fixture/requests counts them under webview, and a test can
     tell a gesture that never reached the page from one that reached it but did not reload the dashboard ("/").
     /__gesture/reload is sent once by a document whose Navigation Timing type is "reload", never by a plain load. -->
<script>const last={};for(const e of ['touchstart','scroll'])addEventListener(e,()=>{const n=Date.now();if(n-(last[e]||0)<300)return;last[e]=n;fetch('/__gesture/'+e,{keepalive:true}).catch(()=>{})},{passive:true});
try{const nav=performance.getEntriesByType('navigation')[0];if(nav&&nav.type==='reload')fetch('/__gesture/reload',{keepalive:true}).catch(()=>{})}catch(e){}</script>"""
PAGE = PAGE.replace(b"MOCK DECK (not the real deck)", html.escape(TITLE).encode())
# The real deck's Life tile links /almanac/, a separate server page with no way back to the deck.
ALMANAC_PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>body{margin:0;background:#16161a;color:#f2f1ee;font:15px system-ui;padding:max(env(safe-area-inset-top),16px) 16px 16px}</style>
<h1>MOCK ALMANAC (server page)</h1><p>No link home. The app's Back to deck control returns to the deck.</p>"""
# Mirrors pixel-deck-owner-integrated-20261004/static/app.js:247 and index.html:151.
# Synthetic content proves that a closed details element hides even populated feeds.
# The default-open server proposal is modeled here only; remove `open` for the RED twin.
LIFE_PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#111;color:#ddd;font:17px system-ui;padding:70px 16px 16px}
#tc3{display:flex;flex-direction:column;height:650px}
.tcard{background:#333;border-radius:12px;padding:8px 10px;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}
.secttl{display:flex;text-transform:uppercase;letter-spacing:.12em;font-size:14px}
.tsec{padding:14px 0}h2{font-size:18px;margin:0 0 8px}</style>
<div id=tc3><details class="tcard" open><summary class="secttl">Life and research</summary>
<div id=mk class=tsec><h2>Markets</h2><p>Fixture market item</p></div>
<div id=tsurf class=tsec><h2>Surf</h2><p>No surf items yet (fixture)</p></div>
</details></div>"""
PAD_PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<div>Pad socket fixture</div><div id=pad-socket-status role=status>Connecting</div>
<script>
const status = document.getElementById('pad-socket-status');
const socket = new WebSocket('wss://' + location.host + '/pad?target=mini');
let receivedEcho = false;
socket.onopen = () => socket.send('deck-pad-probe');
socket.onmessage = event => {
  receivedEcho = event.data === 'deck-pad-probe';
  status.textContent = receivedEcho ? 'Pad socket open' : 'Pad echo mismatch';
};
socket.onerror = () => { if (!receivedEcho) status.textContent = 'Pad socket failed' };
</script>"""
CAM_PAGE = b"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<div id=camera-status role=status>Camera connecting</div>
<video id=camera-video muted playsinline autoplay preload=auto></video>
<img id=camera-image alt="Camera snapshot fallback">
<script>
const status = document.getElementById('camera-status');
const video = document.getElementById('camera-video');
const image = document.getElementById('camera-image');
video.addEventListener('playing', () => {
  status.textContent = 'Camera video playing';
});
video.addEventListener('error', () => {
  status.textContent = 'Camera video error';
  fetch('/api/cam?e=camera.eufy_cam_1&live=1').then(response => {
    if (!response.ok) throw new Error('snapshot response');
    return response.blob();
  }).then(blob => { image.src = URL.createObjectURL(blob); })
    .catch(() => { status.textContent = 'Camera image error'; });
});
image.addEventListener('load', () => { status.textContent = 'Camera image load'; });
image.addEventListener('error', () => { status.textContent = 'Camera image error'; });
fetch('/cam/index.m3u8').then(response => {
  if (!response.ok) throw new Error('playlist response');
  status.textContent = 'Camera playlist fetched';
  video.src = '/cam/index.m3u8';
  video.play().catch(() => {});
}).catch(() => { status.textContent = 'Camera video error'; });
</script>"""
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    held = False
    redirecting = False
    expired = False
    feeds_missing = False
    old_deck = False
    surf_alerts = ""
    requests = {"webview": {}, "probe": {}, "other": {}}
    delay_ms = 0
    lock = threading.Lock()
    def log_message(self, *a): pass
    def handle_one_request(self):
        keep_alive_request = not self.close_connection
        try:
            super().handle_one_request()
        except ConnectionResetError:
            if not keep_alive_request:
                raise
            self.close_connection = True
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__fixture/hold":
            try:
                delay_ms = max(0, min(5000, int(urllib.parse.parse_qs(
                    urllib.parse.urlsplit(self.path).query, keep_blank_values=True).get("delay_ms", ["0"])[0])))
            except ValueError:
                self._text(400, b"delay_ms must be an integer")
                return
        if path in ("/__fixture/hold", "/__fixture/release", "/__fixture/status", "/__fixture/redirect", "/__fixture/expire", "/__fixture/requests", "/__fixture/feeds-missing", "/__fixture/old-deck", "/__fixture/surf-alerts-far", "/__fixture/surf-alerts-home"):
            with H.lock:
                if path == "/__fixture/hold":
                    H.held = True
                    H.delay_ms = delay_ms
                elif path == "/__fixture/release":
                    H.held = False
                    H.redirecting = False
                    H.expired = False
                    H.feeds_missing = False
                    H.old_deck = False
                    H.surf_alerts = ""
                    H.delay_ms = 0
                elif path == "/__fixture/redirect":
                    H.redirecting = True
                elif path == "/__fixture/expire":
                    H.expired = True
                elif path == "/__fixture/feeds-missing":
                    H.feeds_missing = True
                elif path == "/__fixture/old-deck":
                    H.old_deck = True
                elif path.startswith("/__fixture/surf-alerts-"):
                    H.surf_alerts = path[len("/__fixture/surf-alerts-"):]
                body = (json.dumps(H.requests, sort_keys=True).encode()
                        if path == "/__fixture/requests" else b"held" if H.held else b"up")
            self._text(200, body)
            return
        with H.lock:
            # Every non-control path uses the deck handler; count assets and unknown
            # paths too. Root-only assertions read "/" rather than summing this map.
            agent = self.headers.get("User-Agent", "")
            client = "webview" if "AppleWebKit/" in agent else "probe" if "CFNetwork/" in agent else "other"
            counts = H.requests[client]
            counts[path] = counts.get(path, 0) + 1
            held = H.held
            redirecting = H.redirecting
            delay_ms = H.delay_ms
            expired = H.expired
        if held:
            if delay_ms:
                time.sleep(delay_ms / 1000)
            self._text(503, b"down")
            return
        ck = self.headers.get("Cookie", "")
        ok = ("pdeck=" + TOKEN) in ck and not expired
        guest = ("pdeck=" + GUEST_TOKEN) in ck and not expired
        via = ("t=" + TOKEN) in self.path
        via_guest = ("t=" + GUEST_TOKEN) in self.path
        camera_key_ok = (path.startswith("/cam/")
                         and urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("k") == [CAM_KEY])
        if not (ok or guest or via or via_guest or camera_key_ok):
            self._text(401, b"login")
            return
        if path == "/api/whoami":
            body = json.dumps({"role": "guest" if (guest or via_guest) and not (ok or via) else "owner"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path in ("/api/cre", "/api/housing/profile"):
            if not (ok or via):
                self._text(403, b'{"error":"forbidden"}')
                return
            with H.lock:
                missing = H.feeds_missing
            body = json.dumps(served_desk("cre" if path == "/api/cre" else "profile", missing)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/") and path[5:] in FEEDS:
            if not (ok or via):
                self._text(403, b'{"error":"forbidden"}')
                return
            with H.lock:
                missing = H.feeds_missing
            body = json.dumps(served_feed(path[5:], missing)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path in ("/api/housing/national", "/api/housing/rank", "/api/housing/fields") or path.startswith("/api/housing/zip/"):
            if not (ok or via):
                self._text(403, b'{"error":"forbidden"}')
                return
            with H.lock:
                missing, old = H.feeds_missing, H.old_deck
            if old:
                self._text(404, b'{"error":"not found"}')
                return
            status, out = served_national(path, urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query), missing)
            body = json.dumps(out).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path in ("/api/surf-coast", "/api/ecom-market") or path.startswith("/api/surf-coast/region/"):
            if not (ok or via):
                self._text(403, b'{"error":"forbidden"}')
                return
            with H.lock:
                missing, old, alerts = H.feeds_missing, H.old_deck, H.surf_alerts
            if old:
                self._text(404, b'{"error":"not found"}')
                return
            status, out = served_new_route(path, missing, alerts)
            body = json.dumps(out).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/pad":
            if not ok or self.headers.get("Origin") != "https://" + self.headers.get("Host", ""):
                self._text(403, b"forbidden")
                return
            if urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("target") != ["mini"]:
                self._text(400, b"bad target")
                return
            if (self.headers.get("Upgrade", "").lower() != "websocket"
                    or "upgrade" not in [part.strip().lower() for part in self.headers.get("Connection", "").split(",")]
                    or self.headers.get("Sec-WebSocket-Version") != "13"):
                self._text(426, b"websocket required")
                return
            try:
                key = self.headers.get("Sec-WebSocket-Key", "")
                if len(base64.b64decode(key, validate=True)) != 16:
                    raise ValueError("invalid WebSocket key")
            except ValueError:
                self._text(400, b"bad websocket key")
                return
            accept = base64.b64encode(hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()
            self.connection.settimeout(3)
            try:
                frame = self.rfile.read(2)
                if len(frame) != 2:
                    return
                if frame[0] != 0x81 or not frame[1] & 0x80 or frame[1] & 0x7f > 125:
                    self.wfile.write(b"\x88\x02\x03\xea")  # Protocol error (1002).
                    self.wfile.flush()
                    return
                length = frame[1] & 0x7f
                mask = self.rfile.read(4)
                payload = self.rfile.read(length)
                if len(mask) != 4 or len(payload) != length:
                    return
                text = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
                text.decode("utf-8")
                self.wfile.write(bytes((0x81, length)) + text + b"\x88\x02\x03\xe8")  # Normal close (1000).
                self.wfile.flush()
                reply = self.rfile.read(2)
                if len(reply) == 2 and reply[0] == 0x88 and reply[1] & 0x80 and reply[1] & 0x7f <= 125:
                    close_length = reply[1] & 0x7f
                    drained = self.rfile.read(4 + close_length)
                    if len(drained) != 4 + close_length:
                        return
            except (OSError, UnicodeError):
                pass
            finally:
                self.close_connection = True
            return
        if redirecting:
            self.send_response(302)
            self.send_header("Location", "https://127.0.0.1:%d/" % port)
            self.send_header("Content-Length", "0")
            if via:
                self.send_header("Set-Cookie", "pdeck=%s; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax" % TOKEN)
            self.end_headers()
            return
        if path == "/cam/index.m3u8":
            body = (f"#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\n"
                    f"segment.ts?k={CAM_KEY}\n#EXT-X-ENDLIST\n").encode()
            content_type = "application/vnd.apple.mpegurl"
        elif path == "/cam/segment.ts":
            body, content_type = CAM_SEGMENT, "video/mp2t"
        elif path == "/api/cam":
            body, content_type = CAM_SNAPSHOT, "image/jpeg"
        elif path == "/life-page":
            body, content_type = LIFE_PAGE, "text/html"
        elif path == "/almanac/":
            body, content_type = ALMANAC_PAGE, "text/html"
        else:
            body = CAM_PAGE if path == "/cam-page" else PAD_PAGE if path == "/pad-page" else PAGE
            content_type = "text/html"
        self.send_response(200); self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if via: self.send_header("Set-Cookie", "pdeck=%s; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax" % TOKEN)
        elif via_guest: self.send_header("Set-Cookie", "pdeck=%s; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax" % GUEST_TOKEN)
        self.end_headers(); self.wfile.write(body)
    def _text(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
class Server(http.server.ThreadingHTTPServer):
    """TLS handshakes run in the per-connection thread, never in the accept loop.

    The default wrapped listener handshakes inside accept(), so one client that opens a TCP
    connection and never speaks TLS (WebKit and CFNetwork do this with spare connections) froze
    every other request, including the 5 s fixture release in the UI test tearDown."""
    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(10)
            request.do_handshake()
            request.settimeout(None)
        except OSError:
            self.shutdown_request(request)
            return
        super().process_request_thread(request, client_address)
port, cert, key = int(sys.argv[1]), sys.argv[2], sys.argv[3]
s = Server(("127.0.0.1", port), H)
c = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); c.load_cert_chain(cert, key)
s.socket = c.wrap_socket(s.socket, server_side=True, do_handshake_on_connect=False)
print(f"Mock deck listening on 127.0.0.1:{port}", flush=True)
s.serve_forever()
