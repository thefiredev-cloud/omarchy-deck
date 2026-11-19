// node --test tests/*.test.js  (Shop page glue, PgShop 2026-11-14): the real DeckPages registry and static/pages/shop.js in a sandbox.
// A fetch that never settles must end in the page's not-reporting state, never a blank page (PageLanes 13.6).
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
const shop = fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8');

// a sandbox where every fetch hangs forever and every timer fires at once (so the 60 s bound is reached without waiting)
function sandbox() {
  const el = () => ({ innerHTML: '', addEventListener() {}, querySelector: () => null });
  const pages = { 'pg-shop-market': el(), 'pg-shop-orders': el() };
  const ctx = {
    console, Promise, Date, Math, JSON, URLSearchParams, encodeURIComponent, decodeURIComponent,
    AbortController, setTimeout: (fn) => { Promise.resolve().then(fn); return 1; }, clearTimeout() {},
    fetch: () => new Promise(() => {}),
    localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, getElementById: (id) => pages[id] || el(), addEventListener() {}, documentElement: { dataset: { dc: 'P' }, classList: { contains: () => false } } }
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\n' + registry + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;', ctx);
  vm.runInContext(shop, ctx);
  return { ctx, pages };
}

test('market: every feed hanging ends in "Shop data is not reporting" with one Try again', async () => {
  const { ctx, pages } = sandbox();
  await ctx.DeckPages.dispatch('shop/market', false);
  // the page says Loading first, then each part's 60 s bound ends: wait for the last state
  for (let i = 0; i < 20 && !/not reporting/.test(pages['pg-shop-market'].innerHTML); i++) await new Promise((r) => setImmediate(r));
  const h = pages['pg-shop-market'].innerHTML;
  assert.match(h, /Shop data is not reporting\./);
  assert.equal((h.match(/data-retry="shop"/g) || []).length, 1);
});

test('orders: a hanging /api/commerce ends in "Orders are not reporting", never a blank page', async () => {
  const { ctx, pages } = sandbox();
  await ctx.DeckPages.dispatch('shop/orders', false);
  for (let i = 0; i < 20 && !pages['pg-shop-orders'].innerHTML; i++) await new Promise((r) => setImmediate(r));
  assert.match(pages['pg-shop-orders'].innerHTML, /Orders are not reporting\./);
});
