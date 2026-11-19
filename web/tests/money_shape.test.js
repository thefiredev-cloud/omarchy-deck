// node --test tests/*.test.js  (Money: each read carries a shape check for the guard; DoMarkets 2026-11-15, #372 step 2; no DOM)
// The guard (DeckPages.get, BGuard #363, in main since #377) keeps the last good answer when a refresh fails, and takes opt.shape so a
// wrong-typed answer is a failure. BGuard's chaos run left Markets down on "wrongtype" (Nothing on the calendar, No headlines right now).
// Here the real registry runs with a scripted fetch: a good answer, then the kit's wrongtype body.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const inv = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(slice(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = new Function('DeckUI', slice(inv, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(DeckUI);
const REG = slice(deck, '// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json'), rawF = fx('finance.sample.json');
const NOW = (rawM.t + 120) * 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// the kit's chaos body for "wrongtype" (Staging/harness/chaos.js): every list a number, a string or an object
const WRONG = { t: 'soon', generated_at: 'x', spots: 7, rows: 'x', homes: {}, items: 5, apps: 'x', regions: 3, groups: true, tiles: 1 };
const TODAY = { t: rawM.t, markets: { t: rawM.t - 60, items: [{ title: 'Fed holds rates', source: 'Reuters', at: rawM.t - 600, topic: 'rates' }] } };
// what GET /api/finance serves: statuses only (rust/src/finance.rs)
const FIN = { t: rawF.t, refresh: rawF.refresh, errors: [], inventory: clone(rawF.inventory), apps: rawF.apps.map((x) => ({ id: x.id, name: x.name, kind: x.kind, route: x.route, status: x.status, last_ok: x.last_ok, has_values: x.values != null })), has_totals: true, not_counted: [] };

class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
const reply = (body) => { const t = JSON.stringify(body); return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(t) }); };
function registry(answers) {
  const document = { hidden: false, documentElement: { classList: { contains: () => false } }, getElementById: () => null, addEventListener() {}, dispatchEvent: () => true };
  const fetch = (url) => { const f = answers[url.replace(/^\/api\//, '')]; return f ? f() : Promise.reject(new TypeError('Failed to fetch')); };
  return vm.runInNewContext(REG + '\nDeckPages;', { DeckUI, console: { error() {} }, setTimeout, clearTimeout, Promise, Date, fetch, AbortController, CustomEvent, document, deckReport() {} }, { timeout: 1000 });
}

test('Markets shapes: the real feeds pass; the wrongtype body, a list and null fail', () => {
  assert.equal(typeof D.SHAPE, 'object');
  assert.deepEqual(Object.keys(D.SHAPE).sort(), ['markets', 'portfolio', 'today', 'trends']);
  assert.equal(D.SHAPE.trends({ t: 1, tickers: [], feeds: [] }), true);
  assert.equal(D.SHAPE.trends({ error: 'file missing' }), true, 'a missing trends file is an answer that says why');
  for (const bad of [WRONG, { tickers: 'x' }, { tickers: [], feeds: {} }, null]) assert.equal(D.SHAPE.trends(clone(bad)), false, JSON.stringify(bad));
  assert.equal(D.SHAPE.markets(clone(rawM)), true);
  assert.equal(D.SHAPE.portfolio(clone(rawP)), true);
  assert.equal(D.SHAPE.today(TODAY), true);
  assert.equal(D.SHAPE.today({ t: 1, markets: { error: 'no relevant headlines' } }), true, 'news that says why it is missing is an answer');
  for (const k of ['markets', 'portfolio', 'today']) for (const bad of [WRONG, [1, 'x', null], null, 'x']) assert.equal(D.SHAPE[k](clone(bad)), false, k + ' ' + JSON.stringify(bad));
  assert.equal(D.SHAPE.markets(Object.assign(clone(rawM), { catalysts: 'x' })), false, 'catalysts that are not a list');
  assert.equal(D.SHAPE.portfolio(Object.assign(clone(rawP), { totals: [] })), false, 'totals that are not an object');
});

test('a wrong-typed refresh keeps the last good Markets rows under the guard, instead of "Nothing on the calendar"', async () => {
  let mode = 'ok';
  const P = registry({ markets: () => reply(mode === 'ok' ? rawM : WRONG), portfolio: () => reply(mode === 'ok' ? rawP : WRONG), today: () => reply(mode === 'ok' ? TODAY : WRONG) });
  for (const k of ['markets', 'portfolio', 'today']) assert.equal((await P.get(k, { shape: D.SHAPE[k] })).ok, true, k);
  mode = 'wrong';
  // without the shape the wrong body is an answer, and the page reads it as empty (the fault BGuard's chaos run found); a registry of its
  // own, because a passing answer replaces the last good one
  const bare = await registry({ markets: () => reply(WRONG) }).get('markets');
  assert.deepEqual([bare.ok, bare.stale], [true, undefined]);
  assert.match(vis(D.catalysts(bare.data, NOW, {})), /Nothing on the calendar/);
  const m = await P.get('markets', { shape: D.SHAPE.markets }), p = await P.get('portfolio', { shape: D.SHAPE.portfolio }), t = await P.get('today', { shape: D.SHAPE.today });
  for (const [k, r] of [['markets', m], ['portfolio', p], ['today', t]]) assert.deepEqual([r.ok, r.stale, r.error], [true, true, 'wrong shape'], k);
  const h = D.page(m.data, p.data, t.data, null, NOW, {}, { m: 'done', p: 'done', t: 'done', tr: 'done' }, { cls: 'P', tr: { t: NOW / 1000, feeds: [], tickers: [] } });
  assert.doesNotMatch(vis(h), /Nothing on the calendar|No headlines right now|not reporting|No positions in the snapshot/);
  assert.match(vis(h), /Fed holds rates/);
  assert.match(h, /<div class="strip" data-n="8" data-nb="8" role="group" aria-label="Markets">/, 'the strip keeps its eight tiles');
});

test('a first read that is wrong-typed reads as not reporting, never as an empty page', async () => {
  const P = registry({ markets: () => reply(WRONG) });
  const r = await P.get('markets', { shape: D.SHAPE.markets });
  assert.deepEqual([r.ok, r.error], [false, 'wrong shape']);
  // the glue turns it into {error}, which the board names as not reporting
  assert.match(vis(D.board({ error: r.error })), /Markets are not reporting/);
});

test('Accounts: the statuses read passes finShape; a wrong-typed answer is "Money is not reporting" with Try again, never "None yet"', async () => {
  assert.equal(DeckUI.finShape(clone(FIN)), true);
  for (const bad of [WRONG, Object.assign(clone(FIN), { errors: 'x' }), Object.assign(clone(FIN), { inventory: [] }), Object.assign(clone(FIN), { not_counted: 'kraken' }), [], null])
    assert.equal(DeckUI.finShape(bad), false, JSON.stringify(bad).slice(0, 60));
  // what the page drew from the wrongtype body before: an empty page that says nothing was ever captured
  assert.match(vis(DeckUI.finPage(clone(WRONG), NOW, null)), /None yet/);
  let mode = 'ok';
  const P = registry({ finance: () => reply(mode === 'ok' ? FIN : WRONG) });
  assert.equal((await P.get('finance', { shape: DeckUI.finShape })).ok, true);
  mode = 'wrong';
  const r = await P.get('finance', { shape: DeckUI.finShape });
  assert.deepEqual([r.ok, r.stale, r.error], [false, undefined, 'wrong shape'], 'the finance route is never kept: no last good');
  const h = DeckUI.finPage({ error: r.error }, NOW, null);
  assert.match(h, /<div class="es es-bad" role="status">[^]*Money is not reporting<\/b>[^]*data-retry="money\/accounts">Try again<\/button>/);
  assert.doesNotMatch(h, /stale-bar/, 'a failed read is the failed state, never a warn wash');
  assert.doesNotMatch(vis(h), /None yet/);
});

test('wiring: Markets passes its shape on every read; Accounts reads statuses through the registry and amounts only through the controller', () => {
  const glue = inv.slice(inv.indexOf('// ==== DECK INVEST UI END ===='));
  assert.match(glue, /const ivGet=path=>DeckPages\.get\(path,\{timeout:DeckInvest\.ABORT_MS,shape:DeckInvest\.SHAPE\[path\]\}\)/);
  assert.match(glue, /ivGet\('markets'\)[^]*ivGet\('portfolio'\)[^]*ivGet\('today'\)/);
  const money = deck.slice(deck.indexOf('// ---- Money > Accounts (route money/accounts)'), deck.indexOf('// called by app.js when a page comes on screen'));
  assert.match(money, /const finRead=\(\)=>DeckPages\.get\('finance',\{timeout:60000,shape:DeckUI\.finShape\}\)/);
  assert.match(money, /DeckUI\.finCtl\(\{get:finGet,/, 'Show amounts still reads its route through finGet alone');
  assert.doesNotMatch(money, /DeckPages\.get\('finance-values'/);
});
