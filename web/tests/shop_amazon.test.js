// node --test tests/*.test.js  (Shop: the Amazon item-level view, PgShop 2026-11-15)
// GET /api/amazon (rust/src/amazon.rs, read-only on the owner's shop database) back on the v3 page: the watch sheet's Amazon block,
// "Amazon price drops" on Market, a source row and the drop rule in the Data sheet. The fixture follows the route's own shape.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
const fx = require('./shop_fixture.cjs');
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const NOW_S = fx().market.t + 600, NOW = NOW_S * 1000;

const offer = (o) => Object.assign({ title: 'NVIDIA GeForce RTX 4080 Founders Edition 16GB', url: 'https://www.amazon.com/dp/B0BJFRT43X', price: 949.99, seen: NOW_S - 1800,
  prev: null, min7: 949.99, avg7: 949.99, min30: 949.99, max30: 1099, dropped: false, below_avg: null, low30: false, current: true }, o);
const amazon = (o) => Object.assign({
  t: NOW_S - 1800, generated_at: NOW_S, as_of: NOW_S - 1800, age: 1800, stale: false, src: 'shop trends database (Amazon search pages)',
  drop_rule: 'A drop is a price at least 5% under its own 7 day average, or lower than the price before it.',
  watch: [
    { slug: 'rtx-4080', query: 'rtx 4080', best: offer({ price: 899.99, prev: 999.99, dropped: true, below_avg: 0.081, avg7: 979.5, low30: true, min30: 899.99 }),
      items: [offer({ price: 899.99, prev: 999.99, dropped: true, below_avg: 0.081, avg7: 979.5, low30: true, min30: 899.99 }), offer({ title: 'ASUS TUF RTX 4080 Super', url: 'https://www.amazon.com/dp/B0CSK2ZQGW', price: 1049.99 })],
      offers: 2, drops: 1, line: [1029.99, 999.99, null, 979.99, 949.99, 899.99], days: 6, chg7: -0.1001, chg30: null, low30: 879.99 },
    { slug: 'pellet-grill', query: 'pellet grill', best: null, items: [], offers: 0, drops: 0, line: [], days: 0, chg7: null, chg30: null, low30: null }],
  deals: [
    Object.assign(offer({ price: 899.99, prev: 999.99, dropped: true, below_avg: 0.081, low30: true }), { query: 'rtx 4080' }),
    Object.assign(offer({ title: 'Traeger Pro 575 <script>', url: 'javascript:alert(1)', price: 599, prev: 649, dropped: true }), { query: 'pellet grill' })]
}, o);
const page = (a, o) => { const f = fx(); return S.marketBody(Object.assign({ m: f.market, e: f.ecom, l: f.listings, a, now: NOW, cls: 'D', view: {} }, o)); };
const sheet = (a) => {
  const f = fx(), w = f.market.watches.items.find((x) => x.slug === 'rtx-4080');
  const s = S.watchSheetModel(w, f.ecom.watch.find((x) => x.slug === 'rtx-4080'), f.ecom);
  return S.watchSheetHtml(s, S.amazonBlockModel(a, s.slug, s.name, NOW));
};

test('watch sheet: the Amazon block gives best now, 30-day low and the gap, 7- and 30-day change, drops, the line and every offer', () => {
  const h = sheet(amazon());
  const blk = h.slice(h.indexOf('class="sh-sec s-az"'));
  const by = Object.fromEntries([...blk.matchAll(/<dt>([^<]*)<\/dt><dd>([^]*?)<\/dd>/g)].map((m) => [m[1], vis(m[2])]));
  assert.equal(by['Best now'], '$900');
  assert.equal(by['30-day low'], '$880');
  assert.equal(by['Now vs 30-day low'], '+2.3%');
  assert.equal(by['7 days'], '\u221210.0%');
  assert.equal(by['30 days'], 'No data', 'a missing change is No data, never 0');
  assert.equal(by['Price drops'], '1');
  assert.match(blk, /class="chart/);
  // the feed's two offers, each a link to its product page in a new tab, with its own tags
  assert.equal((blk.match(/class="frow azrow"/g) || []).length, 2);
  assert.match(blk, /href="https:\/\/www\.amazon\.com\/dp\/B0BJFRT43X" target="_blank" rel="noopener noreferrer"/);
  assert.match(vis(blk), /was \$1,000 · \u22128\.1% vs 7-day average · 30-day low/);
  assert.doesNotMatch(vis(blk), /ASUS TUF RTX 4080 Super was|ASUS TUF RTX 4080 Super 30-day low/);
});

test('watch sheet: a watch whose Amazon search is matched by its query words gets the block; no Amazon search, no block', () => {
  const a = amazon(); a.watch[0].slug = 'rtx4080-gpu';
  assert.match(sheet(a), /s-az/, 'query "rtx 4080" matches the watch label');
  a.watch[0].query = 'rtx 4090';
  assert.doesNotMatch(sheet(a), /s-az|Amazon/, 'no search, no block, never an empty one');
  assert.doesNotMatch(sheet({ error: 'shop database missing', stale: true, watch: [], deals: [] }), /s-az/);
  // the search exists but carries nothing (no price now, no low, no line, no offers): still no block
  const empty = amazon(); empty.watch[0] = { slug: 'rtx-4080', query: 'rtx 4080', best: null, items: [], offers: 0, drops: 0, line: [], days: 0, chg7: null, chg30: null, low30: null };
  assert.doesNotMatch(sheet(empty), /s-az/);
});

test('a stale Amazon view says so on its own block only; the page keeps its one freshness mark', () => {
  const a = amazon({ stale: true, age: 35 * 3600, t: NOW_S - 35 * 3600 });
  assert.match(vis(sheet(a)), /Amazon Out of date · 35 h/);
  const h = page(a);
  assert.match(vis(h), /Amazon price drops Out of date · 35 h/);
  assert.equal((h.match(/Out of date/g) || []).length, 1, 'only the Amazon section carries it');
  assert.deepEqual(S.freshArgs(fx().market, NOW, 0).missing, 0, 'the Amazon view never counts against the page mark');
  assert.doesNotMatch(vis(sheet(amazon())), /Out of date/);
});

test('Market: "Amazon price drops" lists the feed deals in order with the same tags; unsafe links and markup never pass', () => {
  const h = page(amazon());
  const sec = h.slice(h.indexOf('s-az'), h.indexOf('s-deal'));
  assert.equal((sec.match(/class="frow azrow"/g) || []).length, 2);
  assert.ok(vis(sec).indexOf('NVIDIA') < vis(sec).indexOf('Traeger'), 'feed order');
  assert.match(vis(sec), /RTX 4080 · was \$1,000 · \u22128\.1% vs 7-day average · 30-day low/);
  assert.doesNotMatch(sec, /javascript:|<script>/);
  assert.match(sec, /<div class="frow azrow"><span class="fl"><b class="ptitle-t">Traeger Pro 575 &lt;script&gt;/);
  // after the platforms board, over Deals and resale in the same column
  assert.ok(h.indexOf('s-plat') < h.indexOf('s-az') && h.indexOf('s-az') < h.indexOf('s-deal'));
});

test('Market: no deals, a failed read or no Amazon answer at all means no section, never an empty one', () => {
  for (const a of [amazon({ deals: [] }), { error: 'shop database missing', stale: true, watch: [], deals: [] }, null, undefined])
    assert.doesNotMatch(page(a), /Amazon price drops/);
  assert.doesNotMatch(page(amazon(), { tv: true }), /Amazon price drops/, 'TV board unchanged');
});

test('Data sheet: the Amazon view is a source row with its own date and state, and the drop rule is in the method', () => {
  const d = S.dataModel(fx().market, '', [], amazon());
  const row = d.sources.find((s) => s.name === 'Amazon prices');
  assert.deepEqual([row.state, row.asOf], ['ok', new Date((NOW_S - 1800) * 1000).toISOString().slice(0, 10)]);
  assert.match(row.gives, /2 watched searches/);
  assert.deepEqual(d.method.find((m) => m[0] === 'Amazon price drops'), ['Amazon price drops', 'A drop is a price at least 5% under its own 7 day average, or lower than the price before it.']);
  assert.equal(S.dataModel(fx().market, '', [], amazon({ stale: true })).sources.find((s) => s.name === 'Amazon prices').state, 'stale');
  assert.equal(S.dataModel(fx().market, '', [], { error: 'shop database missing' }).sources.find((s) => s.name === 'Amazon prices').state, 'never');
  // no source text on the page itself
  assert.doesNotMatch(vis(page(amazon())), /shop trends database|Amazon search pages|drop is a price/);
});

// ---- WebKit defect D3 (2026-11-15): on a phone the header row squeezed the sub-tabs to "Marke" ----
test('phone: the category chips leave the header for their own row under it; other classes keep them in the header', () => {
  assert.equal(S.headScope('P', false, 'all'), '', 'no chips in the phone header row');
  assert.equal(S.headScope('D', true, 'all'), '', 'none on TV');
  for (const c of ['L', 'T', 'D', 'XL']) assert.match(S.headScope(c, false, 'home'), /class="chips scroll keep"[^]*data-cat="home" aria-pressed="true"/);
  const p = page(amazon(), { cls: 'P', view: { cat: 'outdoors' } });
  assert.ok(p.indexOf('<div class="shop-cats">') === 0, 'the chip row is the first thing on the phone page');
  assert.match(p.slice(0, p.indexOf('shop-strip')), /data-cat="outdoors" aria-pressed="true"/);
  assert.doesNotMatch(page(amazon(), { cls: 'D' }), /shop-cats/);
});

test('phone: the sub-tab row is never a shrinking scroller, so neither label can be cut', () => {
  const css = fs.readFileSync(path.join(__dirname, '../static/css/shop.css'), 'utf8');
  assert.match(css, /@media \(max-width:599px\)\{#pg-shop \.phead \.subrow\{flex:0 0 auto;overflow:visible\}\}/);
});
