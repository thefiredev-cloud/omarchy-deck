// node --test tests/*.test.js  (Shop, round Better PR b, lane DoShop 2026-11-15)
// Orders on his 2470 px window: Return deadlines and Purchases stack off TV, so no 224 px hole beside Purchases (SeeWs4 W4-8).
// Trending rows (2026-11-17, in the place the watch cards had): a long seller title ends at a word and keeps the size token that tells
// models apart. Every read checks its shape, so a wrong-typed answer is a failed part, never an empty list (SeeStates E5). Beside the
// phone's sub-tabs an out-of-date mark says so. Prices are made up.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const block = (b, e) => deck.slice(deck.indexOf(b), deck.indexOf(e));
const helpers = block('// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const registry = block('// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const shopSrc = fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8');
const D = new Function(helpers + '\nreturn DeckUI;')();
const S = new Function('DeckUI', shopSrc + '\nreturn DeckShop;')(D);
const css = fs.readFileSync(path.join(__dirname, '../static/css/shop.css'), 'utf8');
const fx = require('./shop_fixture.cjs');
const NOW = (fx().market.t + 600) * 1000;
const sectClass = (h, s) => (new RegExp('class="sect ([^"]*\\b' + s + ')"').exec(h) || [])[1];
const TR = require('./trends_fixture.cjs');

const orders = () => ({
  orders: [{ id: 'a', title: 'Sample keyboard', date: '2026-11-04', return_by: '2026-12-04', amount: null },
    { id: 'b', title: 'Sample cable', date: '2026-11-04', return_by: null, amount: 12.5 },
    { id: 'c', title: 'Sample lamp', date: '2026-11-04', return_by: null, amount: 30 }],
  total: 3, pulls: [{ account: 'tanner', ok: true }], checked: NOW / 1000 - 3600, monitor: { state: 'paused', last_run_at: '2026-10-26T13:40:00Z' }
});

test('W4-8: off TV Return deadlines and Purchases each take the full row, deadlines first; the TV board keeps halves', () => {
  const h = S.ordersBody({ c: orders(), now: NOW, host: 'pc-desktop', rev: false, armed: '' });
  assert.equal(sectClass(h, 's-open'), 'c-12 s-open');
  assert.equal(sectClass(h, 's-rest'), 'c-12 s-rest');
  assert.ok(h.indexOf('s-open') < h.indexOf('s-rest'));
  const tv = S.ordersBody({ c: orders(), now: NOW, host: 'pc-desktop', rev: false, armed: '', tv: true });
  assert.equal(sectClass(tv, 's-open'), 'c-6 s-open');
  assert.equal(sectClass(tv, 's-rest'), 'c-6 s-rest');
  assert.match(tv, /^<div class="board"><div class="g12"><section class="sect c-6 s-open"/);
});

test('trending row: a seller title ends at a word within 36 characters; the whole title rides on the row', () => {
  const tr = TR.trends();
  const r = S.trendingList(tr, 'all')[0];
  const h = S.trendRow(r);
  const t = /<b class="ptitle-t">([^<]*)<\/b>/.exec(h)[1];
  assert.equal(t, 'Portable Power Station 1000Wh\u2026');
  assert.ok(Array.from(t).length <= 37);
  assert.match(h, / title="Portable Power Station 1000Wh LiFePO4 Solar Generator for Camping RV Home Backup"/);
});

test('trending title: the size or pack token that tells models apart survives the cut (review of #383)', () => {
  // the two cards the reviewer read: the memory size sat at characters 33 to 36 and was dropped
  assert.equal(S.cardTitle('GIGABYTE AORUS GeForce RTX 4080 16GB GDDR6X PCI Express 4.0 ATX Graphics Card GV-N4080AORUSX W-16GD'), 'GIGABYTE AORUS GeForce RTX 4080 16GB\u2026');
  assert.equal(S.cardTitle('GIGABYTE AORUS GeForce RTX 5090 32GB GDDR7 PCI Express 5.0 ATX Graphics Card GV-N5090AORUSM ICE-32GD'), 'GIGABYTE AORUS GeForce RTX 5090 32GB\u2026');
  // a token just past the cut (characters 37 to 44) is kept, still ending at a word
  assert.equal(S.cardTitle('Samsung 990 PRO NVMe M.2 Internal SSD 2TB with Heatsink for PS5'), 'Samsung 990 PRO NVMe M.2 Internal SSD 2TB\u2026');
  assert.equal(S.cardTitle('Hint Canned Water Zero Sugar Lemon 12 pack, Blueberry flavor and more'), 'Hint Canned Water Zero Sugar Lemon 12 pack\u2026');
  assert.equal(S.cardTitle('Hint Canned Water Zero Sugar Lemon (12-Pack) Blueberry flavor and more'), 'Hint Canned Water Zero Sugar Lemon (12-Pack)\u2026');
  assert.equal(S.cardTitle('Smart Water Vapor Distilled 16.9 fl oz, 24 Bottles of spring water'), 'Smart Water Vapor Distilled 16.9 fl oz\u2026');
  // no token near the cut: the plain 36-character cut at a word; a short title stays whole
  assert.equal(S.cardTitle('Sample Wood Pellet Grill and Smoker with Foldable Legs'), 'Sample Wood Pellet Grill and Smoker\u2026');
  assert.equal(S.cardTitle('Adamax 40 in. x 40 in. Fire Blanket'), 'Adamax 40 in. x 40 in. Fire Blanket');
  // a token past character 44 is not reached for
  assert.equal(S.cardTitle('Sample Wood Pellet Grill and Smoker with Foldable Legs 2TB'), 'Sample Wood Pellet Grill and Smoker\u2026');
});

test('desk: the categories column is compact on D (laptop) so the 4/4/4 row ends together; XL keeps full cards', () => {
  assert.match(css, /@media \(min-width:1100px\) and \(max-width:1599px\) and \(min-height:500px\)\{\s*html:not\(\.tv\) #pg-shop \.shop-top \.ccard\{padding:var\(--s-3\) var\(--s-4\);gap:var\(--s-1\)\}/);
});

test('phone: beside Market and Orders an out-of-date mark reads "Out of date" with its age; the header wraps rather than overflows', () => {
  assert.match(css, /#pg-shop \.phead:has\(\.subrow\) \.pact>\.fresh\.warn:is\(\[data-short\$=" min"\],\[data-short\$=" h"\],\[data-short\$=" days"\]\)::after\{content:"Out of date \\00B7  " attr\(data-short\)\}/);
  assert.match(css, /#pg-shop \.phead:has\(\.subrow\)\{flex-wrap:wrap\}/);
});

test('shape: the fixture\'s answers pass; wrong-typed lists or blocks fail; an error body is judged by its error', () => {
  const f = fx();
  assert.equal(S.SHAPE['ecom-market'](f.market), true);
  assert.equal(S.SHAPE.ecom(f.ecom), true);
  assert.equal(S.SHAPE.listings(f.listings), true);
  assert.equal(S.SHAPE.commerce(orders()), true);
  assert.equal(S.SHAPE.amazon({ t: 1, watch: [], deals: [] }), true);
  for (const bad of [null, [], 'x', 3, { watches: 'x' }, { watches: { items: 'x' } }, { movers: 5 }, { macro: {} }]) assert.equal(S.SHAPE['ecom-market'](bad), false, JSON.stringify(bad));
  for (const bad of [{ watch: 'x' }, { resale: {} }, { movers_info: [] }, { movers: 'x' }]) assert.equal(S.SHAPE.ecom(bad), false, JSON.stringify(bad));
  assert.equal(S.SHAPE.listings({ listings: {} }), false);
  assert.equal(S.SHAPE.commerce({ orders: 'x' }), false);
  assert.equal(S.SHAPE['ecom-market']({ error: 'down' }), true, 'an error body passes the shape and fails on its error');
  // the kit's chaos `wrongtype` answer (Staging/harness/chaos.js) is a failed read on every route the page reads
  const chaos = { t: 'soon', generated_at: 'x', spots: 7, rows: 'x', homes: {}, items: 5, apps: 'x', regions: 3, groups: true, tiles: 1 };
  for (const k of Object.keys(S.SHAPE)) assert.equal(S.SHAPE[k](chaos), false, k);
  assert.equal(S.SHAPE['ecom-market']({ t: 1, macro: [] }), false, 'the market feed always carries its watches');
});

// the real registry and page glue in a sandbox; every read answers at once with the given body
function sandbox(answers) {
  const el = () => ({ innerHTML: '', addEventListener() {}, querySelector: () => null });
  const pages = { 'pg-shop-market': el(), 'pg-shop-orders': el() };
  const ctx = {
    console, Promise, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    fetch: (url) => { const p = String(url).replace(/^\/api\//, '').replace(/\?.*$/, ''); const a = answers[p]; return a === undefined ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: async () => a }); },
    localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, getElementById: (id) => pages[id] || el(), addEventListener() {}, documentElement: { dataset: { dc: 'P' }, classList: { contains: () => false } } },
    innerWidth: 390, innerHeight: 844
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + registry + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;', ctx);
  const seen = {};
  const get = ctx.DeckPages.get;
  ctx.DeckPages.get = (p, o) => { seen[p] = o; return get(p, o); };
  vm.runInContext(shopSrc, ctx);
  return { ctx, pages, seen };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

test('shape: a wrong-typed market answer is a failed read (not reporting), never "No watches yet"; every read passes its shape', async () => {
  const f = fx();
  const { ctx, pages, seen } = sandbox({ 'ecom-market': { t: f.market.t, watches: 'oops', movers: 7 }, ecom: f.ecom, listings: f.listings, amazon: { watch: [], deals: [] }, trends: TR.trends() });
  ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  const h = pages['pg-shop-market'].innerHTML;
  assert.match(h, /Market prices are not reporting\./, 'the market part failed; the parts that answered stay (E2)');
  assert.doesNotMatch(h, /No watches yet/);
  for (const p of ['ecom-market', 'ecom', 'listings', 'amazon', 'trends']) assert.equal(typeof (seen[p] && seen[p].shape), 'function', p);
  // a wrong-typed side part drops only itself: Trending still paints
  const g = fx();
  const s2 = sandbox({ 'ecom-market': g.market, ecom: { watch: 'x', resale: 5 }, listings: g.listings, amazon: { watch: [], deals: [] }, trends: TR.trends() });
  s2.ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  assert.match(s2.pages['pg-shop-market'].innerHTML, /class="frow trow/);
  // a wrong-typed trends answer is Trending not reporting, never "Nothing trending"
  const s3 = sandbox({ 'ecom-market': g.market, ecom: g.ecom, listings: g.listings, amazon: { watch: [], deals: [] }, trends: { t: 1, products: 'x' } });
  s3.ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  assert.match(s3.pages['pg-shop-market'].innerHTML, /Trending is not reporting/);
  assert.doesNotMatch(s3.pages['pg-shop-market'].innerHTML, /Nothing trending/);
  assert.doesNotMatch(s2.pages['pg-shop-market'].innerHTML, /s-local/);
});

test('shape: a wrong-typed orders answer says Orders are not reporting', async () => {
  const { ctx, pages, seen } = sandbox({ commerce: { orders: 'x' } });
  ctx.DeckPages.dispatch('shop/orders', false);
  await settle();
  assert.match(pages['pg-shop-orders'].innerHTML, /Orders are not reporting\./);
  assert.equal(typeof seen.commerce.shape, 'function');
});

test('E2: with the market feed down, the parts that answered stay under one failed state; with nothing answered, the one state as before', async () => {
  const f = fx();
  const { ctx, pages } = sandbox({ 'ecom-market': { error: 'feed missing' }, ecom: f.ecom, listings: f.listings, amazon: { t: f.market.t, watch: [], deals: [] } });
  ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  const h = pages['pg-shop-market'].innerHTML;
  // the shared failed state (crossed square), the one Surf and Real estate draw, never a red wash bar (L18 page issues)
  assert.match(h, /^<div class="es es-bad" role="status"><svg class="es-i"[^]*?<b class="es-t">Market prices are not reporting\.<\/b><span class="es-l">Try again in a moment\.<\/span><button type="button" class="b es-retry" data-retry="shop">Try again<\/button><\/div>/);
  assert.doesNotMatch(h, /stale-bar/);
  assert.equal((h.match(/data-retry="shop"/g) || []).length, 1, 'one Try again');
  assert.match(h, /class="sect c-12 s-local"/);
  assert.match(h, /class="sect s-deal"/);
  assert.match(h, /class="sect s-lst"/);
  assert.doesNotMatch(h, /s-watch|No watches yet/);
  // the model alone: nothing answered gives the one bar; the TV keeps the one bar
  assert.match(S.marketBody({ m: null, e: null, l: null, a: null, now: NOW, cls: 'P', view: {} }), /^<div class="es es-bad"[^]*Shop data is not reporting\./);
  assert.doesNotMatch(S.marketBody({ m: null, e: f.ecom, l: f.listings, a: null, now: NOW, cls: 'TV', tv: true, view: {} }), /s-local|s-lst/);
});
