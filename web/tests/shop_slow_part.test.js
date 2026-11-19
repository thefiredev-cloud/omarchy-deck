// node --test tests/*.test.js  (Shop > Market, HotShop 2026-11-15): one slow part never holds the page blank.
// Live fault: on a cold deck the phone showed the sub-tab row over nothing. The page waited for all four reads (market feed, watch
// detail, listings, Amazon) before its first paint, and Amazon runs sqlite3 over a 130 MB database, so a slow Amazon read left
// Market blank for up to 60 s with no error. The real DeckPages registry and static/pages/shop.js run in a sandbox; the market,
// watch-detail and listings answers are the public store and marketplace rows of tests/shop_fixture.cjs, trends the World fixture.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fx = require('./shop_fixture.cjs');
const TR = require('./trends_fixture.cjs');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const block = (b, e) => deck.slice(deck.indexOf(b), deck.indexOf(e));
const helpers = block('// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const registry = block('// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const shop = fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8');

// answers: path -> data (answered at once) or 'hang' (never answers). Timers never fire, so the 60 s bound is never reached.
function sandbox(answers, cls) {
  const el = () => ({ innerHTML: '', addEventListener() {}, querySelector: () => null });
  const pages = { 'pg-shop-market': el() };
  const late = {};
  const fetch = (url) => {
    const p = String(url).replace(/^\/api\//, '').replace(/\?.*$/, ''), a = answers[p];
    const res = (data) => ({ ok: true, status: 200, json: async () => data });
    if (a === 'late') return new Promise((go) => { late[p] = (data) => go(res(data)); });
    if (a === undefined || a === 'hang') return new Promise(() => {});
    return Promise.resolve(res(a));
  };
  const ctx = {
    console, Promise, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent, AbortController,
    setTimeout: () => 1, clearTimeout() {}, fetch,
    localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, getElementById: (id) => pages[id] || el(), addEventListener() {}, documentElement: { dataset: { dc: cls || 'P' }, classList: { contains: () => false } } },
    innerWidth: 390, innerHeight: 844
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + registry + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;', ctx);
  vm.runInContext(shop, ctx);
  return { ctx, page: pages['pg-shop-market'], late };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('market: the page paints its rows while Amazon is still answering (phone)', async () => {
  const f = fx();
  const { ctx, page } = sandbox({ 'ecom-market': f.market, ecom: f.ecom, listings: f.listings, amazon: 'hang', trends: TR.trends() }, 'P');
  ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  const h = page.innerHTML;
  assert.match(h, /class="frow trow/, 'the trending rows paint');
  assert.match(h, /Trending/);
  assert.match(h, /Listings/);
  assert.match(h, /class="shop-cats"/, 'the phone keeps its category row');
  assert.ok(text(h).length > 1000, 'the page has its words, not the sub-tab row alone');
});

test('market: one hanging side part degrades nothing else on any class', async () => {
  for (const cls of ['P', 'L', 'D']) {
    for (const slow of ['ecom', 'listings', 'amazon', 'trends']) {
      const f = fx(), answers = { 'ecom-market': f.market, ecom: f.ecom, listings: f.listings, amazon: { t: f.market.t, watch: [], deals: [] }, trends: TR.trends() };
      answers[slow] = 'hang';
      const { ctx, page } = sandbox(answers, cls);
      ctx.DeckPages.dispatch('shop/market', false);
      await settle();
      assert.match(page.innerHTML, slow === 'trends' ? /s-trending[^]*aria-busy="true"/ : /class="frow trow/, cls + ' with ' + slow + ' hanging');
      assert.match(page.innerHTML, /Best sellers and movers/, cls + ' with ' + slow + ' hanging');
    }
  }
});

test('market: before the market feed answers the page draws its loading skeleton, never a blank page and never a warning', async () => {
  const { ctx, page } = sandbox({}, 'P');
  ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  const h = page.innerHTML;
  assert.match(h, /aria-busy="true"/, 'a skeleton the reader is told is loading');
  assert.match(h, /class="skel /);
  assert.match(h, /Trending[^]*Best sellers and movers/, 'under the titles the page will have');
  // DESIGN 6: loading is a static skeleton; the stale box (warn triangle) meant "out of date" and read as a warning
  assert.doesNotMatch(h, /es-stale|sd warn|stale-bar|Loading prices/);
  assert.doesNotMatch(h, /not reporting/);
});

test('market: a part that answers late joins the painted page', async () => {
  const f = fx();
  const { ctx, page, late } = sandbox({ 'ecom-market': f.market, ecom: f.ecom, listings: f.listings, amazon: 'late', trends: TR.trends() }, 'P');
  ctx.DeckPages.dispatch('shop/market', false);
  await settle();
  assert.match(page.innerHTML, /class="frow trow/);
  assert.doesNotMatch(page.innerHTML, /Amazon price drops/);
  late.amazon({ t: f.market.t, watch: [], deals: [{ title: 'Garmin Forerunner 265 Running Smartwatch', price: 299.99, prev: 349.99, dropped: true, url: 'https://www.amazon.com/dp/B0BS1T9J4Y', query: 'garmin forerunner' }] });
  await settle();
  assert.match(page.innerHTML, /Amazon price drops/);
  assert.match(page.innerHTML, /Garmin Forerunner 265/);
  assert.match(page.innerHTML, /class="frow trow/, 'the rest of the page stays');
});
