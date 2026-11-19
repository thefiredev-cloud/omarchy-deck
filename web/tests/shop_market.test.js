// node --test tests/*.test.js  (Shop > Market, Deck v3, PgShop 2026-11-14)
// Pins what the reader sees: prices first, periods beside numbers, watches lead, whole titles, no store health or source names on the
// page, and one quiet setup row. Helpers come from the real DeckUI block of deck.js; the page module is static/pages/shop.js.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
const fx = require('./shop_fixture.cjs');
const NOW = (fx().market.t + 600) * 1000;
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const TR = require('./trends_fixture.cjs');
const page = (o) => { const f = fx(); return S.marketBody(Object.assign({ m: f.market, e: f.ecom, l: f.listings, tr: TR.trends(), now: NOW, cls: 'D', view: {} }, o)); };

test('strip: blueprint tiles in order, each with its change word and period; extras only on desk', () => {
  const t = S.macroModel(fx().market);
  assert.deepEqual(t.map((x) => x.label), ['Online share of retail', 'Online sales', 'Retail sales', 'Core goods prices', 'Shipping', 'Diesel', 'Parcel fuel surcharge', 'Port imports']);
  assert.deepEqual(t.map((x) => x.dx), [false, false, false, false, false, false, true, true]);
  const by = Object.fromEntries(t.map((x) => [x.label, x]));
  assert.equal(by['Online share of retail'].value, '17.1%');
  assert.equal(by['Online share of retail'].period, 'Q2 2026');
  assert.equal(by['Online share of retail'].cword, '1-yr');
  assert.equal(by['Online share of retail'].pts, true);
  assert.equal(by['Online sales'].value, '$340.2B');
  // core goods prices have no published year-ago month: the monthly change is the headline, said as 1-mo with its month
  assert.equal(by['Core goods prices'].value, '+0.2%');
  assert.equal(by['Core goods prices'].cword, '1-mo');
  assert.equal(by['Core goods prices'].period, 'Oct 2026');
  // the container rate has no year-ago value: its weekly change carries a 1-wk word, and the value says its unit
  assert.equal(by.Shipping.cword, '1-wk');
  assert.equal(by.Shipping.unit, 'per 40 ft box');
  assert.equal(by.Diesel.value, '$6.13');
  assert.ok(by.Diesel.spark.length > 1);
});

test('strip: a series the feed does not carry gets no tile, never a zero', () => {
  const f = fx();
  f.market.macro = f.market.macro.filter((m) => m.key !== 'diesel');
  f.market.macro.find((m) => m.key === 'retail_sales').value = null;
  const labels = S.macroModel(f.market).map((x) => x.label);
  assert.ok(!labels.includes('Diesel'));
  assert.ok(!labels.includes('Retail sales'));
});

test('Trending leads the page, ahead of every other list', () => {
  const h = vis(page());
  const it = h.indexOf('Trending');
  assert.ok(it > 0);
  for (const s of ['Best sellers and movers', 'Category prices', 'Platforms', 'Deals and resale']) assert.ok(h.indexOf(s) > it, s + ' after Trending');
  assert.doesNotMatch(h, /Your watches/);
});

test('watch model (the watch sheet reads it): name, best price with its store, the median, the 7-day change and its line', () => {
  const f = fx();
  const w = S.watchModel(f.market.watches.items.find((x) => x.slug === 'rtx-4080'), f.ecom.watch.find((x) => x.slug === 'rtx-4080'));
  assert.equal(w.name, 'RTX 4080');
  assert.equal(w.median, 1200);
  assert.equal(w.chg7, -14.29);
  assert.deepEqual([w.best.price, w.best.store], [879.99, 'Newegg']);
  // the best listing link comes from the shop collector only when it is the same offer
  assert.match(w.best.url, /^https:\/\/www\.newegg\.com\//);
  // the spark spans the 7 days its change names (8 daily points); a missing day is a gap, never a zero
  assert.ok(w.spark.length <= 8 && w.spark.length > 1);
  assert.ok(!w.spark.includes(0));
  const g = fx(), gw = g.market.watches.items.find((x) => x.slug === 'rtx-4080');
  gw.hist = gw.hist.filter((h) => h[0] !== '2026-11-10');
  const gs = S.watchModel(gw, null).spark;
  assert.ok(gs.includes(null));
  assert.ok(!gs.includes(0));
});

test('watch card: the percentile jargon line is gone from the card', () => {
  const h = vis(page());
  assert.doesNotMatch(h, /\bp25\b|\bp50\b|\bp75\b|Median of \d+/);
  assert.doesNotMatch(h, /Flip /);
});

test('watch sheet: range on the median basis, stores cheapest first, 30-day line, supply, condition, missing named once', () => {
  const f = fx();
  const w = f.market.watches.items.find((x) => x.slug === 'rtx-4080');
  const s = S.watchSheetModel(w, f.ecom.watch.find((x) => x.slug === 'rtx-4080'), f.ecom);
  assert.deepEqual([s.range.p25, s.range.med, s.range.p75], [w.ci.lo, 1200, w.ci.hi]);
  assert.equal(s.range.min, 879.99);
  assert.equal(s.range.cur, 879.99);
  assert.deepEqual(s.stores.map((x) => x.median), s.stores.map((x) => x.median).slice().sort((a, b) => a - b));
  assert.ok(s.line.length >= 7 && Array.isArray(s.line[0]) && typeof s.line[0][0] === 'string');
  assert.ok(s.supply.some(([k]) => k === 'Listings'));
  assert.ok(s.condition.some(([k]) => k === 'Refurbished'));
  assert.ok(s.missing.includes('season'));
  const h = S.watchSheetHtml(s);
  for (const t of ['Price range', 'By store', 'Last 30 days', 'Supply and shipping', 'Condition']) assert.match(vis(h), new RegExp(t));
  assert.match(vis(h), /Asking prices, not sold prices\./);
  assert.match(vis(h), /Not reported: .*season/);
  assert.match(h, /class="range/);
  // no source id or source word in the visible text of the sheet (links may carry tracking words in their URLs)
  assert.doesNotMatch(vis(h), /shop_newegg|\bsource\b/i);
  // a watch the old feed carries a season for shows the Season section and does not list it as missing
  const g = f.market.watches.items.find((x) => x.slug === 'pellet-grill');
  const sg = S.watchSheetModel(g, f.ecom.watch.find((x) => x.slug === 'pellet-grill'), f.ecom);
  assert.equal(sg.season.length, 12);
  assert.match(vis(S.watchSheetHtml(sg)), /Season/);
});

test('watch with one store: no band, no invented range, still a median', () => {
  const f = fx();
  const w = f.market.watches.items.find((x) => x.slug === 'portable-water-purifier-bottle');
  const s = S.watchSheetModel(w, null, f.ecom);
  assert.equal(s.range.p25, null);
  assert.equal(s.median, 56.95);
  assert.doesNotMatch(S.watchSheetHtml(s), /class="range/);
  assert.match(vis(S.watchSheetHtml(s)), /\$56\.95/);
});

test('nothing trending: one quiet line, never a zero list', () => {
  const tr = TR.trends();
  tr.products = [];
  assert.match(vis(page({ cls: 'P', tr })), /Nothing trending right now\./);
  assert.match(vis(page({ cls: 'P', tr, view: { cat: 'outdoors' } })), /Nothing trending in this category\./);
});

test('category cards: each basis is labelled with its own period; building categories share one line', () => {
  const f = fx();
  const c = Object.fromEntries(S.categoryList(f.market, 'all').map((x) => [x.key, x]));
  assert.deepEqual(c.computers.period, { word: '1-mo', when: 'Oct 2026' });
  assert.equal(c.computers.conf, null); // one official number: no mark
  const plat = S.categoryModel({ key: 'home', label: 'Home', value: 2.4, basis: 'platforms', period: '30 days to 2026-12-10', confidence: { score: 0.8 }, platform_index: { value: 102.4, span_days: 32, change_7d: 0.4, change_30d: 2.4, hist: [['2026-12-09', 102], ['2026-12-10', 102.4]] } });
  assert.deepEqual(plat.period, { word: '30 days', when: 'Dec 10' });
  assert.ok(plat.conf);
  const blend = S.categoryModel({ key: 'home', label: 'Home', value: 1.1, basis: 'blend', period: '2026-11-08 to 2026-11-30; official 2026-10', confidence: { score: 0.6 }, platform_index: { value: 101, span_days: 22, hist: [] } });
  assert.equal(blend.period.word, 'blend');
  assert.equal(blend.period.when, 'Nov 8 to Nov 30 · Oct 2026');
  // outdoors has no value yet: it reads Building with its day count, in one shared row, not a dashed card each
  assert.equal(c.outdoors.value, null);
  assert.equal(c.outdoors.days, 5);
  const h = page();
  const row = vis(h).match(/Outdoors[^]*?Building · [\d to]+ of 14 days/);
  assert.ok(row, 'one building line');
  assert.equal((h.match(/Building · /g) || []).length, 1);
});

test('category chip narrows Trending, products, categories and deals; platforms stay', () => {
  const h = vis(page({ view: { cat: 'outdoors' } }));
  assert.match(h, /Insulated Wetsuit Hood/);
  assert.doesNotMatch(h, /Mini PC Ryzen/);
  assert.match(h, /Platforms/);
  assert.doesNotMatch(h, /Computers and parts/);
});

test('platforms: the board keeps store names, ranks absent stay absent, a no-signal platform lists last', () => {
  const f = fx();
  const rows = S.platformRows(f.market, 'all', 30);
  const last = rows[rows.length - 1];
  assert.equal(last.name, 'Facebook Marketplace');
  assert.deepEqual([last.score, last.app, last.web, last.move], [null, null, null, null]);
  // its row shows the No data mark in every rank cell it carries, never a 0
  const row = page().split('data-key="Facebook Marketplace"')[1].split('</tr>')[0];
  assert.ok((row.match(/aria-label="No data"/g) || []).length >= 2);
  assert.doesNotMatch(row, />0</);
  const h = page();
  assert.match(h, /data-open="platform"/);
  assert.match(vis(h), /Walmart/);
  assert.match(vis(h), /Amazon/);
  assert.doesNotMatch(vis(h), /Rank 0\b/);
  // kind switch: resale shows only resale platforms
  assert.ok(S.platformRows(f.market, 'resale', 30).every((r) => r.kind === 'Resale'));
});

test('platforms: a column that is empty on every row is left out (30-day move before the writer has 30 days)', () => {
  const f = fx();
  assert.ok(f.market.platforms.every((p) => p.signals.tranco_change_30d == null));
  assert.doesNotMatch(page(), /30-day move/);
  f.market.platforms[0].signals.tranco_change_30d = 3;
  assert.match(S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'D', view: {} }), /30-day move/);
});

test('platforms on a phone: compact rows (rank, name, kind), 10 then Show more; no per-row rank labels', () => {
  const f = fx();
  const h = S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'P', view: {} });
  const sec = h.slice(h.indexOf('s-plat'), h.indexOf('s-deal'));
  assert.doesNotMatch(sec, /<table|App rank|Web rank/);
  assert.equal((sec.match(/data-open="platform"/g) || []).length, 10);
  assert.match(vis(sec), /1 Vinted Resale 2 Walmart Retailer/);
  assert.match(sec, /data-more="plat"/);
  const all = S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'P', view: { plat: 30 } });
  assert.doesNotMatch(all.slice(all.indexOf('s-plat'), all.indexOf('s-deal')), /data-more="plat"/);
});

test('watch sheet: one fact per key-value row, so no value crowds its label', () => {
  const f = fx();
  const w = f.market.watches.items.find((x) => x.slug === 'rtx-4080');
  const h = S.watchSheetHtml(S.watchSheetModel(w, f.ecom.watch.find((x) => x.slug === 'rtx-4080'), f.ecom));
  const dd = [...h.matchAll(/<dt>([^<]*)<\/dt><dd>([^]*?)<\/dd>/g)].map((m) => [m[1], vis(m[2])]);
  const by = Object.fromEntries(dd);
  assert.equal(by['Best price'], '$880');
  assert.equal(by['Best at'], 'Newegg');
  assert.equal(by['Page views, Oct 2026'], '2,136');
  assert.equal(by['Views, 1-mo'], '\u221220.4%');
  for (const [, v] of dd) assert.ok(v.length <= 16, 'short value: ' + v);
});

test('trends: only shopping rows, and no section without them', () => {
  const f = fx();
  assert.deepEqual(S.trendRows(f.market), []);
  assert.doesNotMatch(page(), /Shopping searches/);
  f.market.trending[1].shopping = true;
  f.market.trending[1].title = 'black friday deals';
  assert.deepEqual(S.trendRows(f.market).map((t) => t.title), ['Black friday deals']);
  assert.match(vis(S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'D', view: {} })), /Shopping searches Black friday deals/);
});

test('setup: one quiet row counting stores that need a key or wall the collector; other keys are not stores', () => {
  const f = fx();
  const s = S.setupModel(f.market);
  // eBay and Best Buy need keys, Amazon walls its collector; the Census key is not a store, Target was never read
  assert.equal(s.stores, 3);
  assert.ok(s.rows.some((r) => r.name === 'Census economic indicators' && !r.store));
  const h = page();
  assert.equal((h.match(/stores need setup/g) || []).length, 1);
  assert.match(h, /data-sheet="data" data-scope="setup"/);
  assert.ok(vis(h).endsWith('3 stores need setup'), 'last thing on the page');
  f.market.sources = f.market.sources.filter((x) => x.status === 'ok');
  assert.doesNotMatch(S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'D', view: {} }), /need setup/);
});

test('no store health and no source names on the page', () => {
  const f = fx();
  const h = vis(page());
  for (const s of f.market.sources) {
    assert.ok(!h.includes(s.name), 'source name on page: ' + s.name);
    assert.ok(!h.includes(s.id), 'source id on page: ' + s.id);
  }
  assert.doesNotMatch(h, /Coverage|sites answering|Latest search|Kept 24 h|Last OK|HTTP \d|Blocked|API keys|Sellers|Prices stored/);
});

test('Shop shows prices: nothing on the market page is masked', () => {
  assert.doesNotMatch(page(), /\$\u2022/);
  assert.doesNotMatch(page({ cls: 'P' }), /\$\u2022/);
});

test('titles are never cut: no ellipsis, every word of a long title is on the page', () => {
  const f = fx();
  const long = 'MSI Suprim X GeForce RTX 4080 16GB GDDR6X PCI Express 4.0 Graphics Card RTX 4080 16GB SUPRIM X Triple Fan Edition';
  f.market.movers[0].title = long;
  const h = vis(S.marketBody({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'P', view: {} }));
  assert.ok(h.includes(long));
  assert.doesNotMatch(h, /\u2026/);
  // emoji and a pasted price segment go; the words stay
  assert.equal(S.cleanTitle('\u{1F525} ASUS PRIME RTX 5080 16GB OC Edition | BRAND NEW | $1,900 \u{1F525}'), 'ASUS PRIME RTX 5080 16GB OC Edition · BRAND NEW');
});

test('products: kind chip, best price and where; a sale reads against the regular price', () => {
  const f = fx();
  const ps = S.productList(f.market, 'all', 'all');
  assert.equal(ps[0].kind, 'price_drop');
  const sale = ps.find((p) => p.kind === 'on_sale');
  assert.equal(sale.move, 'vs regular');
  assert.equal(S.productList(f.market, 'all', 'bestseller').every((p) => p.kindWord === 'Best seller'), true);
  const sheet = S.productSheetModel(f.market.movers[0]);
  assert.ok(sheet.offers.length >= 1);
  assert.match(vis(S.productSheetHtml(sheet)), /Open at /);
});

test('deals: under-median listings and local resale against the watch median, with posted age and pickup', () => {
  const f = fx();
  const ds = S.dealRows(f.market, f.ecom, f.listings, {});
  assert.ok(ds.length >= 2);
  assert.deepEqual(ds.map((d) => d.vs), ds.map((d) => d.vs).slice().sort((a, b) => a - b));
  const fb = ds.find((d) => d.where === 'Facebook Marketplace' && d.posted != null);
  assert.ok(fb, 'posted age from the listings feed');
  assert.equal(fb.pickup, true);
  assert.match(vis(page()), /posted .* ago · Pickup/);
  // condition New hides rows whose condition is not stated
  assert.ok(S.dealRows(f.market, f.ecom, f.listings, { cond: 'new' }).every((d) => d.cond === 'new'));
});

test('feed down: one Shop status with Try again; no feed parts drawn', () => {
  const h = S.marketBody({ m: null, e: null, l: null, now: NOW, cls: 'P', view: {} });
  assert.match(vis(h), /Shop data is not reporting\./);
  assert.equal((h.match(/data-retry="shop"/g) || []).length, 1);
  assert.doesNotMatch(h, /Trending|Your watches/);
});

test('freshness: one mark; out of date past twice the refresh; a missing part is counted', () => {
  const f = fx();
  const a = S.freshArgs(f.market, NOW, 0);
  assert.deepEqual(a, { age: 600, refresh: 3600, missing: 0 });
  const fresh = D.fresh(a);
  assert.match(fresh, /class="fresh"/);
  assert.doesNotMatch(fresh, /warn/);
  const old = D.fresh(S.freshArgs(Object.assign(f.market, { age: 3 * 3600 }), NOW, 0));
  assert.match(old, /warn/);
  assert.match(vis(old), /Out of date/);
  assert.equal(S.freshArgs(fx().market, NOW, 1).missing, 1);
  assert.match(D.fresh(S.freshArgs(fx().market, NOW, 1)), /warn/);
  assert.deepEqual(S.freshArgs(null, NOW, 0), { age: null, refresh: 3600, missing: 1 });
});

test('TV board: strip, six trending rows and six movers on the board; categories and platforms below it', () => {
  const h = page({ tv: true });
  const board = h.slice(h.indexOf('<div class="board">'), h.indexOf('shop-tv2'));
  assert.match(board, /Trending/);
  assert.match(board, /Best sellers and movers/);
  assert.doesNotMatch(board, /Category prices|Platforms/);
  assert.match(h.slice(h.indexOf('shop-tv2')), /Category prices[^]*Platforms/);
  assert.ok((board.match(/class="frow trow/g) || []).length <= 6);
  assert.ok((board.match(/data-open="product"/g) || []).length <= 6);
  assert.doesNotMatch(h, /need setup|Deals and resale|data-more=/);
});

test('Data sheet: sources, blends with parts, method and setup come from the feed; a watch scope narrows the sources', () => {
  const f = fx();
  const d = S.dataModel(f.market, '');
  assert.ok(d.sources.some((s) => s.name === 'Quarterly e-commerce retail sales' && s.state === 'ok'));
  assert.ok(d.sources.some((s) => s.state === 'needs_key'));
  assert.ok(!d.sources.some((s) => /Keepa|Target/.test(s.name)), 'paid and never-read sites are not sources');
  assert.ok(d.blends.some((b) => /RTX 4080/.test(b.label) && b.parts.length >= 2));
  assert.ok(d.setup.some((s) => s.line === 'eBay prices need a free developer key'));
  const w = S.dataModel(f.market, 'watch:rtx-4080');
  assert.ok(w.sources.length >= 1 && w.sources.every((s) => /listings/.test(s.name)));
  assert.equal(w.blends.length, 1);
});
