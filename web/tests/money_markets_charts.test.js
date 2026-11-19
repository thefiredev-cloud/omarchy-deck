// node --test tests/*.test.js  (Money > Markets charts, 2026-11-15: the 2026-11-04 owner build in design v3. Pure model, no DOM.)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/money.css'), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = new Function('DeckUI', cut(src, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(DeckUI);
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json'), rawV = fx('portfolio-values.sample.json');
const NOW = (rawM.t + 120) * 1000, DAY = 86400, END = rawM.t;
const clone = (x) => JSON.parse(JSON.stringify(x));
const count = (s, re) => (s.match(re) || []).length;

// the feed's shape (deck_markets_common.py on the owner's collector): hist [epoch, close] daily, oldest first, ending at the last price;
// intra {pts, prev, open, close}: 5-minute steps over a regular session, hourly over 24 h for crypto (open and close null)
function M() {
  const m = clone(rawM), by = Object.fromEntries(m.board.map((r) => [r.id, r]));
  const spy = by.spy; spy.price = 110; spy.chg = 2; spy.pct = 100 * 2 / 108;
  spy.hist = Array.from({ length: 64 }, (_, i) => [END - (63 - i) * DAY, i === 63 ? 110 : 100 + i * (8 / 62)]); // 100 -> 108, then 110
  spy.hist[20][1] = 120; spy.hist[40][1] = 95; // a high and a low inside the last month and the three months
  const open = END - 3 * 3600, close = open + 6.5 * 3600; // half a session: 37 of 79 five-minute slots have prices
  spy.intra = { prev: 108, open, close, pts: Array.from({ length: 37 }, (_, i) => [open + i * 300, i === 36 ? 110 : 108 + Math.sin(i) * 1.5]) };
  const tnx = by.us10y; tnx.price = 4.2; tnx.chg = 0.05;
  tnx.hist = Array.from({ length: 23 }, (_, i) => [END - (30 - i) * DAY, i === 22 ? 4.2 : 4.0 + i * 0.005]); // a month, no 3M, no intra
  const btc = by.btc; btc.price = 101000; btc.chg = 1000; btc.pct = 1;
  btc.hist = Array.from({ length: 31 }, (_, i) => [END - (30 - i) * DAY, i === 30 ? 101000 : 90000 + i * 300]);
  btc.intra = { prev: 100000, open: null, close: null, pts: Array.from({ length: 25 }, (_, i) => [END - (24 - i) * 3600, i === 24 ? 101000 : 100000 + i * 20]) };
  by.eth.hist = Array.from({ length: 31 }, (_, i) => [END - (30 - i) * DAY, 2500 + i * 7]); by.eth.price = 2710;
  const nv = m.watchlist.find((w) => w.symbol === 'NVDA');
  nv.held = true; nv.hist = Array.from({ length: 23 }, (_, i) => [END - (30 - i) * DAY, 200 + i]);
  const goog = m.watchlist.find((w) => w.symbol === 'GOOG');
  goog.hist = Array.from({ length: 23 }, (_, i) => [END - (30 - i) * DAY, 300 + i * 2]);
  return m;
}
// the portfolio holds GOOG (in the snapshot, not flagged held) and NVDA (flagged held on the watchlist)
const P = () => { const p = clone(rawP); p.positions[0].symbol = 'GOOG'; p.positions[1].symbol = 'NVDA'; return p; };
const spyOf = (m) => m.board.find((r) => r.id === 'spy');

test('a range changes the series and the change: 1D the session from the last close, 1M and 3M from their first close', () => {
  const m = M(), spy = spyOf(m);
  assert.equal(D.pointsFor(spy, '1d').length, 37);
  assert.equal(D.pointsFor(spy, '3m').length, 64);
  const m1 = D.pointsFor(spy, '1m');
  assert.ok(m1.length >= 30 && m1.length <= 32, 'the last 31 days of closes: ' + m1.length);
  assert.equal(D.rangeChange(spy, '1d'), '+1.85%', 'the day change as the row prints it');
  assert.equal(D.rangeChange(spy, '3m'), '+10.00%', '100 to 110');
  assert.equal(D.rangeChange(spy, '1m'), '+' + ((110 / m1[0][1] - 1) * 100).toFixed(2) + '%');
  const tnx = m.board.find((r) => r.id === 'us10y');
  assert.equal(D.rangeChange(tnx, '1m'), '+20.0 bp', 'a yield moves in basis points over a range too');
  assert.equal(D.rangeChange(tnx, '3m'), '', 'a month of history has no 3M');
  assert.equal(D.prevClose(spy), 108);
  assert.equal(D.prevClose(tnx), 4.2 - 0.05);
});

test('the dashed last-close line is drawn on 1D only, and named; crypto names it 24 h ago', () => {
  const m = M();
  const d1 = D.chart(m, { sel: 'SPY', rng: '1d' });
  assert.equal(count(d1, /<line class="ref"/g), 1);
  assert.match(d1, /data-hint="Dashed line: last close \$108\.00"/);
  assert.match(d1, /role="img" aria-label="S&amp;P 500, today; last \$110\.00, \+1\.85%; high [^"]*; last close \$108\.00, dashed"/);
  for (const rng of ['1m', '3m']) {
    const h = D.chart(m, { sel: 'SPY', rng });
    assert.equal(count(h, /class="ref"/g), 0, rng);
    assert.match(h, /data-hint="Move along the chart to read a point"/);
  }
  assert.match(D.chart(m, { sel: 'BTC', rng: '1d' }), /data-hint="Dashed line: 24 h ago \$100,000"/);
  // one head line (the name), then the three range chips as one segmented control, each saying its own change; the price is not
  // repeated (the tile holds it)
  assert.match(d1, /<h3 class="iv-ch-n">S&amp;P 500<\/h3><div class="seg iv-rng" role="group" aria-label="Chart range">/);
  assert.match(d1, /<button type="button" data-ivrng="1d" class="on" aria-pressed="true"><span aria-hidden="true">1D<\/span><span class="vh">Today<\/span><span class="delta up">\+1\.85%<\/span><\/button>/);
  assert.match(d1, /data-ivrng="3m" aria-pressed="false"><span aria-hidden="true">3M<\/span><span class="vh">3 months<\/span><span class="delta up">\+10\.00%<\/span>/);
  assert.doesNotMatch(d1, /class="fig"/);
});

test('high and low are named at their points, the high above and the low under, never cut by an edge', () => {
  const m = M(), spy = spyOf(m);
  const md = D.chartModel(spy, '3m');
  assert.equal(md.hi.v, 120);
  assert.equal(md.lo.v, 95);
  const h = D.chart(m, { sel: 'SPY', rng: '3m' });
  const lbl = [...h.matchAll(/<span class="lbl ([^"]*)" style="--x:([\d.]+)%;--y:([\d.]+)%">(High|Low) <b>([^<]*)<\/b><\/span>/g)];
  assert.deepEqual(lbl.map((x) => x[4] + ' ' + x[5]), ['High $120.00', 'Low $95.00']);
  assert.match(lbl[1][1], /\blo\b/, 'the low reads under its point');
  // room inside the plot for each name: the domain keeps a fifth of the span above the high and under the low
  assert.ok(+lbl[0][3] >= 14 && +lbl[1][3] <= 86, lbl.map((x) => x[3]).join(' '));
  // the newest point is at the right edge: a name there reads inward (iv-er), one at the left edge reads rightward (iv-el)
  const edge = clone(m); const s = spyOf(edge); s.hist[63][1] = 130; s.price = 130;
  assert.match(D.chart(edge, { sel: 'SPY', rng: '3m' }), /<span class="lbl iv-hi iv-er" style="--x:100\.00%/);
  const first = clone(m); spyOf(first).hist[0][1] = 140;
  assert.match(D.chart(first, { sel: 'SPY', rng: '3m' }), /<span class="lbl iv-hi iv-el" style="--x:0\.00%/);
  // a flat window has one value: one name, never two printed on top of each other
  const flat = clone(m); spyOf(flat).hist = spyOf(flat).hist.map((p) => [p[0], 110]);
  const fh = D.chart(flat, { sel: 'SPY', rng: '3m' });
  assert.equal(count(fh, /class="lbl /g), 1);
  assert.match(css, /#pg-money \.iv-chart \.lbl\.iv-er\{transform:translate\(-100%,-115%\)\}/);
});

test('the readout at an index: its time, value and change from the range base; the nearest point to a place across the plot', () => {
  const m = M(), spy = spyOf(m), md = D.chartModel(spy, '1d');
  // half a session: the grid runs from the open to the close, so the hours to come stay empty, not stretched
  assert.equal(md.n, 79);
  assert.equal(md.real.length, 37);
  const last = D.readout(spy, md, 36);
  assert.match(last.text, /^\d{1,2}:\d{2} (am|pm) \u00B7 \$110\.00 \u00B7 \+1\.85%$/);
  assert.equal(last.x, 100 * 36 / 78);
  assert.equal(D.nearest(md, 0), 0);
  assert.equal(D.nearest(md, 1), 36, 'past the last price the readout stays on the last price');
  assert.equal(D.nearest(md, 18 / 78), 18);
  const m3 = D.chartModel(spy, '3m');
  assert.match(D.readout(spy, m3, 40).text, /^[A-Z][a-z]{2}\u00A0\d{1,2} \u00B7 \$95\.00 \u00B7 \u22125\.00%$/);
  const tnx = m.board.find((r) => r.id === 'us10y');
  assert.match(D.readout(tnx, D.chartModel(tnx, '1m'), 22).text, /4\.200% \u00B7 \+20\.0 bp$/);
  // the scrub is a range input over the plot, from the first point to the last, starting on the last
  assert.match(D.chart(m, { sel: 'SPY', rng: '1d' }), /<input type="range" class="iv-scrub" min="0" max="36" step="1" value="36" aria-label="Read a point on the chart" aria-valuetext="[^"]+\$110\.00 \u00B7 \+1\.85%">/);
});

test('no series gives no line: no sparkline, no flat line, no chart control and no chart', () => {
  const bare = clone(rawM);
  assert.equal(D.chart(bare, {}), '');
  const h = D.board(bare, 'lead');
  assert.equal(count(h, /class="spark"/g), 0);
  assert.equal(count(h, /data-ivsel/g), 0);
  assert.match(h, /<div class="tile"><span class="h">S&amp;P 500<\/span>/, 'a tile without a series stays a plain tile');
  assert.doesNotMatch(D.page(bare, rawP, null, null, NOW, null, null), /iv-chart|class="spark"|data-ivsel/);
  // one point is not a line
  const one = M(); spyOf(one).hist = [[END, 110]]; delete spyOf(one).intra;
  assert.doesNotMatch(D.board(one, 'lead'), /data-ivsel="SPY"/);
  // movers carry no series in the feed: plain rows
  assert.doesNotMatch(D.movers(M()), /data-ivsel|class="spark"/);
  // a range with fewer than two points is off, never drawn
  const t = D.chart(M(), { sel: '^TNX', rng: '1d' });
  assert.match(t, /data-rng="1m"/);
  assert.match(t, /data-ivrng="1d" aria-pressed="false" disabled><span aria-hidden="true">1D<\/span><span class="vh">Today<\/span><\/button>/);
  assert.match(t, /data-ivrng="3m" aria-pressed="false" disabled>/);
  // a tile's line is today's path: no intraday path in the feed (the 10-year), no line, though it has a month of closes
  const lead = D.board(M(), 'lead', {});
  assert.doesNotMatch(/data-ivsel="\^TNX"[^]*?<\/button>/.exec(lead)[0], /class="spark"/);
});

test('a line covers the span of the change beside it: a tile draws today over the last close, a row the month with its 1M change', () => {
  const m = M();
  const lead = D.board(m, 'lead', { sel: 'SPY' });
  assert.match(lead, /<button type="button" class="tile iv-sel" data-ivsel="SPY" aria-pressed="true">/);
  assert.match(lead, /<span class="act">US market closed<\/span>/, 'no span word in a title: each line carries its own');
  const tile = /data-ivsel="SPY"[^]*?<\/button>/.exec(lead)[0];
  assert.match(tile, /<b class="v">\$110\.00<\/b><span class="t"><span class="delta up">\+1\.85%<\/span><svg class="spark"[^>]*role="img" aria-label="Today, from \$108\.00 to \$110\.00"><line class="base"/);
  // today's path keeps the session's grid: 37 of 79 slots drawn, the hours to come left empty
  const pts = /<polyline class="ln" points="([^"]*)"/.exec(tile)[1].split(' ');
  assert.equal(pts.length, 37);
  assert.ok(+pts[36].split(',')[0] < 60, 'half a session ends near the middle: ' + pts[36]);
  const groups = D.board(m, 'groups', { sel: 'ETH' });
  assert.match(groups, /<button type="button" class="frow iv-sel" data-ivsel="ETH" aria-pressed="true">[^]*?<span class="iv-sp"><svg class="spark"[^>]*aria-label="1 month, \$2,500 to \$2,710"><line class="base"[^]*?<\/svg><small><span aria-hidden="true">1M<\/span><span class="vh">1 month<\/span> <span class="delta up">\+8\.40%<\/span><\/small><\/span>/);
  assert.doesNotMatch(groups, /<span class="iv-sp"><span class="iv-sp">/, 'one wrapper: the month line is a direct child of its row (css/money.css sets its figures mono and tabular there)');
  assert.match(groups, /<\/span><span class="iv-sp"><svg class="spark"/);
  assert.match(css, /#pg-money \.frow>\.iv-sp>small,#pg-money \.frow>\.iv-sp>small>span\{font-family:var\(--mono\);font-variant-numeric:tabular-nums/);
  assert.ok(D.chartIndex(m).GOOG && D.chartIndex(m).NVDA, 'watchlist names chart too');
});

test('trending tickers: a symbol the markets feed has a series for is a chart control; the rest are plain rows; held names stay once in Portfolio', () => {
  const m = M(), p = P();
  const tr = { t: NOW / 1000 - 600, feeds: [], tickers: [{ symbol: 'GOOG', price: 230.1, pct: 1.2, t: NOW / 1000 - 60, volume_ratio: 2.5, reason: 'Volume 2.5x average', source: 'yahoo-most-active' }, { symbol: 'ZZZZ', price: 4.2, pct: -3.1, t: NOW / 1000 - 60, volume_ratio: 12, reason: 'Most active', source: 'yahoo-most-active' }] };
  const w = D.trendingTickers(tr, NOW, m, {});
  assert.match(w, /<h2 class="secttl"><span>Trending tickers<\/span><span class="act">10\u00A0min\u00A0ago<\/span><\/h2>/);
  assert.match(w, /data-ivsel="GOOG" aria-pressed="false">[^]*2\.5\u00D7 volume · Volume 2\.5x average/);
  assert.doesNotMatch(w, /data-ivsel="ZZZZ"/);
  assert.match(w, />ZZZZ<[^]*12\u00D7 volume/);
  const pf = D.portfolio(p, null, NOW, m, { sel: 'GOOG' });
  assert.match(pf, /<button type="button" class="frow iv-sel" data-ivsel="GOOG" aria-pressed="true">/);
  assert.match(pf, /data-ivsel="NVDA" aria-pressed="false">[^]*?<span class="iv-sp"><svg class="spark"/);
  const pg = D.page(m, p, null, null, NOW, {}, null, { tr: { t: tr.t, feeds: [], tickers: [tr.tickers[1]] } });
  assert.equal(count(pg, />GOOG</g), 1);
  assert.equal(count(pg, />NVDA</g), 1);
});

test('the chart opens on the S&P 500 or the pick remembered on this device; the markup follows the device class, in screen order', () => {
  const m = M(), p = P();
  assert.match(D.chart(m, { sel: 'NVDA' }), /<h3 class="iv-ch-n">NVIDIA Corporation \(NVDA\)<\/h3>/);
  const order = (h) => [...h.matchAll(/<div class="board[^"]*">|<div class="iv-(?:side|cols|left|right)">|<div class="iv-chart"|<div class="strip"|<section class="sect[^"]*"[^>]*><h2 class="secttl"><span>([^<]+)<\/span>|<section class="sect span-all iv-tvchart">|<div class="flow"/g)].map((x) => x[1] || x[0].replace(/<|>|"|class=|div |section /g, ''));
  // P, L, T: the Markets section is the chart, then the strip; then Portfolio, Trending tickers under the positions, the movers after it
  for (const cls of ['', 'P', 'L', 'T']) {
    assert.deepEqual(order(D.page(m, p, null, null, NOW, {}, null, { cls })).slice(0, 12), ['board iv-board', 'Markets', 'iv-chart', 'strip', 'iv-side', 'Portfolio', 'strip', 'Trending tickers', 'Gainers', 'Losers', 'flow', 'Futures'], cls);
  }
  // D and XL: the strip across, then the chart with Trending tickers under it at 8/12, Portfolio and the movers at 4/12
  for (const cls of ['D', 'XL']) {
    assert.deepEqual(order(D.page(m, p, null, null, NOW, {}, null, { cls })).slice(0, 14), ['board iv-board iv-wide', 'Markets', 'strip', 'iv-cols', 'iv-left', 'iv-chart', 'Trending tickers', 'iv-right', 'Portfolio', 'strip', 'Gainers', 'Losers', 'flow', 'Futures'], cls);
  }
  // TV (PlanDesign M8): the board leads with the chart beside the strip, then the Portfolio; Trending tickers are one Down press below, the
  // movers stay in the flow; nothing charts a second time under the board
  const tvh = D.page(m, p, null, null, NOW, {}, null, { tv: true, cls: 'TV' }), tvo = order(tvh);
  assert.deepEqual(tvo.slice(0, 8), ['board', 'Markets', 'iv-chart', 'strip', 'Portfolio', 'strip', 'Trending tickers', 'flow']);
  assert.equal(count(tvh, /<div class="iv-chart"/g), 1);
  assert.doesNotMatch(tvh, /iv-tvchart/);
  assert.ok(tvo.indexOf('Gainers') > tvo.indexOf('flow'));
  assert.match(css, /html\.tv #pg-money \.iv-mk\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\);column-gap:var\(--gap\);align-items:start\}/);
  // the plot keeps a ratio beside the strip (never stretched to its height); the 8rem floor is off there, so the two end level
  assert.match(css, /html\.tv #pg-money \.iv-mk \.iv-chart \.chart\{min-height:0\}/);
  // every section once, whole, under its own title
  for (const cls of ['P', 'D', 'TV']) for (const s of ['Portfolio', 'Trending tickers', 'Gainers', 'Losers', 'Catalysts', 'Headlines']) {
    assert.equal(count(D.page(m, p, null, null, NOW, {}, null, { cls, tv: cls === 'TV' }), new RegExp('<h2 class="secttl"><span>' + s + '</span>', 'g')), 1, cls + ' ' + s);
  }
  assert.match(css, /html:not\(\.tv\) #pg-money \.iv-cols\{display:grid;grid-template-columns:minmax\(0,8fr\) minmax\(0,4fr\)/);
  assert.match(css, /html:not\(\.tv\) #pg-money \.iv-left>\.iv-chart \.chart\{--ar:2\.4\/1\}/);
  assert.doesNotMatch(css.replace(/\/\*[^]*?\*\//g, ''), /aspect-ratio:auto|display:contents/, 'the chart is never stretched to a column; no part leaves its box');
  // L: chart left, strip right only when there is a chart; with none the strip keeps the full width (no empty left half, L21)
  assert.match(css, /html:not\(\.tv\) #pg-money \.iv-mk:has\(>\.iv-chart\)\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /html:not\(\.tv\) #pg-money \.iv-mk:has\(>\.iv-chart\)>\.strip\{grid-area:strip;--cols:2\}/);
  assert.doesNotMatch(css, /html:not\(\.tv\) #pg-money \.iv-mk\{display:grid/, 'never a two-column grid that a missing chart leaves half empty');
  // the line is drawn alone: no area under it (the value axis does not start at zero)
  assert.doesNotMatch(D.chart(m, {}), /<polygon|class="ar"/);
});

test('the chart never draws an amount: Show amounts changes the portfolio, never the chart', async () => {
  const m = M(), p = P();
  const c = D.ctl({ get: () => Promise.resolve(clone(rawV)), setT: () => 1, clearT() {}, now: () => NOW, onChange() {} });
  await c.reveal();
  const shown = D.page(m, p, null, c.view(), NOW, { sel: 'GOOG' }, null);
  const chart = /<div class="iv-chart"[^]*?<\/p><\/div>/.exec(shown)[0];
  assert.equal(chart, D.chart(m, { sel: 'GOOG' }));
  for (const probe of ['424242', '424,242', '313131', '919191', '565656', '777777']) assert.ok(!chart.includes(probe), probe);
});

test('glue: one stored key, rows and chips repaint the chart alone, the scrub is a field tv.js leaves Left and Right to', () => {
  assert.match(src, /const PICK_KEY='markets-chart';/);
  assert.match(src, /function ivChart\(\)\{[^]*?old\.replaceWith\(sec\)/);
  assert.match(src, /aria-pressed',b\.dataset\.ivsel===sec\.dataset\.ivchart/);
  const tv = fs.readFileSync(path.join(__dirname, '../static/tv.js'), 'utf8');
  assert.match(tv, /const typing = \(t\) => !!t && \(t\.isContentEditable \|\| \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\.tagName\)\);/);
  assert.match(tv, /if \(typing\(t\) && \(k === 'left' \|\| k === 'right'/);
  assert.match(css, /#pg-money \.iv-scrub\{position:absolute;[^}]*opacity:0;[^}]*touch-action:pan-y/);
  assert.match(css, /#pg-money \.iv-plot:has\(\.iv-scrub:focus-visible\) \.chart\{outline:var\(--focus\)/);
});
