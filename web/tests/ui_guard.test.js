'use strict';
// The guard (PlanEng item 1, mechanism B; findings E1, E3 to E7, C4): DeckPages.get, call, mark and part in static/deck.js, and the
// client error reporter of static/app.js. A failed refresh keeps the last good rows and the mark says so; not reporting and a wrong
// shape are failures; amounts are never kept; a thrown page paints its failed state and reports once; no answer fires deck:net.
require('./setup-core.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const deck = read('deck.js'), app = read('app.js'), guard = read('guard.js'), html = read('index.html');
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const DeckUI = new Function(slice(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const REG = slice(deck, '// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const ClientErr = () => new Function(slice(guard, '// ==== CLIENT ERRORS BEGIN', '// ==== CLIENT ERRORS END ====') + '\nreturn ClientErr;')();

// ---- a small fake DOM: a node is its outer HTML; a box holds nodes in order ----
const classes = (h) => ((/class="([^"]*)"/.exec(h) || [])[1] || '').split(/\s+/);
function box(name) {
  const b = { nodes: [], name,
    get innerHTML() { return this.nodes.map((n) => n.html).join(''); },
    set innerHTML(v) { this.nodes = v ? [node(this, v)] : []; },
    get children() { return this.nodes.map((n) => ({ className: classes(n.html).join(' ') })); },
    querySelector(sel) { const m = /^\.([a-z-]+)(\[data-guard\])?$/.exec(sel); if (!m) return null;
      return this.nodes.find((n) => classes(n.html).includes(m[1]) && (!m[2] || / data-guard/.test(n.html))) || null; },
    insertAdjacentHTML(where, h) { assert.equal(where, 'afterbegin'); this.nodes.unshift(node(this, h)); },
  };
  return b;
}
function node(b, html) {
  const n = { html,
    set outerHTML(v) { n.html = v; },
    remove() { b.nodes = b.nodes.filter((x) => x !== n); },
    insertAdjacentHTML(where, h) { assert.equal(where, 'afterend'); b.nodes.splice(b.nodes.indexOf(n) + 1, 0, node(b, h)); },
  };
  return n;
}
// a page section #pg-<tab> with its header (.phead > .pact) and the sub's container #pg-<tab>-main
function dom() {
  const pact = box('pact'), el = box('el'), events = [], on = {};
  const head = { querySelector: (s) => (s === '.pact' ? pact : null) };
  const document = {
    hidden: false, documentElement: { classList: { contains: () => false } },
    getElementById: (id) => (/^pg-[a-z]+$/.test(id) ? { querySelector: (s) => (s === '.phead' ? head : null) } : /^pg-[a-z]+-main$/.test(id) ? el : null),
    addEventListener: (t, f) => { (on[t] = on[t] || []).push(f); },
    dispatchEvent: (e) => { events.push(e); (on[e.type] || []).forEach((f) => f(e)); return true; },
  };
  return { document, pact, el, events };
}
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
const reply = (status, body, cl, etag) => { const t = status === 304 ? '' : JSON.stringify(body);
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: { get: (h) => (h === 'content-length' && cl ? String(cl) : h === 'etag' && etag ? etag : null) }, text: () => Promise.resolve(t) }); };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// a fresh registry with a fake clock, a scripted fetch (one answer function per path) and a recording deckReport
function setup(answers) {
  const clock = { now: 1_800_000_000_000 };
  const FakeDate = class extends Date { static now() { return clock.now; } };
  const d = dom(), reports = [], calls = [], sent = [];
  const fetch = (url, opt) => { const p = url.replace(/^\/api\//, ''); const inm = opt && opt.headers ? opt.headers['If-None-Match'] || '' : ''; calls.push(p); sent.push([p, inm]); const f = answers[p]; return f ? f(inm) : Promise.reject(new TypeError('Failed to fetch')); };
  const P = vm.runInNewContext(REG + '\nDeckPages;', {
    DeckUI, console: { error() {} }, setTimeout, clearTimeout, Promise, Date: FakeDate, fetch, AbortController, CustomEvent,
    document: d.document, deckReport: (kind, err) => reports.push([kind, String(err && err.message || err)]),
  }, { timeout: 1000 });
  return { P, clock, reports, calls, sent, ...d };
}

test('get: a body that says status not_reporting is a failure and keeps its body (E1)', async () => {
  const { P } = setup({ realestate: () => reply(200, { status: 'not_reporting', reason: 'not written', rows: [] }) });
  const r = await P.get('realestate');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not reporting');
  assert.equal(r.data.reason, 'not written', 'pages still read the reason');
});

test('get: a wrong-shaped answer fails a shape check instead of reading as empty (E5)', async () => {
  const { P } = setup({ 'ecom-market': () => reply(200, { t: 1, watches: 5, movers: 'x' }) });
  const shape = (d) => d && Array.isArray(d.movers);
  const r = await P.get('ecom-market', { shape });
  assert.deepEqual([r.ok, r.error], [false, 'wrong shape']);
  const thrown = await P.get('ecom-market', { shape: () => { throw new Error('x'); } });
  assert.equal(thrown.ok, false, 'a shape check that throws is a wrong shape');
  assert.equal((await P.get('ecom-market')).ok, true, 'no shape given: the answer stands');
  const { P: Q } = setup({ arr: () => reply(200, [1, 'x', null]), txt: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('Internal') }) });
  assert.deepEqual([(await Q.get('arr')).ok, (await Q.get('arr')).error], [false, 'wrong shape'], 'a body that is not an object fails by default');
  assert.equal((await Q.get('txt')).ok, false, 'a 200 that is not JSON fails');
});

test('get: a failed refresh returns the last good answer marked stale; a first failure and fresh:true stay failures (E3, E4)', async () => {
  let mode = 'ok';
  const { P, clock } = setup({ surf: () => (mode === 'ok' ? reply(200, { t: 1_800_000_000 - 300, spots: [{ id: 'a' }] }) : mode === '500' ? reply(500, null) : Promise.reject(new TypeError('x'))) });
  mode = 'down';
  assert.equal((await P.get('surf')).ok, false, 'nothing kept yet: a failure');
  mode = 'ok';
  const good = await P.get('surf');
  assert.equal(good.ok, true); assert.equal(good.stale, undefined);
  for (const m of ['down', '500']) {
    mode = m; clock.now += 29 * 60000;
    const r = await P.get('surf');
    assert.deepEqual([r.ok, r.stale, r.data.spots[0].id], [true, true, 'a'], m + ': the rows stay');
    assert.equal(r.at, 1_800_000_000_000, 'at is when the good answer was read');
    assert.ok(r.error, 'the failure is still named');
    assert.ok(r.age >= 300, 'age is the kept data\'s own age');
    assert.equal((await P.get('surf', { fresh: true })).ok, false, m + ': fresh:true never takes old data');
  }
});

test('get: amounts and the budget are never kept (finance, finance-values, portfolio-values, housing/profile)', async () => {
  let up = true;
  const paths = ['commerce', 'finance', 'finance-values', 'portfolio-values', 'housing/profile', 'finance-values?x=1'];
  const answers = {};
  paths.forEach((p) => { answers[p] = () => (up ? reply(200, { t: 1, v: 1 }) : reply(500, null)); });
  answers.markets = answers.finance;
  const { P } = setup(answers);
  for (const p of paths.concat('markets')) assert.equal((await P.get(p)).ok, true);
  up = false;
  for (const p of paths) assert.deepEqual([(await P.get(p)).ok, (await P.get(p)).stale], [false, undefined], p + ' is never handed back');
  assert.equal((await P.get('markets')).stale, true, 'an ordinary feed is kept');
});

test('get: a 401, a 403 or a deck:role event drops every kept answer', async () => {
  for (const drop of [401, 403, 'role']) {
    let st = 200;
    const { P, document } = setup({ surf: () => reply(st, { t: 1 }), today: () => reply(st, { t: 1 }) });
    await P.get('surf'); await P.get('today');
    st = 500;
    assert.equal((await P.get('surf')).stale, true, drop + ': kept before');
    if (drop === 'role') document.dispatchEvent(new CustomEvent('deck:role', { detail: {} }));
    else { st = drop; assert.equal((await P.get('surf')).ok, false, drop + ': not handed back'); }
    st = 500;
    assert.equal((await P.get('today')).ok, false, drop + ': nothing survives it');
    assert.equal((await P.get('surf')).ok, false);
  }
});

test('get: a read whose query carries an amount (budget, max_price, price caps) is never kept, so no figure sits in a key', async () => {
  let up = true;
  const paths = ['housing/rank?kind=housing&max_price=750000&sort=score', 'cre/deals?type=retail&max_price=2000000', 'x?budget=500000', 'x?a=1&price_max=9', 'x?MIN_PRICE=1'];
  const answers = {};
  paths.concat('housing/rank?kind=housing&sort=score').forEach((p) => { answers[p] = () => (up ? reply(200, { t: 1, rows: [1] }) : reply(500, null)); });
  const { P } = setup(answers);
  for (const p of paths.concat('housing/rank?kind=housing&sort=score')) assert.equal((await P.get(p)).ok, true);
  up = false;
  for (const p of paths) assert.deepEqual([(await P.get(p)).ok, (await P.get(p)).stale], [false, undefined], p);
  assert.equal((await P.get('housing/rank?kind=housing&sort=score')).stale, true, 'the same read without an amount is kept');
});

test('get: a 403 on one path forgets every kept answer, on purpose (a refused read is how a role change first shows)', async () => {
  let up = true;
  const { P } = setup({ surf: () => (up ? reply(200, { t: 1 }) : reply(500, null)), today: () => (up ? reply(200, { t: 1 }) : reply(500, null)), 'pad/keys': () => reply(403, { error: 'forbidden' }) });
  await P.get('surf'); await P.get('today');
  up = false;
  assert.equal((await P.get('surf')).stale, true, 'kept before');
  assert.equal((await P.get('pad/keys')).ok, false);
  assert.deepEqual([(await P.get('surf')).ok, (await P.get('today')).ok], [false, false], 'paths that were never refused are dropped too');
});

test('get: a kept answer revalidates with If-None-Match; a 304 hands back the same object as current, read time now', async () => {
  let tag = 'W/"pd-1"';
  const body = { t: 1, rows: [1] };
  const { P, sent, clock, pact } = setup({ surf: (inm) => (inm && inm === tag ? reply(304, null, 0, tag) : reply(200, body, 0, tag)) });
  P.register('surf', { show: async (c) => { const r = await P.get('surf'); P.mark(c, { age: 60, refresh: 1800 }); return r; } });
  const first = await P.get('surf');
  assert.equal(sent[0][1], '', 'nothing kept yet: no header');
  clock.now += 29 * 60000;
  const again = await P.get('surf');
  assert.equal(sent[1][1], 'W/"pd-1"', 'the kept tag rides along');
  assert.deepEqual([again.ok, again.same, again.status, again.stale], [true, true, 304, undefined]);
  assert.equal(again.data, first.data, 'the very object kept, no new parse');
  tag = 'W/"pd-2"';
  const changed = await P.get('surf');
  assert.deepEqual([changed.ok, changed.same, changed.status], [true, undefined, 200], 'a changed feed answers 200 with the new body');
  assert.equal(sent[2][1], 'W/"pd-1"');
  assert.equal((await P.get('surf')).same, true, 'the new tag is kept');
  assert.equal(sent[3][1], 'W/"pd-2"');
  P.dispatch('surf', false); await settle();
  assert.doesNotMatch(pact.innerHTML, /Out of date/, 'a 304 is current: no stale mark');
});

test('get: never revalidates a NEVER or amount read, and a 304 with nothing kept reads again without the header', async () => {
  const { P, sent, document } = setup({
    'finance-values': () => reply(200, { t: 1 }, 0, 'W/"x"'), 'housing/rank?max_price=9': () => reply(200, { t: 1 }, 0, 'W/"y"'),
    feed: (inm) => (inm ? reply(304, null, 0, 'W/"z"') : reply(200, { t: 1, n: 2 }, 0, 'W/"z"')),
  });
  for (const p of ['finance-values', 'housing/rank?max_price=9']) { await P.get(p); await P.get(p); }
  assert.ok(sent.slice(0, 4).every(([, inm]) => inm === ''), 'no tag ever sent for them');
  await P.get('feed');
  document.dispatchEvent(new CustomEvent('deck:role', { detail: {} }));
  const r = await P.get('feed');
  assert.deepEqual(sent.slice(4).map((x) => x[1]), ['', ''], 'the first read and the read after the drop carry no header');
  assert.equal(r.ok, true);
  // a 304 that comes back although nothing is kept (the server named a tag the page no longer holds): one more read, no header
  const { P: Q, sent: s2 } = setup({ x: (inm) => (s2.length === 1 ? reply(304, null) : reply(200, { t: 1, n: 3 }, 0, 'W/"q"')) });
  const q = await Q.get('x');
  assert.deepEqual([q.ok, q.status, q.data.n, s2.map((v) => v[1]).join('|')], [true, 200, 3, '|']);
  // and a 304 to that read too is no answer, never "not modified"
  const { P: R, sent: s3 } = setup({ y: () => reply(304, null) });
  const y = await R.get('y');
  assert.deepEqual([y.ok, y.error, s3.length], [false, 'no answer', 2]);
});

test('get: last good is bounded at 4 MB of JSON, oldest out first; an answer heavier than that is never kept', async () => {
  let up = true;
  const pad = (n) => ({ t: 1, pad: 'x'.repeat(n) });
  const answers = {};
  for (const [p, n, cl] of [['metros', 5e6], ['a', 1.5e6], ['b', 1.5e6], ['c', 1.5e6], ['small', 10, 3.9e6]]) answers[p] = () => (up ? reply(200, pad(n), cl) : reply(500, null));
  const { P } = setup(answers);
  for (const p of ['metros', 'a', 'b']) await P.get(p);
  up = false;
  assert.equal((await P.get('metros')).ok, false, 'over the whole budget: never kept');
  assert.deepEqual([(await P.get('a')).stale, (await P.get('b')).stale], [true, true], '3 MB fits');
  up = true; await P.get('c'); up = false;
  assert.equal((await P.get('a')).ok, false, 'a fourth 1.5 MB answer pushes the oldest out');
  assert.deepEqual([(await P.get('b')).stale, (await P.get('c')).stale], [true, true]);
  up = true; await P.get('small'); up = false;
  assert.equal((await P.get('small')).stale, true, 'a 3.9 MB Content-Length counts when it is the larger');
  assert.deepEqual([(await P.get('b')).ok, (await P.get('c')).ok], [false, false], 'and pushes both 1.5 MB answers out');
});

test('mark: after a failed refresh the one mark says "Out of date · last read 29 min" with one Try again; a good read clears it', async () => {
  let up = true;
  const { P, pact, clock } = setup({ surf: () => (up ? reply(200, { t: Math.round(clock.now / 1000) - 60, spots: [1] }) : Promise.reject(new TypeError('x'))) });
  const rows = [];
  P.register('surf', { show: async (c) => { const r = await P.get('surf'); rows.push(r.data && r.data.spots.length); P.mark(c, { age: r.age, refresh: 1800, missing: 0 }); }, refresh(c) { return this.show(c); } });
  P.dispatch('surf', false); await settle();
  assert.match(pact.innerHTML, /class="fresh"[^>]*>1 min</);
  up = false; clock.now += 29 * 60000;
  P.dispatch('surf', true); await settle();
  assert.deepEqual(rows, [1, 1], 'the rows came back both times');
  assert.match(pact.innerHTML, /class="fresh warn"[^>]*><span class="sd warn"><\/span><span class="fw">Out of date · last read 29 min<\/span>/);
  assert.equal((pact.innerHTML.match(/Try again/g) || []).length, 1, 'one Try again');
  assert.match(pact.innerHTML, /data-retry="surf"/);
  P.dispatch('surf', true); await settle();
  assert.equal((pact.innerHTML.match(/Try again/g) || []).length, 1, 'still one after another failed tick');
  up = true;
  P.dispatch('surf', true); await settle();
  assert.doesNotMatch(pact.innerHTML, /Out of date|Try again/, 'a good read clears the stale mark and its button');
});

test('mark: a page that already says Not reporting keeps it', async () => {
  let up = true;
  const { P, pact } = setup({ a: () => (up ? reply(200, { t: 1 }) : reply(500, null)) });
  P.register('surf', { show: async (c) => { await P.get('a'); P.mark(c, { age: null }); } });
  P.dispatch('surf', false); await settle();
  up = false; P.dispatch('surf', false); await settle();
  assert.match(pact.innerHTML, /Not reporting/);
  P.mark(P.ctx(P.parse('surf')), { age: 60 });
  assert.match(pact.innerHTML, /last read/, 'with an age the stale mark shows');
  P.mark(P.ctx(P.parse('surf')), { age: null });
  assert.match(pact.innerHTML, /Not reporting/);
  assert.doesNotMatch(pact.innerHTML, /last read/);
});

test('get: no answer fires one deck:net {up:false}; the next answer one {up:true}; an HTTP error is an answer (E6)', async () => {
  let up = false;
  const { P, events } = setup({ surf: () => (up ? reply(200, { t: 1 }) : Promise.reject(new TypeError('x'))), bad: () => reply(500, null) });
  const net = () => events.filter((e) => e.type === 'deck:net').map((e) => e.detail.up);
  await P.get('surf');
  assert.deepEqual(net(), [false]);
  up = true;
  await P.get('surf'); await P.get('surf'); await P.get('bad');
  assert.deepEqual(net(), [false, true], 'one up when the deck answers again, then quiet');
  assert.match(app, /addEventListener\('deck:net',e=>netState\(/, 'the shell feeds it to netState');
});

test('call: a thrown show paints the failed state in a blank page and reports once (C4)', async () => {
  const { P, el, reports } = setup({});
  P.register('surf', { show() { throw new Error('boom'); } });
  P.dispatch('surf', false);
  assert.match(el.innerHTML, /class="es es-bad"/);
  assert.match(el.innerHTML, /Could not show this page/);
  assert.deepEqual(reports, [['render', 'boom']]);
});

test('call: a rejected refresh keeps a good render under a stale bar and reports once', async () => {
  const { P, el, reports, clock } = setup({});
  let fail = false;
  P.register('surf', { show: async (c) => { if (fail) throw new Error('late boom'); c.el.innerHTML = '<div class="spots">rows</div>'; }, refresh(c) { return this.show(c); } });
  P.dispatch('surf', false); await settle();
  fail = true; clock.now += 5 * 60000;
  P.dispatch('surf', true); await settle();
  P.dispatch('surf', true); await settle();
  assert.match(el.innerHTML, /rows/, 'the rows stay');
  assert.equal((el.innerHTML.match(/class="stale-bar"/g) || []).length, 1, 'one bar, not one per tick');
  assert.match(el.innerHTML, /Out of date · last read 5 min.*Try again/);
  assert.equal(reports.length, 2, 'each throw reaches deckReport, which dedupes');
});

test('part: ok draws, stale draws under the bar, failed shows the failed state, a throwing draw shows the failed box and reports', () => {
  const { P, reports, clock } = setup({});
  const draw = (d) => '<ul>' + d.rows.map((x) => '<li>' + x + '</li>').join('') + '</ul>';
  assert.equal(P.part({ key: 'shop', title: 'Watches', res: { ok: true, data: { rows: [1] } }, draw }), '<ul><li>1</li></ul>');
  const st = P.part({ key: 'shop', title: 'Watches', res: { ok: true, stale: true, at: clock.now - 29 * 60000, data: { rows: [1] } }, draw });
  assert.match(st, /^<div class="stale-bar" role="status">.*Out of date · last read 29 min.*data-retry="shop">Try again<\/button><\/div><ul>/);
  assert.match(P.part({ key: 'shop', title: 'Watches', res: { ok: false, error: 'http 500' }, draw }), /es es-bad/);
  assert.match(P.part({ key: 'shop', title: 'Watches', res: null, draw }), /es es-bad/);
  assert.equal(P.part({ title: 'W', res: { ok: false }, draw, empty: (s) => '<p>' + s.k + '</p>' }), '<p>bad</p>', 'a page may give its own state');
  assert.match(P.part({ title: 'W', res: { ok: true, data: {} }, draw: () => '' }), /es es-idle/, 'nothing drawn: the empty state');
  const t = P.part({ key: 'shop', title: 'Watches', res: { ok: true, data: {} }, draw });
  assert.match(t, /es es-bad.*Could not show Watches/);
  assert.equal(reports.length, 1);
  assert.doesNotMatch(st + t, /undefined|NaN/);
});

test('report: whitelisted fields, query strings dropped, one per distinct error, at most 10 a load, a failed post is silent', async () => {
  const C = ClientErr(), posts = [];
  const post = (b) => { posts.push(JSON.parse(b)); return Promise.reject(new Error('404')); };
  const err = new Error('x is not a function at https://deck/api/a?token=SECRET');
  err.stack = 'TypeError: x\n    at paint (https://deck.example/pages/shop.js?v=2:120:7)\n    at y (https://deck.example/deck.js:9:1)';
  assert.equal(C.report('render', Object.assign({ route: 'shop/market?zip=92629', secret: 'no' }, C.info(err)), post), true);
  assert.deepEqual(posts[0], { e: 'render', route: 'shop/market', src: 'shop.js', line: 120, col: 7, msg: 'x is not a function at https://deck/api/a' });
  assert.equal(C.report('render', C.info(err), post), false, 'the same error once');
  assert.equal(C.report('nope', { msg: 'x' }, post), false, 'unknown kind');
  assert.deepEqual(C.frame('f@https://h/static/app.js:3:44'), { src: 'app.js', line: 3, col: 44 }, 'WebKit frames');
  for (let i = 0; i < 20; i++) C.report('error', { msg: 'e' + i, src: 'https://h/deck.js', line: i }, post);
  assert.equal(posts.length, C.MAX, 'at most 10 a load');
  assert.ok(posts.every((p) => Object.keys(p).join() === 'e,route,src,line,col,msg'));
  assert.equal(C.report('csp', { msg: 'z' }, () => { throw new Error('sync'); }), false, 'over the budget');
  const D = ClientErr();
  assert.equal(D.report('csp', { msg: 'z'.repeat(400) }, () => { throw new Error('sync'); }), true, 'a post that throws is swallowed');
  await settle();
});

test('guard.js listens for error, unhandledrejection and securitypolicyviolation, posts to /api/client-error, and loads before the shell', () => {
  for (const t of ['error', 'unhandledrejection', 'securitypolicyviolation']) assert.match(guard, new RegExp("addEventListener\\('" + t + "',ev=>"));
  assert.match(guard, /fetch\('\/api\/client-error',\{method:'POST',keepalive:true/);
  assert.doesNotMatch(app, /CLIENT ERRORS BEGIN|function deckReport/, 'one copy, in guard.js');
  assert.match(html, /<script src="\/ui-core\.js"><\/script><script src="\/guard\.js"><\/script><script src="\/app\.js">/, 'after ui-core.js, before every other script');
  assert.match(read('sw.js'), /'\/guard\.js'/, 'cached with the shell');
  const main = fs.readFileSync(path.join(__dirname, '../rust/src/main.rs'), 'utf8');
  assert.match(main, /"\/guard\.js" => Some\(\(GUARD_JS, "text\/javascript"\)\)/, 'served by the deck');
});

test('guard.js: on the desk page a report posts only after whoami says owner; a viewer posts nothing; the deck posts at once', async () => {
  const src = read('guard.js');
  const run = (crePage, role) => {
    const posts = [], who = [], listeners = {};
    const ctx = { console, Promise, JSON, Object, String, Number, Set, Math, URL,
      document: { getElementById: (id) => (crePage && id === 'cre-root' ? {} : null) },
      addEventListener: (t, f) => { listeners[t] = f; },
      fetch: (u, o) => { if (u === '/api/whoami') { who.push(u); return Promise.resolve({ json: () => Promise.resolve({ role }) }); } posts.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); } };
    vm.runInNewContext(src + '\nthis.deckReport=deckReport;', ctx);
    return { ctx, posts, who, listeners };
  };
  for (const [cre, role, want, asks] of [[true, 'viewer', 0, 1], [true, 'owner', 2, 1], [false, 'viewer', 2, 0]]) {
    const t = run(cre, role);
    t.ctx.deckReport('render', new Error('a'));
    t.listeners.error({ message: 'b', filename: 'https://h/cre.js', lineno: 3, colno: 4 });
    await settle();
    assert.equal(t.posts.length, want, (cre ? 'desk ' : 'deck ') + role);
    assert.equal(t.who.length, asks, 'whoami asked at most once, and only on the desk page');
  }
});

test('the never-kept routes are the server\'s amount routes, read from rust/src/main.rs, so the two lists cannot drift', () => {
  const main = fs.readFileSync(path.join(__dirname, '../rust/src/main.rs'), 'utf8');
  // the server: every async fn that passes amount_gate, then each `if a == "x" ... { return that_fn(` dispatch line names its routes
  const gated = main.split('\nasync fn ').slice(1).filter((f) => f.split('\n}\n')[0].includes('amount_gate(app')).map((f) => f.split('(')[0]);
  assert.ok(gated.length >= 3, 'amount_gate callers found: ' + gated);
  const server = new Set();
  for (const fn of gated) {
    const re = new RegExp('if ((?:a == "[^"]+"(?: \\|\\| )?)+) \\{\\n\\s*return ' + fn + '\\(', 'g');
    let m, hit = 0;
    while ((m = re.exec(main))) { hit++; for (const x of m[1].matchAll(/a == "([^"]+)"/g)) server.add(x[1]); }
    assert.ok(hit, fn + ' is dispatched from a route');
  }
  // the household profile answers through amount_json inside the housing/ routes
  assert.match(main, /a\.strip_prefix\("housing\/"\)/);
  const prof = main.split('if rest == "profile" {')[1] || '';
  assert.ok(prof.split('\n    }\n')[0].includes('amount_json('), 'housing/profile carries the amount marker');
  server.add('housing/profile');
  // the client: NEVER in the registry
  const never = /NEVER=\/\^\(([^)]+)\)/.exec(deck);
  assert.ok(never, 'NEVER found');
  const client = new Set(never[1].split('|').map((x) => x.replace(/\\\//g, '/')));
  assert.deepEqual([...client].sort(), [...server].sort());
  assert.ok(client.has('commerce'), 'Orders\' amounts are never kept');
});

test('Orders, never kept: a failed refresh shows "Orders are not reporting." with Try again, and the mark says Not reporting', () => {
  const S = new Function('DeckUI', read('pages/shop.js') + '\nreturn DeckShop;')(DeckUI);
  const st = { c: { error: 'no answer' }, now: Date.now(), host: 'pc-desktop', rev: false, armed: '' };
  const h = S.ordersBody(st);
  assert.match(h, /class="es es-bad"[\s\S]*Orders are not reporting\.[\s\S]*data-retry="shop"/);
  assert.equal(S.ordersFresh(st).age, null);
});
