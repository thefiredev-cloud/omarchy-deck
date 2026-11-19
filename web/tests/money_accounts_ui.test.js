// node --test tests/*.test.js  (Money > Accounts, deck v3: finance.json renders as money, not capture status; no DOM, no network, fake timers)
// Finance rules under test (PRODUCT.md): hidden by default, Show amounts reveals, 30 s auto-hide, nothing in a URL or storage,
// the service worker never caches either route, and no amount sits in the DOM until the owner taps.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const helpers = src.slice(a, b), glue = src.slice(b);
const swSrc = fs.readFileSync(path.join(__dirname, '../static/sw.js'), 'utf8');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/finance.sample.json'), 'utf8'));
const NOW = (raw.t + 300) * 1000;
const count = (s, re) => (s.match(re) || []).length;
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// What GET /api/finance serves (rust/src/finance.rs): no values, no totals, enums and ages only.
function served(o) {
  return Object.assign({
    src: '~/.meshvault/status/deck/finance.json', sources: raw.src, errors: raw.errors, refresh: raw.refresh, t: raw.t, age: 300, stale: false, sample: raw.sample === true,
    inventory: JSON.parse(JSON.stringify(raw.inventory)), explain: { never: 'To capture one, unlock the iPhone and tell Jev which app.' },
    apps: raw.apps.map((x) => ({ id: x.id, name: x.name, kind: x.kind, route: x.route, status: x.status, last_ok: x.last_ok, reason: x.reason, has_values: x.values != null })),
    has_totals: raw.totals != null,
  }, o || {});
}
// What GET /api/finance-values serves.
function valuesBody() {
  const apps = {};
  for (const x of raw.apps) if (x.values) apps[x.id] = x.values;
  return { t: raw.t, stale: false, apps, totals: raw.totals };
}
// every amount in the sample, in the forms the deck prints
const AMOUNTS = [];
for (const x of raw.apps) if (x.values) { if (typeof x.values.balance_usd === 'number') AMOUNTS.push(x.values.balance_usd); for (const i of x.values.items) if (typeof i.usd === 'number') AMOUNTS.push(i.usd); }
AMOUNTS.push(raw.totals.net_usd, ...Object.values(raw.totals.by_kind));
// the long form rows print ($17,000.00), the short form strip figures print ($17K) and the bare digits
const leaks = (h) => AMOUNTS.filter((n) => h.includes(D.money(n)) || h.includes(DeckCore.fmt.money(n)) || (n >= 1000 && (h.includes(String(n)) || h.includes(n.toLocaleString('en-US')))));

function rig(ms) {
  let now = NOW, id = 1, changes = 0;
  const timers = new Map(), calls = [], pending = [];
  const env = { now: () => now, setT: (fn, d) => { const i = id++; timers.set(i, { fn, at: now + d }); return i; }, clearT: (i) => timers.delete(i), onChange: () => { changes++; },
    get: (p) => { calls.push(p); return new Promise((res) => pending.push(res)); } };
  const ctl = D.finCtl(env, ms);
  const advance = (d) => { const end = now + d; for (;;) { let first = null; for (const [i, t] of timers) if (t.at <= end && (!first || t.at < first[1].at)) first = [i, t];
    if (!first) break; now = Math.max(now, first[1].at); timers.delete(first[0]); first[1].fn(); } now = end; };
  const answer = async (body) => { pending.shift()(body); await new Promise((r) => setImmediate(r)); };
  return { ctl, advance, answer, calls, pending, timers, changes: () => changes };
}
const page = (f, rev) => D.finPage(f, NOW, rev == null ? null : rev);

test('fixture: sample feed with every kind and status, round fake numbers only', () => {
  assert.equal(raw.sample, true);
  assert.equal(raw.apps.length, 16);
  for (const s of ['never', 'ok', 'stale', 'needs_owner', 'needs_unlock', 'blocked']) assert.ok(raw.apps.some((x) => x.status === s), s);
  assert.ok(AMOUNTS.every((n) => n % 100 === 0), 'round numbers only');
});

test('masked amounts never leak a digit: not from the sanitised feed, not from a feed that still carries values and totals', () => {
  assert.deepEqual(leaks(page(served())), []);
  const dirty = Object.assign(served(), { apps: raw.apps.map((x) => Object.assign({}, x, { has_values: x.values != null })), totals: raw.totals });
  const h = page(dirty);
  assert.deepEqual(leaks(h), []);
  assert.doesNotMatch(h, /balance_usd|net_usd|by_kind|\d{3},\d{3}/);
  const kindsListed = new Set(raw.apps.filter((x) => x.status !== 'never' || x.values != null).map((x) => x.kind)).size;
  // the Total, Assets and Owed (L16), one tile per kind with a listed app (W4-6), and every app row with values: each masked
  assert.equal(count(h, /\$\u2022\u2022\u2022/g), 3 + kindsListed + raw.apps.filter((x) => x.values != null && x.status !== 'never').length + raw.apps.filter((x) => x.values != null && x.status === 'never').length);
  assert.equal(count(h, /data-fin="show"/g), 1, 'one Show amounts button for the page');
  assert.doesNotMatch(h, /data-fin="hide"|Reveal/);
});

test('the page is about money: a sample banner, the Total, rows by kind; no inventory, tallies, ages or explanations', () => {
  const h = page(served());
  assert.match(h, /<div class="stale-bar"><span class="sd warn"><\/span>Sample data\. Made-up numbers, not real money\.<\/div>/);
  // the Total is the page's first data, masked, with Assets and Owed beside it on every size (L16) and a tile per kind (Bank, Brokerage,
  // Tax ...) from a laptop up (dx), so on a wide window it never stands alone in a full-width panel (W4-6)
  assert.match(h, /^<div class="stale-bar">[^]*?<\/div><div class="board"><section class="sect span-all fin-tot" aria-label="Total"><div class="strip" data-n="(\d+)" data-nb="3"[^>]*><div class="tile"><span class="h">Total, net across your apps<\/span><b class="v">\$\u2022\u2022\u2022<\/b><\/div><div class="tile"><span class="h">Assets<\/span><b class="v">\$\u2022\u2022\u2022<\/b><\/div><div class="tile"><span class="h">Owed<\/span><b class="v">\$\u2022\u2022\u2022<\/b><\/div><div class="tile dx"><span class="h">Bank<\/span><b class="v">\$\u2022\u2022\u2022<\/b>/);
  const kinds = [...h.matchAll(/<h2 class="secttl"><span>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.equal(kinds[0], 'Bank');
  assert.equal(kinds[kinds.length - 1], 'Not captured yet');
  assert.match(h, /<div class="flow board-fill">/);
  // each row says how old its data is in words (L17, "Read 3 min ago"); nothing else about capture reaches the page
  assert.doesNotMatch(vis(h), /On the iPhone|Look financial|Last checked|apps have amounts|\d+ ok|Updated|iPhone screen|API|tell Jeff|tell Jev/);
  assert.doesNotMatch(h, /tnote|mgrid|class="fa[ "]/);
});

test('a row shows a status only when its capture is out of date or blocked', () => {
  const h = page(served());
  const row = (id) => (h.match(new RegExp('<button type="button" class="frow" data-open="app" data-app="' + id + '">[^]*?</button>')) || [''])[0];
  for (const x of raw.apps.filter((y) => y.status === 'ok')) assert.doesNotMatch(row(x.id), /pill/, x.id);
  const words = new Set([...h.matchAll(/<span class="pill[^"]*"><span class="sd [a-z]+"><\/span>([A-Za-z ]+)<\/span>/g)].map((m) => m[1]));
  assert.deepEqual([...words].sort(), ['Blocked', 'Needs unlock', 'Needs you', 'Out of date']);
  // the writer knows each app's cadence: an "ok" end-of-day read hours old stays ok; one older than two days is out of date
  const f = served(); const ok = f.apps.find((x) => x.status === 'ok');
  ok.last_ok = raw.t - 6 * 3600;
  assert.doesNotMatch(page(f).match(new RegExp('data-app="' + ok.id + '">[^]*?</button>'))[0], /pill/);
  ok.last_ok = raw.t - 3 * 86400;
  assert.match(page(f), new RegExp('data-app="' + ok.id + '"><span class="fl"><b>[^<]+</b><small><span class="pill warn"><span class="sd warn"></span>Out of date'));
  // with the writer's per-app cadence the rule is twice that cadence: a 3 h source read 7 h ago is out of date, read 5 h ago is not
  ok.cadence_s = 10800; ok.last_ok = raw.t - 7 * 3600;
  assert.match(page(f), new RegExp('data-app="' + ok.id + '"><span class="fl"><b>[^<]+</b><small><span class="pill warn">'));
  ok.last_ok = raw.t - 5 * 3600;
  assert.doesNotMatch(page(f).match(new RegExp('data-app="' + ok.id + '">[^]*?</button>'))[0], /pill/);
});

test('an app name prints without the writer\'s source hint or path; the Data sheet keeps the whole label, home folder as ~', () => {
  const f = served({ apps: [{ id: 'tax', name: 'Tax 2026 (sheets in /home/alice/Documents/tax-2026)', kind: 'tax', route: 'api', status: 'ok', last_ok: raw.t, has_values: true },
    { id: 'sf', name: 'Bank cash (SimpleFIN)', kind: 'bank', route: 'api', status: 'ok', last_ok: raw.t, has_values: true }] });
  const h = page(f);
  assert.match(h, /<b>Tax 2026<\/b>/);
  assert.match(h, /<b>Bank cash<\/b>/);
  assert.doesNotMatch(h, /SimpleFIN|sheets in|Documents|alice/);
  const names = D.finData(f, NOW).sources.map((s) => s.name);
  assert.ok(names.includes('Bank cash (SimpleFIN)'));
  assert.ok(names.includes('Tax 2026 (sheets in ~/Documents/tax-2026)'), names.join(' | '));
});

test('Show amounts: every app and the total from the values view, with kind subtotals and a countdown; gone at 30 s', async () => {
  const r = rig();
  r.ctl.reveal();
  assert.equal(r.ctl.view().busy, true);
  assert.match(page(served(), r.ctl.view()), /data-fin="show" disabled>Loading/);
  await r.answer(valuesBody());
  const h = page(served(), r.ctl.view());
  // the strip prints the deck's short money form, so a figure never runs out of its tile; the rows keep the cents
  assert.match(h, new RegExp('<span class="h">Total, net across your apps</span><b class="v">' + DeckCore.fmt.money(raw.totals.net_usd).replace(/[$.]/g, '\\$&') + '</b>'));
  assert.match(h, /<span class="act">\$/, 'kind subtotals in the group headings');
  assert.match(h, /Hides in 30 s/);
  assert.match(h, /data-fin="hide"/);
  assert.ok(leaks(h).length > 3);
  r.advance(29900);
  assert.ok(r.ctl.view().apps, 'still held at 29.9 s');
  r.advance(100);
  assert.equal(r.ctl.view().apps, null);
  assert.deepEqual(leaks(page(served(), r.ctl.view())), []);
  assert.equal(r.timers.size, 0);
});

test('Hide, a second tap while pending, a failure and an answer that lands after Hide never show an amount', async () => {
  const r = rig();
  r.ctl.reveal(); r.ctl.reveal();
  assert.equal(r.calls.length, 1, 'a second tap while pending sends nothing');
  r.ctl.hide();
  await r.answer(valuesBody());
  assert.equal(r.ctl.view().apps, null, 'the late answer is dropped unread');
  r.ctl.reveal(); await r.answer({ error: 'http 403' });
  const bad = page(served(), r.ctl.view());
  assert.match(vis(bad), /Could not load the amounts\. Try again\./);
  assert.deepEqual(leaks(bad), []);
  r.ctl.reveal(); await r.answer(valuesBody());
  r.ctl.hide();
  assert.deepEqual(leaks(page(served(), r.ctl.view())), []);
  assert.equal(r.timers.size, 0);
  assert.equal(D.fcdText(1030000, 1000000), 'Hides in 30 s');
  assert.equal(D.FIN_HIDE_MS, 30000);
});

test('hostile values: a "__proto__" app key cannot pollute prototypes; feed text is escaped; unknown enums fall back', async () => {
  const r = rig();
  r.ctl.reveal();
  await r.answer({ apps: JSON.parse('{"__proto__":{"balance_usd":1},"chase":{"balance_usd":"<b>9</b>","items":[{"label":"<img src=x>","usd":"x"}]}}') });
  assert.equal(Object.prototype.balance_usd, undefined);
  const f = served({ apps: [{ id: 'chase', name: '<script>x</script>', kind: 'evil', route: 'evil', status: 'evil', has_values: true }] });
  const h = page(f, r.ctl.view());
  assert.doesNotMatch(h, /<script>|<img|<b>9/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /<span>Other<\/span>/);
  assert.match(h, /No balance/);
});

test('a tap on a Money row never opens the legacy detail sheet, so a revealed amount cannot outlive the 30 s hide', () => {
  const chain = [{ tag: 'B', cls: '' }, { tag: 'SPAN', cls: 'fl' }, { tag: 'DIV', cls: 'frow' }, { tag: 'DIV', cls: 'flist' }];
  for (const p of ['money', 'accounts', 'markets', 'invest']) assert.equal(D.sheetPick(p, chain), -1, p);
});

test('states: nothing captured, a missing feed, a broken feed', () => {
  const none = page(served({ has_totals: false, apps: raw.apps.map((x) => ({ id: x.id, name: x.name, kind: x.kind, route: x.route, status: 'never', has_values: false })) }));
  assert.match(vis(none), /Total, net across your apps None yet Nothing captured yet Not captured yet 16 apps/);
  assert.doesNotMatch(none, /data-fin|\$\u2022/);
  assert.match(none, /<b>16 apps<\/b>/);
  assert.match(page({ error: 'file missing' }), /es es-idle/);
  assert.equal(count(page({ error: 'bad json' }), /data-retry="money\/accounts"/g), 1);
  assert.deepEqual(D.finStatus(served(), NOW), { age: 300, refresh: raw.refresh, missing: (raw.errors || []).length });
  assert.equal(D.finStatus(null, NOW).missing, 1);
});

test('Data sheet: per-app capture state, the inventory and what needs you', () => {
  const d = D.finData(served(), NOW);
  assert.ok(d.sources.every((s) => ['ok', 'stale', 'needs_key', 'blocked', 'never'].includes(s.state)));
  assert.ok(d.sources.some((s) => s.name === 'iPhone app list'));
  assert.match(d.setup.find((s) => /not captured yet/.test(s.name)).line, /tell Jev which app/);
  assert.ok(d.setup.some((s) => s.state === 'blocked'));
  const words = JSON.stringify(d, (k, v) => (k === 'asOf' ? undefined : v));
  assert.doesNotMatch(words, new RegExp('\\b(' + AMOUNTS.filter((n) => n >= 1000).join('|') + ')\\b'), 'no amount in the Data sheet');
});

test('no deck file names the retired persona', () => {
  for (const f of ['deck.js', 'invest.js', 'app.js', 'index.html']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../static', f), 'utf8'), /\bJeff\b/, f);
});

// ---------------- glue ----------------
const moneyGlue = glue.slice(glue.indexOf('// ---- Money > Accounts (route money/accounts)'), glue.indexOf('// called by app.js when a page comes on screen'));
const moneyReg = (glue.match(/^DeckPages\.register\('money\/accounts',[^]*?\}\}\);$/m) || [''])[0];
const moneyHelpers = helpers.slice(helpers.indexOf('// ---- Money > Accounts.'), helpers.indexOf('// ---- Fleet page'));

test('glue: amounts go nowhere but the controller: one no-store fetch helper, no URL data, storage, cookie, history, console or title', () => {
  assert.ok(moneyGlue.length > 400 && moneyReg.length > 50 && moneyHelpers.length > 1000);
  assert.match(moneyGlue, /const finGet=p=>bfetch\(p,\{cache:'no-store',credentials:'same-origin'\}\)/, 'bounded at 60 s by the shared bfetch');
  assert.equal(count(moneyGlue + moneyHelpers, /'\/api\/finance-values'/g), 1, 'the values route is named once, inside the controller');
  for (const [name, code] of [['glue', moneyGlue + moneyReg], ['helpers', moneyHelpers]])
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'history.', 'location.', 'console.', 'document.title', 'sendBeacon', 'postMessage', 'caches.'])
      assert.ok(!code.includes(bad), name + ' uses ' + bad);
  assert.equal(count(moneyGlue, /fetch\(/g), 1);
  assert.match(moneyGlue, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.hidden\)FINC\.hide\(\)\}\)/);
  assert.match(moneyGlue, /addEventListener\('pagehide',\(\)=>FINC\.hide\(\)\)/);
  assert.match(moneyGlue, /mode==='ambient'\)\{FINC\.hide\(\);return\}/);
  assert.match(moneyReg, /hide\(\)\{FINC\.hide\(\)\}/, 'leaving the route drops revealed amounts');
});

test('glue in a stub DOM: the route loads statuses, Show amounts asks once, a hidden page drops the amounts, the mark is set', async () => {
  const el = { innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, querySelectorAll: () => [] };
  const docL = {}, fetched = [], marks = [], reg = {};
  const ctx = {
    $: () => null, esc: (s) => String(s), jget: async () => null, pname: () => 'today', localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, addEventListener: (t, f) => { docL[t] = f; }, querySelectorAll: () => [] }, addEventListener() {},
    fetch: async (p, o) => { fetched.push([p, o]); const body = p === '/api/finance' ? served() : valuesBody(); return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) }; },
    bfetch: (p, o) => ctx.fetch(p, o),
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, Date: { now: () => NOW }, DeckUI: D, mode: 'live',
    // the statuses read through the registry's get (with the page's shape check); the stub reads like the real one: no-store, same origin
    DeckPages: { mark: (c, s) => marks.push(s), register: (r, p) => { reg[r] = p; }, tv: () => false, load: async (fn) => { await fn(); return { ok: true }; },
      get: async (p, o) => { const r = await ctx.fetch('/api/' + p, { cache: 'no-store', credentials: 'same-origin' }); const d = await r.json(); const ok = !(o && o.shape) || !!o.shape(d); return { ok, status: r.status, data: d, error: ok ? '' : 'wrong shape' }; } }, pageAge: () => 0,
  };
  const needs = glue.slice(glue.indexOf('const V6='), glue.indexOf('const v6Cluster'));
  vm.createContext(ctx);
  vm.runInContext(needs + moneyGlue + moneyReg + '\nthis.__t={FINC};', ctx);
  reg['money/accounts'].show({ el });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetched.map((x) => x[0]), ['/api/finance']);
  assert.equal(fetched[0][1].cache, 'no-store');
  assert.match(el.innerHTML, /Show amounts/);
  assert.deepEqual(leaks(el.innerHTML), []);
  assert.equal(marks.at(-1).age, 300);
  const btn = { disabled: false, dataset: { fin: 'show' } };
  el.listeners.click({ target: { closest: (s) => (s === 'button[data-fin]' ? btn : null) } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetched.map((x) => x[0]), ['/api/finance', '/api/finance-values']);
  assert.equal(fetched[1][1].cache, 'no-store');
  assert.ok(leaks(el.innerHTML).length > 0);
  ctx.document.hidden = true; docL.visibilitychange();
  assert.deepEqual(leaks(el.innerHTML), []);
  assert.ok(reg['money/accounts'].data().sources.length > 0);
});

test('service worker: never answers or caches /api/finance or /api/finance-values', () => {
  assert.match(swSrc, /if\(u\.pathname==='\/api\/finance'\|\|u\.pathname==='\/api\/finance-values'\)return;/);
  assert.ok(!/SHELL=\[[^\]]*finance/.test(swSrc));
});
