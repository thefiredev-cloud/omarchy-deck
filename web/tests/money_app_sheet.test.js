// node --test tests/*.test.js  (Money > Accounts: an app's row opens its sheet, parity row 83). No DOM, no network, fake timers.
// What it proves: the sheet holds nothing from the values route until Show amounts; after it, the balance and every item the values view
// carries (more than the row's three and the old card's six); it masks again at Hide and at 30 s; the Data sheet never carries any of it.
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
const glue = src.slice(b);
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/finance.sample.json'), 'utf8'));
const NOW = (raw.t + 300) * 1000;
const vis = (h) => h.replace(/<span class="vh">[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// one extra brokerage app with eight items (the old card showed six, the row shows three) and fake amounts no other app uses
const ITEMS = ['Alpha fund', 'Beta fund', 'Gamma fund', 'Delta fund', 'Epsilon fund', 'Zeta fund', 'Eta fund', 'Theta fund'].map((label, i) => ({ label, usd: 1100 * (i + 1) + 11 }));
const BIG = { balance_usd: 98765, as_of: raw.t - 3600, items: ITEMS };
const feedApps = raw.apps.concat([{ id: 'bigbroker', name: 'Big broker (API)', kind: 'brokerage', route: 'api', status: 'ok', last_ok: raw.t - 3600, values: BIG }]);
function served() {
  return { t: raw.t, refresh: raw.refresh, stale: false, sample: true, errors: raw.errors, inventory: raw.inventory, explain: {},
    apps: feedApps.map((x) => ({ id: x.id, name: x.name, kind: x.kind, route: x.route, status: x.status, last_ok: x.last_ok, reason: x.reason || null, has_values: x.values != null })), has_totals: true };
}
function valuesBody() { const apps = {}; for (const x of feedApps) if (x.values) apps[x.id] = x.values; return { t: raw.t, stale: false, apps, totals: raw.totals }; }
// every amount and item label the values route carries, in the forms the deck prints
const SECRETS = [];
for (const x of feedApps) if (x.values) {
  if (typeof x.values.balance_usd === 'number') SECRETS.push(D.money(x.values.balance_usd), x.values.balance_usd.toLocaleString('en-US'));
  for (const i of x.values.items) { SECRETS.push(i.label); if (typeof i.usd === 'number') SECRETS.push(D.money(i.usd)); }
}
SECRETS.push(D.money(raw.totals.net_usd));
const leaks = (h) => [...new Set(SECRETS.filter((s) => h.includes(s)))];

function rig() {
  let now = NOW, id = 1;
  const timers = new Map(), pending = [];
  const env = { now: () => now, setT: (fn, d) => { const i = id++; timers.set(i, { fn, at: now + d }); return i; }, clearT: (i) => timers.delete(i), onChange() {},
    get: () => new Promise((res) => pending.push(res)) };
  const ctl = D.finCtl(env);
  const advance = (d) => { const end = now + d; for (const [i, t] of [...timers].sort((x, y) => x[1].at - y[1].at)) if (t.at <= end) { now = t.at; timers.delete(i); t.fn(); } now = end; };
  const answer = async (body) => { pending.shift()(body); await new Promise((r) => setImmediate(r)); };
  return { ctl, advance, answer, now: () => now };
}
const sheet = (id, rev, now) => D.finSheet(served(), id, now || NOW, rev || null);

test('every captured row opens its app sheet; apps never captured stay one Data sheet line', () => {
  const h = D.finPage(served(), NOW, null);
  const opens = [...h.matchAll(/<button type="button" class="frow" data-open="app" data-app="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(opens.includes('bigbroker') && opens.includes('chase') && opens.includes('venmo'), opens.join(','));
  assert.ok(!opens.includes('blueprint'), 'a never-captured app with no amounts is not its own row');
  for (const id of opens) assert.ok(sheet(id), id + ' has a sheet');
});

test('masked sheet: no amount and no item label in it before Show amounts, one Show amounts button, the app status in words', () => {
  const s = sheet('bigbroker');
  const all = s.title + s.sub + s.body + s.actions;
  assert.deepEqual(leaks(all), [], 'nothing from the values route before the tap');
  assert.equal(s.title, 'Big broker');
  assert.equal(s.sub, 'Brokerage');
  assert.match(s.body, /<b class="v">\$\u2022\u2022\u2022<\/b>/);
  assert.equal((s.body.match(/data-fin="show"/g) || []).length, 1);
  assert.match(vis(s.body), /Captured [A-Z][a-z]{2} \d{1,2}/, 'the capture date in the deck format');
  assert.match(vis(s.body), /show after Show amounts, then hide again after 30 s/);
  assert.match(s.actions, /data-sheet="data"/, 'the Data button sits in the sheet');
  const blocked = sheet('venmo');
  assert.match(vis(blocked.body), /Blocked/);
  assert.doesNotMatch(blocked.body, /data-fin/, 'an app with nothing captured offers no Show amounts');
  assert.match(vis(sheet('blueprint').body), /Nothing captured for this app yet\./);
});

test('after Show amounts: the balance, its date and every item the values view carries, not three or six', async () => {
  const r = rig();
  r.ctl.reveal();
  assert.match(sheet('bigbroker', r.ctl.view()).body, /data-fin="show" disabled>Loading/);
  await r.answer(valuesBody());
  const s = sheet('bigbroker', r.ctl.view());
  assert.match(s.body, new RegExp(D.money(98765).replace(/[$.]/g, '\\$&')));
  for (const i of ITEMS) {
    assert.match(s.body, new RegExp('<b>' + i.label + '</b></span><span class="fr"><b>' + D.money(i.usd).replace(/[$.]/g, '\\$&') + '</b>'), i.label);
  }
  assert.match(vis(s.body), /Items 8 items/);
  assert.match(vis(s.body), /As of [A-Z][a-z]{2} \d{1,2}/);
  assert.match(s.body, /data-fin="hide"/);
  assert.match(s.body, /Hides in 30 s/);
  // the row on the page still shows three, the sheet is where the rest live
  const row = D.finPage(served(), NOW, r.ctl.view()).match(/data-app="bigbroker">[^]*?<\/button>/)[0];
  assert.match(row, /Gamma fund/);
  assert.doesNotMatch(row, /Delta fund/);
  // an item with no amount reads No data, never $0 or a dash; an app the values view lacks reads No data
  const r2 = rig(); r2.ctl.reveal();
  const vb = valuesBody(); vb.apps.bigbroker = { balance_usd: null, items: [{ label: 'Gift card' }] }; delete vb.apps.chase;
  await r2.answer(vb);
  assert.match(vis(sheet('bigbroker', r2.ctl.view()).body), /Balance No data .*Gift card No data/);
  assert.match(vis(sheet('chase', r2.ctl.view()).body), /Balance No data/);
});

test('the open sheet masks again at 30 s and on Hide: the same spec from the same controller', async () => {
  const r = rig();
  r.ctl.reveal(); await r.answer(valuesBody());
  r.advance(29900);
  assert.ok(leaks(sheet('bigbroker', r.ctl.view(), r.now()).body).length > 8, 'held until 30 s');
  r.advance(100);
  assert.deepEqual(leaks(sheet('bigbroker', r.ctl.view(), r.now()).body), [], 'gone at 30 s');
  r.ctl.reveal(); await r.answer(valuesBody());
  r.ctl.hide();
  assert.deepEqual(leaks(sheet('bigbroker', r.ctl.view()).body), [], 'gone on Hide');
});

test('hostile and missing: unknown or prototype ids open nothing; labels are escaped; a long list is capped with a count', async () => {
  for (const id of ['nope', '__proto__', 'constructor', '', null]) assert.equal(D.finSheet(served(), id, NOW, null), null, String(id));
  assert.equal(D.finSheet({ error: 'bad json' }, 'chase', NOW, null), null);
  assert.equal(D.finSheet(null, 'chase', NOW, null), null);
  const r = rig(); r.ctl.reveal();
  const vb = valuesBody();
  vb.apps.bigbroker = { balance_usd: 1, items: [{ label: '<img src=x onerror=alert(1)>', usd: 5 }].concat(Array.from({ length: 70 }, (_, i) => ({ label: 'Lot ' + i, usd: i }))) };
  await r.answer(vb);
  const h = sheet('bigbroker', r.ctl.view()).body;
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img src=x/);
  assert.equal((h.match(/<div class="frow"><span class="fl"><b>/g) || []).length, 60);
  assert.match(vis(h), /71 items/);
  assert.match(vis(h), /11 more not shown/);
});

test('the Data sheet never carries the new detail: no balance, no item label, no amount, before or after Show amounts', async () => {
  const r = rig(); r.ctl.reveal(); await r.answer(valuesBody());
  // finData takes the sanitised feed only; the revealed controller is not an input, so nothing it holds can reach the sheet
  assert.equal(D.finData.length, 2);
  const words = JSON.stringify(D.finData(served(), NOW), (k, v) => (k === 'asOf' ? undefined : v));
  const amounts = SECRETS.filter((x) => x.startsWith('$') || x.startsWith('\u2212$') || /^\d{1,3}(,\d{3})+$/.test(x));
  assert.deepEqual(amounts.filter((x) => words.includes(x)), []);
  for (const i of ITEMS) assert.ok(!words.includes(i.label), i.label);
});

// ---------------- glue: the sheet in a stub DOM ----------------
const moneyGlue = glue.slice(glue.indexOf('// ---- Money > Accounts (route money/accounts)'), glue.indexOf('// called by app.js when a page comes on screen'));
const moneyReg = (glue.match(/^DeckPages\.register\('money\/accounts',[^]*?\}\}\);$/m) || [''])[0];

// a dialog as the shell makes it: close() fires its close listeners and the shell takes it out of the page
function stubDialog() {
  const body = { innerHTML: '', contains: () => false, querySelector: () => null };
  const on = [];
  const dlg = { isConnected: true, open: true, closed: 0, body, contains: (t) => !!(t && t.inDlg), addEventListener: (t, f) => { if (t === 'close') on.push(f); },
    querySelector: (s) => (s === '.sheet-b' ? body : null), querySelectorAll: () => [], close() { this.open = false; this.isConnected = false; this.closed++; on.forEach((f) => f()); } };
  return dlg;
}
// every string reachable from FIN (feed, page context, held dialog and its body), walked without leaving the object graph
function reachable(root) {
  const out = [], seen = new Set();
  (function walk(x, depth) { if (x == null || depth > 8) return; if (typeof x === 'string') { out.push(x); return; } if (typeof x !== 'object' || seen.has(x)) return; seen.add(x);
    for (const k of Object.keys(x)) walk(x[k], depth + 1); })(root, 0);
  return out.join('\n');
}

async function boot() {
  const el = { innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, querySelectorAll: () => [] };
  const docL = {}, fetched = [], reg = {}, opened = [], timers = [];
  const ctx = {
    $: () => null, esc: (s) => String(s), jget: async () => null, pname: () => 'money', localStorage: { getItem: () => null, setItem() {} },
    document: { hidden: false, activeElement: null, addEventListener: (t, f) => { docL[t] = f; }, querySelectorAll: () => [] }, addEventListener() {},
    fetch: async (p, o) => { fetched.push([p, o]); const body = p === '/api/finance' ? served() : valuesBody(); return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) }; },
    bfetch: (p, o) => ctx.fetch(p, o),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval() {}, Date: { now: () => NOW }, DeckUI: D, mode: 'live',
    DeckShell: { sheet: { open: (o) => { const d = stubDialog(); d.body.innerHTML = o.body; d.spec = o; opened.push(d); return d; }, close() {} } },
    DeckPages: { mark() {}, register: (r, p) => { reg[r] = p; }, tv: () => false, load: async (fn) => { await fn(); return { ok: true }; },
      get: async (p, o) => { const r = await ctx.fetch('/api/' + p, { cache: 'no-store', credentials: 'same-origin' }); const d = await r.json(); const ok = !(o && o.shape) || !!o.shape(d); return { ok, status: r.status, data: d, error: ok ? '' : 'wrong shape' }; } }, pageAge: () => 0,
  };
  const needs = glue.slice(glue.indexOf('const V6='), glue.indexOf('const v6Cluster'));
  vm.createContext(ctx);
  vm.runInContext(needs + moneyGlue + moneyReg + '\nthis.__t={FINC,FIN};', ctx);
  reg['money/accounts'].show({ el });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const tap = (sel, node) => ({ target: { inDlg: !!node.inDlg, closest: (s) => (s === sel ? node : null) } });
  return { ctx, el, docL, fetched, reg, opened, timers, tap };
}
const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

test('glue: a row tap opens the fin-app sheet masked, its own Show amounts fills it, the 30 s timer and Hide mask it in place', async () => {
  const g = await boot();
  assert.deepEqual(g.fetched.map((x) => x[0]), ['/api/finance']);
  g.el.listeners.click(g.tap('button[data-app]', { dataset: { app: 'bigbroker' } }));
  assert.equal(g.opened.length, 1);
  const d = g.opened[0];
  assert.equal(d.spec.id, 'fin-app');
  assert.ok(d.spec.opener, 'focus goes back to the row on close');
  assert.deepEqual(leaks(d.body.innerHTML), [], 'nothing in the sheet DOM before the tap');
  assert.deepEqual(g.fetched.map((x) => x[0]), ['/api/finance'], 'opening the sheet asks for no amount');
  // Show amounts inside the sheet: the dialog is outside the page, the document listener answers it
  g.docL.click(g.tap('button[data-fin]', { inDlg: true, disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  assert.deepEqual(g.fetched.map((x) => x[0]), ['/api/finance', '/api/finance-values']);
  assert.equal(g.fetched[1][1].cache, 'no-store');
  assert.equal(g.opened.length, 1, 'repainted in place, not stacked');
  for (const i of ITEMS) assert.ok(d.body.innerHTML.includes(i.label), i.label);
  assert.ok(leaks(g.el.innerHTML).length > 0, 'the page reveals with it: Show amounts is still all at once');
  const hideT = g.timers.find((t) => t.ms === 30000);
  assert.ok(hideT, 'the hide timer is 30 s');
  hideT.fn();
  assert.deepEqual(leaks(d.body.innerHTML), [], 'the open sheet masks at 30 s');
  assert.deepEqual(leaks(g.el.innerHTML), []);
  // reveal from the page, then Hide from the sheet
  g.el.listeners.click(g.tap('button[data-fin]', { disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  assert.ok(leaks(d.body.innerHTML).length > 8);
  g.docL.click(g.tap('button[data-fin]', { inDlg: true, disabled: false, dataset: { fin: 'hide' } }));
  assert.deepEqual(leaks(d.body.innerHTML), []);
  // a hidden page masks the sheet too
  g.el.listeners.click(g.tap('button[data-fin]', { disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  g.ctx.document.hidden = true; g.docL.visibilitychange();
  assert.deepEqual(leaks(d.body.innerHTML), []);
  // the Data sheet of the route, asked while amounts are shown, holds none of them
  g.ctx.document.hidden = false;
  g.el.listeners.click(g.tap('button[data-fin]', { disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  assert.ok(leaks(d.body.innerHTML).length > 8);
  const words = JSON.stringify(g.reg['money/accounts'].data(), (k, v) => (k === 'asOf' ? undefined : v));
  for (const i of ITEMS) assert.ok(!words.includes(i.label), i.label);
  assert.ok(!words.includes(D.money(98765)) && !words.includes('98765'));
});

test('glue: a feed that drops the app closes its sheet; a closed sheet is never painted', async () => {
  const g = await boot();
  g.el.listeners.click(g.tap('button[data-app]', { dataset: { app: 'bigbroker' } }));
  const d = g.opened[0];
  vm.runInContext('FIN.f=Object.assign({},FIN.f,{apps:FIN.f.apps.filter(x=>x.id!=="bigbroker")});paintMoney()', g.ctx);
  assert.equal(d.closed, 1);
  assert.equal(vm.runInContext('FIN.dlg', g.ctx), null);
  // a tap on an id the feed does not list opens nothing
  g.el.listeners.click(g.tap('button[data-app]', { dataset: { app: 'nope' } }));
  assert.equal(g.opened.length, 1);
});

test('glue: a revealed sheet that is closed keeps nothing: FIN lets go of it and its body is emptied, before and after the hide', async () => {
  const g = await boot();
  g.el.listeners.click(g.tap('button[data-app]', { dataset: { app: 'bigbroker' } }));
  const d = g.opened[0];
  g.docL.click(g.tap('button[data-fin]', { inDlg: true, disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  assert.ok(leaks(d.body.innerHTML).length > 8, 'revealed while open');
  d.close();
  const FIN = vm.runInContext('FIN', g.ctx);
  assert.equal(FIN.dlg, null);
  assert.equal(FIN.app, '');
  assert.equal(d.body.innerHTML, '', 'the detached node holds no revealed text');
  // the controller still holds the amounts until its own hide; then nothing reachable from FIN, or from the closed node, has one
  g.timers.find((t) => t.ms === 30000).fn();
  assert.equal(vm.runInContext('FINC.view().apps', g.ctx), null);
  assert.deepEqual(leaks(reachable(FIN)), []);
  assert.deepEqual(leaks(reachable(d)), []);
  for (const s of [D.money(98765), '98,765', '98765', ...ITEMS.map((i) => i.label)]) assert.ok(!reachable(FIN).includes(s) && !reachable(d).includes(s), s);
  // a sheet the shell took out of the page without a close event is dropped and emptied on the next paint
  g.el.listeners.click(g.tap('button[data-app]', { dataset: { app: 'bigbroker' } }));
  const d2 = g.opened[1];
  g.docL.click(g.tap('button[data-fin]', { inDlg: true, disabled: false, dataset: { fin: 'show' }, classList: { contains: () => false } }));
  await flush();
  assert.ok(leaks(d2.body.innerHTML).length > 8);
  d2.isConnected = false; d2.open = false;
  vm.runInContext('FINC.hide()', g.ctx);
  assert.equal(vm.runInContext('FIN.dlg', g.ctx), null);
  assert.equal(d2.body.innerHTML, '');
  assert.deepEqual(leaks(reachable(vm.runInContext('FIN', g.ctx))), []);
});
