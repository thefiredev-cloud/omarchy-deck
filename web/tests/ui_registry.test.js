'use strict';
// DeckPages (static/deck.js, DECK PAGES REGISTRY block): routes, dispatch, refresh gating, hide on leave, guests, late registration, get().
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const A = '// ==== DECK PAGES REGISTRY BEGIN', B = '// ==== DECK PAGES REGISTRY END ====';
const block = deck.slice(deck.indexOf(A), deck.indexOf(B));
assert.ok(deck.indexOf(A) > 0 && deck.indexOf(B) > deck.indexOf(A), 'registry markers present');

// a fresh registry in its own sandbox; sb lets a test set GUEST, document, fetch, DeckShell and the clock
function fresh(sb = {}) {
  const ctx = Object.assign({ console: { error() {} }, setTimeout, clearTimeout, Promise, Date }, sb);
  return vm.runInNewContext(block + '\nDeckPages;', ctx, { timeout: 1000 });
}
// a page that records its calls
function rec(log, name, extra) {
  return Object.assign({
    show: (c) => log.push(name + ':show:' + c.route),
    refresh: (c, tick) => log.push(name + ':refresh:' + tick),
    hide: () => log.push(name + ':hide'),
  }, extra || {});
}

test('parse splits tab, sub and query params', () => {
  const P = fresh();
  const r = P.parse('realestate/residential?zip=92647&q=san+clemente');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { route: 'realestate/residential', tab: 'realestate', sub: 'residential', params: { zip: '92647', q: 'san clemente' } });
  assert.strictEqual(P.parse('surf').sub, '');
  assert.strictEqual(P.parse('/today/').route, 'today');
});

test('dispatch: show on first paint, refresh(ctx,true) on ticks, hide when the route is left', () => {
  const P = fresh(), log = [];
  P.register('realestate/residential', rec(log, 'res'));
  P.register('surf', rec(log, 'surf'));
  P.dispatch('realestate/residential?zip=92647', false);
  P.dispatch('realestate/residential', true);
  P.dispatch('surf', false);
  P.dispatch('surf', true);
  assert.deepStrictEqual(log, ['res:show:realestate/residential', 'res:refresh:true', 'res:hide', 'surf:show:surf', 'surf:refresh:true']);
});

test('lookup: exact route, then the old leaf (sub), then the tab for main or no sub; never the tab for another sub', () => {
  const P = fresh(), log = [];
  P.register('commercial', rec(log, 'old'));
  P.register('home', rec(log, 'home'));
  P.register('surf', rec(log, 'surf'));
  assert.strictEqual(P.resolve('realestate/commercial'), 'commercial', 'old page still paints under the new route');
  assert.strictEqual(P.resolve('surf/main'), 'surf');
  assert.strictEqual(P.resolve('home/fleet'), null, 'Home > Fleet never runs the House page');
  P.register('realestate/commercial', rec(log, 'new'));
  assert.strictEqual(P.resolve('realestate/commercial'), 'realestate/commercial', 'the new page wins once it registers');
});

test('an empty stub never claims a route', () => {
  const P = fresh(), log = [];
  P.register('shop', rec(log, 'old'));
  P.register('shop/shop', {});
  assert.strictEqual(P.resolve('shop/shop'), 'shop');
  assert.deepStrictEqual([...P.routes()], ['shop']);
});

test('refresh gating: a page with every:ms refreshes on ticks only after that long', () => {
  let now = 1_000_000;
  const FakeDate = class extends Date { static now() { return now } };
  const P = fresh({ Date: FakeDate }), log = [];
  P.register('shop/market', rec(log, 'm', { every: 60000 }));
  P.dispatch('shop/market', false);
  now += 15000; P.dispatch('shop/market', true);
  now += 15000; P.dispatch('shop/market', true);
  now += 31000; P.dispatch('shop/market', true);
  assert.deepStrictEqual(log, ['m:show:shop/market', 'm:refresh:true']);
});

test('a page without show gets refresh(ctx,false) on first paint', () => {
  const P = fresh(), log = [];
  P.register('pad', { refresh: (c, tick) => log.push('r:' + tick) });
  P.dispatch('pad', false);
  assert.deepStrictEqual(log, ['r:false']);
});

test('hooks run after the page, survive with it, get hide, and no late show', () => {
  const P = fresh(), log = [];
  P.register(['markets', 'invest'], rec(log, 'page'));
  P.dispatch('markets', false);
  P.hook(['markets', 'invest'], rec(log, 'hook'));
  assert.deepStrictEqual(log, ['page:show:markets'], 'a hook added after first paint does not paint itself');
  P.dispatch('markets', true);
  P.dispatch('today', false);
  assert.deepStrictEqual(log, ['page:show:markets', 'page:refresh:true', 'hook:refresh:true', 'page:hide', 'hook:hide']);
});

test('a hook alone serves a route with no page (ops.js on Fleet)', () => {
  const P = fresh(), log = [];
  P.dispatch('fleet', false);
  P.hook('fleet', rec(log, 'ops'));
  P.dispatch('fleet', true);
  assert.deepStrictEqual(log, ['ops:refresh:true']);
});

test('a page module that registers after its route is on screen paints at once', () => {
  const P = fresh(), log = [];
  P.dispatch('surf', false);
  assert.strictEqual(P.current().key, null);
  P.register('surf', rec(log, 'surf'));
  assert.deepStrictEqual(log, ['surf:show:surf']);
  P.register('shop', rec(log, 'shop'));
  assert.deepStrictEqual(log, ['surf:show:surf'], 'another route does not paint');
});

test('guests reach only pages registered with guest:true, hide included', () => {
  const P = fresh({ GUEST: true }), log = [];
  P.register('money', rec(log, 'money'));
  P.register('pad', rec(log, 'pad', { guest: true }));
  P.dispatch('money', false);
  P.dispatch('money', true);
  P.dispatch('pad', false);
  assert.deepStrictEqual(log, ['pad:show:pad']);
});

test('a page that throws does not stop its hooks or the next route', () => {
  const P = fresh(), log = [];
  P.register('a', { show() { throw new Error('boom') }, hide() { throw new Error('boom') } });
  P.hook('a', rec(log, 'h'));
  P.register('b', rec(log, 'b'));
  P.dispatch('a', false);
  P.dispatch('b', false);
  assert.deepStrictEqual(log, ['h:show:a', 'h:hide', 'b:show:b']);
});

test('ctx carries route, sub, params, containers, class, tv and guest', () => {
  const els = { 'pg-realestate': { querySelector: (s) => (s === '.phead' ? 'HEAD' : null) }, 'pg-realestate-residential': 'EL', 'pg-surf-main': 'SURF' };
  const document = { getElementById: (id) => els[id] || null, documentElement: { dataset: { dc: 'T' }, classList: { contains: (c) => c === 'tv' } }, hidden: false };
  const P = fresh({ document });
  const c = P.ctx(P.parse('realestate/residential?zip=92647'));
  assert.strictEqual(c.el, 'EL');
  assert.strictEqual(c.head, 'HEAD');
  assert.strictEqual(c.params.zip, '92647');
  assert.strictEqual(c.cls, 'T');
  assert.strictEqual(c.tv, true);
  assert.strictEqual(c.guest, false);
  assert.strictEqual(P.ctx(P.parse('surf')).el, 'SURF', 'a tab without subs uses its main container');
  const P2 = fresh({ document, DeckShell: { cls: () => 'D' } });
  assert.strictEqual(P2.ctx(P2.parse('surf')).cls, 'D', 'the shell class wins over the root attribute');
});

test('get: ok data with age; 403, missing feed, timeout and no answer resolve ok:false and never throw', async () => {
  const nowS = Math.floor(Date.now() / 1000);
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => (body === undefined ? Promise.reject(new Error('no json')) : Promise.resolve(body)) });
  const calls = [];
  const fetch = (url, o) => {
    calls.push([url, o.credentials]);
    if (url === '/api/ok') return reply(200, { t: nowS - 120, rows: [1] });
    if (url === '/api/iso') return reply(200, { generated_at: new Date((nowS - 60) * 1000).toISOString() });
    if (url === '/api/guest') return reply(403, undefined);
    if (url === '/api/missing') return reply(200, { error: 'file missing', stale: true, t: nowS });
    if (url === '/api/slow') return new Promise(() => {});
    return Promise.reject(new TypeError('network'));
  };
  const P = fresh({ fetch, AbortController });
  const ok = await P.get('ok');
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.status, 200); assert.deepStrictEqual([...ok.data.rows], [1]);
  assert.ok(ok.age >= 119 && ok.age <= 122, 'age in seconds from t');
  assert.ok((await P.get('/iso')).age >= 59, 'ISO generated_at reads too; a leading slash is dropped');
  assert.deepStrictEqual(calls[1], ['/api/iso', 'same-origin']);
  const g = await P.get('guest');
  assert.deepStrictEqual([g.ok, g.status, g.data, g.error], [false, 403, null, 'http 403']);
  const m = await P.get('missing');
  assert.deepStrictEqual([m.ok, m.status, m.error], [false, 200, 'file missing']);
  const s = await P.get('slow', { timeout: 20 });
  assert.deepStrictEqual([s.ok, s.status, s.error], [false, 0, 'timed out']);
  const n = await P.get('down');
  assert.deepStrictEqual([n.ok, n.status, n.error], [false, 0, 'no answer']);
});

// ---- page glue (PR B): freshness mark, device class, class change event, TV refresh ----
test('mark puts one freshness mark first in .pact and replaces it on the next paint', () => {
  const pact = { html: '<button class="btn btn-quiet data-btn">Data</button>', old: null,
    querySelector(s) { return s === '.fresh' ? this.old : null; },
    insertAdjacentHTML(where, h) { assert.equal(where, 'afterbegin'); this.html = h + this.html; const self = this; this.old = { set outerHTML(v) { self.html = self.html.replace(h, v); h = v; } }; } };
  const head = { querySelector: (s) => (s === '.pact' ? pact : null) };
  const DeckUI = { fresh: (o) => '<button class="fresh">' + o.age + '</button>' };
  const P = fresh({ DeckUI });
  assert.equal(P.mark({ head }, { age: 60 }), true);
  assert.equal(P.mark({ head }, { age: 120 }), true);
  assert.equal(pact.html, '<button class="fresh">120</button><button class="btn btn-quiet data-btn">Data</button>');
  assert.equal(P.mark({ head: null }, { age: 1 }), false, 'no header yet: nothing written');
});

test('device class: shell first, then html[data-dc], then the window size by the tokens.css rules', () => {
  const P = fresh();
  const cases = [[390, 844, false, 'P'], [599, 900, false, 'P'], [908, 411, false, 'L'], [932, 430, false, 'L'], [834, 1194, false, 'T'], [1099, 800, false, 'T'],
    [1100, 800, false, 'D'], [1440, 900, false, 'D'], [1599, 1000, false, 'D'], [1600, 900, false, 'XL'], [2560, 1440, false, 'XL'], [1920, 1080, true, 'TV'], [390, 844, true, 'TV']];
  for (const [w, h, tv, want] of cases) assert.equal(P.classOf(w, h, tv), want, w + 'x' + h + (tv ? ' tv' : ''));
  assert.equal(fresh({ innerWidth: 390, innerHeight: 844 }).cls(), 'P');
  const document = { documentElement: { dataset: { dc: 'T' }, classList: { contains: () => false } } };
  assert.equal(fresh({ document, innerWidth: 390, innerHeight: 844 }).cls(), 'T');
  assert.equal(fresh({ document, DeckShell: { cls: () => 'TV' } }).cls(), 'TV');
  assert.equal(fresh({ document, DeckShell: { cls: () => 'bogus' } }).cls(), 'T', 'an unknown shell value falls through');
});

test('onClass hears deck:class and returns off; tv() asks the shell to keep focus', () => {
  const L = {};
  const document = { addEventListener: (t, f) => { L[t] = f; }, removeEventListener: (t, f) => { if (L[t] === f) delete L[t]; } };
  let refreshed = 0;
  const P = fresh({ document, DeckShell: { tv: { refresh: () => refreshed++ } } });
  const seen = [];
  const off = P.onClass((d) => seen.push(d.cls + '<' + d.prev));
  L['deck:class']({ detail: { cls: 'L', prev: 'P' } });
  off();
  assert.equal(L['deck:class'], undefined);
  assert.deepEqual(seen, ['L<P']);
  assert.equal(P.tv(), true);
  assert.equal(refreshed, 1);
  assert.equal(fresh().tv(), false, 'no shell yet: nothing to do');
});

// ---- the old pages: one oldPage() line each, with its current function, gate and hide. A page lane deletes its line when it registers its
// new route, so these tests check the lines still present and never require a page to stay.
const tail = deck.slice(deck.indexOf(B));
const OLD = ['cluster', 'dev', 'life', 'launch', 'crons', 'schedules', 'agents', 'shop', 'commerce', 'housing', 'commercial', 'gigs', 'money', 'keys', 'home', 'markets', 'today'];
const oldLines = tail.split('\n').filter((l) => /^oldPage\(/.test(l));
const has = (route) => oldLines.some((l) => l.startsWith("oldPage('" + route + "',") || l.startsWith("oldPage(['" + route + "'"));

test('old pages: one well-formed line each, only known leaves, deckPage forwards to the registry, no central switch', () => {
  for (const l of oldLines) {
    assert.match(l, /^oldPage\((\['[a-z]+'(,'[a-z]+')*\]|'[a-z]+'),\(\)=>[^\n]+\);$/, l);
    const first = /^oldPage\(\[?'([a-z]+)'/.exec(l)[1];
    assert.ok(OLD.includes(first), 'only the old leaves live here: ' + first);
  }
  assert.equal(new Set(oldLines.map((l) => /^oldPage\(\[?'([a-z]+)'/.exec(l)[1])).size, oldLines.length, 'one line per page');
  assert.match(tail, /function deckPage\(name,tick\)\{return DeckPages\.dispatch\(name,tick\)\}/);
  assert.doesNotMatch(tail.slice(tail.indexOf('const pageAge=')), /name==='/, 'no central switch left');
  if (has('commerce')) assert.match(tail, /oldPage\('commerce',[^\n]*,\(\)=>cmHide\(\)\);/);
  if (has('money')) assert.match(tail, /oldPage\('money',[^\n]*,\(\)=>FINC\.hide\(\)\);/);
});

test('old pages behave as the old switch did: gates, show, hide on leave (for the lines still present)', () => {
  // run the old registrations against a fresh registry with recording stand-ins for the page functions
  let now = 10_000_000;
  const FakeDate = class extends Date { static now() { return now } };
  const log = [];
  const P = fresh({ Date: FakeDate });
  const lines = tail.split('\n').filter((l) => /^(const pageAge|function oldPage|oldPage\()/.test(l)).join('\n');
  const stand = {};
  for (const f of ['v6Cluster', 'v6Dev', 'v6Life', 'v6Launch', 'v8Crons', 'v10Schedules', 'v11Agents', 'v9Shop', 'v12Commerce', 'v13Housing', 'v14Commercial', 'v14Gigs', 'v9Money', 'v7Keys', 'v7Home', 'paintMarketHead', 'v7Today', 'cmHide'])
    stand[f] = () => log.push(f);
  const V6 = { t: {} };
  vm.runInNewContext(lines, Object.assign({ DeckPages: P, V6, Date: FakeDate, hBusy: () => false, FINC: { hide: () => log.push('FINC.hide') } }, stand), { timeout: 1000 });
  // every present page paints on show, stays quiet on a tick right after a load (Cluster excepted), and reloads once stale
  for (const r of OLD.filter(has)) {
    P.dispatch(r, false);
    assert.ok(log.length >= 1, r + ' paints on show');
    log.splice(0);
    for (const k of Object.keys(V6.t).concat([r, 'mhead'])) V6.t[k] = now;
    P.dispatch(r, true);
    if (r !== 'cluster') assert.deepStrictEqual(log.filter((x) => x !== 'FINC.hide' && x !== 'cmHide'), [], r + ' waits on its age gate');
    log.splice(0);
    now += 2 * 3600 * 1000;
    P.dispatch(r, true);
    assert.ok(log.length >= 1, r + ' reloads once stale');
    log.splice(0);
  }
  P.dispatch('pad', false); log.splice(0);
  if (has('dev')) {
    P.dispatch('dev', false); V6.t.dev = now; log.splice(0);
    now += 15000; P.dispatch('dev', true);
    now += 50000; P.dispatch('dev', true);
    assert.deepStrictEqual(log.splice(0), ['v6Dev'], 'Dev: a tick reloads only after 60 s');
  }
  if (has('money')) {
    P.dispatch('money', false); log.splice(0); P.dispatch('pad', false);
    assert.deepStrictEqual(log.splice(0), ['FINC.hide'], 'leaving Money drops revealed amounts');
  }
  if (has('commerce')) {
    P.dispatch('commerce', false); log.splice(0); P.dispatch('pad', false);
    assert.deepStrictEqual(log.splice(0), ['cmHide'], 'leaving Commerce drops order amounts');
  }
  if (has('home')) {
    P.dispatch('home', false); P.dispatch('home/house', false);
    assert.deepStrictEqual(log.splice(0), ['v7Home', 'v7Home'], 'House answers to the old leaf and the new route');
  }
  if (has('markets')) {
    P.dispatch('money/markets', false);
    assert.deepStrictEqual(log.splice(0), ['paintMarketHead'], 'old Markets paints under Money > Markets');
  }
  if (has('launch')) {
    P.dispatch('launch', false); V6.t.launch = now; log.splice(0); now += 60000; P.dispatch('launch', true);
    assert.deepStrictEqual(log.splice(0), [], 'Launch reloads on ticks only after an hour');
  }
});

test('invest.js and ops.js never wrap deckPage; while they hook an old route the hook keeps the old behaviour', () => {
  const inv = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
  const ops = fs.readFileSync(path.join(__dirname, '../static/ops.js'), 'utf8');
  if (/DeckPages\.hook\(\['markets'/.test(inv)) assert.match(inv, /DeckPages\.hook\(\['markets','invest'\],\{show\(\)\{ivHead\(\);investPage\(false\)\},refresh\(c,tick\)\{ivHead\(\);investPage\(tick\)\},hide\(\)\{ICTL\.hide\(\)\}\}\);/);
  if (/DeckPages\.hook\('fleet'/.test(ops)) assert.match(ops, /DeckPages\.hook\('fleet',\{show\(\)\{stallTick\(true\)\},refresh\(c,tick\)\{stallTick\(!tick\)\}\}\);/);
  for (const s of [inv, ops]) assert.doesNotMatch(s, /deckPage\s*=/);
});
