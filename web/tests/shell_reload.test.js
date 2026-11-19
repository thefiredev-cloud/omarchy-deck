'use strict';
// Mechanism A (round "Better", PlanEng section 2): the server stamps the shell's cache name from its bytes, a new worker waits
// unless it is the first stamped one, and the page reloads only when ShellCore.reloadOk says the reader is idle.
// Runs the real static/sw.js and the real SHELL UPDATE block of app.js in a vm with fakes.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), swSrc = read('sw.js');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const CORE = between(app, '// ==== SHELL CORE BEGIN', '// ==== SHELL CORE END ====');
const UPDATE = between(app, '// ==== SHELL UPDATE BEGIN', '// ==== SHELL UPDATE END ====');
const C = vm.runInNewContext(CORE + '\nShellCore', {});
const STAMP = 'pdeck-shell-0123456789abcdef', PREV = 'pdeck-shell-fedcba9876543210';

// ---------------- the worker ----------------
async function worker(cached, fetchFn) {
  const on = {}, store = new Map(cached.map((k) => [k, new Map()]));
  const w = { skips: 0, claims: 0, store };
  const self = {
    addEventListener: (t, f) => { on[t] = f; },
    skipWaiting: () => { w.skips++; return Promise.resolve(); },
    clients: { claim: async () => { w.claims++; } },
    location: { href: 'https://deck.test/sw.js', origin: 'https://deck.test' },
  };
  const caches = {
    keys: async () => [...store.keys()],
    open: async (k) => { if (!store.has(k)) store.set(k, new Map()); const m = store.get(k); return { put: async (u, r) => m.set(u, r), match: async (u) => m.get(u) }; },
    delete: async (k) => store.delete(k),
  };
  const served = swSrc.replace('__SHELL_HASH__', STAMP.slice('pdeck-shell-'.length));
  vm.runInNewContext(served, { self, caches, location: self.location, URL, fetch: fetchFn || (async () => ({ ok: true })), Response: class {} });
  const run = async (t, ev) => { let p = Promise.resolve(); on[t](Object.assign({ waitUntil: (x) => { p = x; } }, ev)); await p; };
  w.install = () => run('install');
  w.activate = () => run('activate');
  w.message = (data) => on.message({ data });
  return w;
}

test('no earlier stamped shell (a first visit, or the hop from v113): the new worker takes over at once', async () => {
  for (const cached of [[], ['pdeck-shell-v113'], ['pdeck-shell-v113', 'pdeck-shell-v112']]) {
    const w = await worker(cached);
    await w.install();
    assert.equal(w.skips, 1, JSON.stringify(cached));
    assert.ok(w.store.has(STAMP), 'precached under the stamped name');
    await w.activate();
    assert.deepEqual([...w.store.keys()], [STAMP], 'one cache remains');
  }
});

test('an earlier stamped shell is cached: the new worker waits; skip lets it in; nothing else does', async () => {
  const w = await worker([PREV]);
  await w.install();
  assert.equal(w.skips, 0, 'waits for the page');
  w.message('reload');
  w.message({ skip: true });
  assert.equal(w.skips, 0);
  w.message('skip');
  assert.equal(w.skips, 1);
  await w.activate();
  assert.deepEqual([...w.store.keys()], [STAMP], 'the old stamped cache is deleted on activate');
  assert.equal(w.claims, 1);
});

test('every SHELL file or none: one failed fetch rejects the install; the old worker and its cache stay', async () => {
  const fails = [
    ['a 503 on deck.js', async (u) => ({ ok: u !== '/deck.js', status: u === '/deck.js' ? 503 : 200 })],
    ['the network drops on a font', async (u) => { if (u.endsWith('.woff2')) throw Error('offline'); return { ok: true }; }],
  ];
  for (const cached of [[PREV], ['pdeck-shell-v113']]) {
    for (const [name, f] of fails) {
      const w = await worker(cached, f);
      await assert.rejects(w.install(), name);
      assert.equal(w.skips, 0, name + ': never takes over');
      assert.deepEqual([...w.store.keys()], cached, name + ': the half-filled cache is dropped, the old one stays');
    }
  }
  const ok = await worker([PREV]);
  await ok.install();
  assert.equal(ok.store.get(STAMP).size, [...swSrc.match(/SHELL=\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].length, 'a good install holds every entry');
});

test('one script URL: the page registers /sw.js with no query and the worker reads none', () => {
  assert.match(UPDATE, /\.register\('\/sw\.js',\{scope:'\/',updateViaCache:'none'\}\)/);
  assert.doesNotMatch(app, /sw\.js\?/);
  assert.doesNotMatch(swSrc, /self\.location|registration\.scope|defer/i, 'the wait is read from the caches, never from a query');
  assert.match(swSrc, /const V='pdeck-shell-__SHELL_HASH__',SHELL=\[/, 'V is the server stamp, never a hand number');
  assert.equal(swSrc.split('__SHELL_HASH__').length, 2, 'the token appears once, in V only');
});

test('two tabs: nothing in SHELL loads after boot, so a page left under a newer worker never mixes versions', () => {
  const lazy = new Set();
  const files = ['app.js', 'deck.js', 'cre.js', 'tv.js', ...fs.readdirSync(path.join(__dirname, '../static/pages')).map((f) => 'pages/' + f),
    ...fs.readdirSync(path.join(__dirname, '../static')).filter((f) => /\.js$/.test(f) && !/\.min\.js$/.test(f) && f !== 'sw.js')];
  for (const f of new Set(files)) {
    const s = read(f);
    assert.doesNotMatch(s, /\bimport\(|importScripts/, f);
    for (const m of s.matchAll(/createElement\('(?:script|link)'\)[^;]*;[^;]*?\.(?:src|href)='([^']+)'/g)) lazy.add(m[1]);
  }
  assert.deepEqual([...lazy], ['/hls.min.js']);
  const shell = [...swSrc.match(/SHELL=\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(!shell.includes('/hls.min.js'), 'the one lazy file is not cached, so it always comes from the network');
});

// ---------------- reloadOk ----------------
test('reloadOk: never mid-task; hidden, ambient, just opened or a quiet minute off House', () => {
  const base = { hidden: false, mode: 'awake', route: 'today', idleMs: 0, waitMs: 0, modal: false, viewer: false, playing: false, typed: false, fresh: false };
  const at = (o) => C.reloadOk(Object.assign({}, base, o));
  const rows = [
    ['draft typed', { typed: true, hidden: true }, false],
    ['sheet open', { modal: true, hidden: true }, false],
    ['camera viewer open', { viewer: true, mode: 'ambient' }, false],
    ['pad/keys', { route: 'pad/keys', hidden: true }, false],
    ['pad/pad', { route: 'pad/pad', idleMs: 3600000 }, false],
    ['House awake, idle 5 min', { route: 'home/house', idleMs: 300000 }, false],
    ['Today, idle 59 s', { idleMs: 59000 }, false],
    ['Today, reading (no idle)', {}, false],
    ['House ambient', { route: 'home/house', mode: 'ambient' }, true],
    ['hidden and clean', { hidden: true }, true],
    ['Today idle 61 s', { idleMs: 61000 }, true],
    ['just opened, untouched', { fresh: true }, true],
    ['waited 24 h, sheet open, 10 quiet minutes', { waitMs: 86400000, modal: true, idleMs: 600000 }, true],
    ['waited 24 h, sheet open, hidden', { waitMs: 86400000, modal: true, hidden: true }, true],
    ['waited 24 h, in use', { waitMs: 86400000, modal: true, idleMs: 30000 }, false],
    ['Surf cam playing, quiet 5 min', { route: 'surf', playing: true, idleMs: 300000 }, false],
    ['a video playing, waited 24 h, 10 quiet minutes', { playing: true, waitMs: 86400000, idleMs: 600000 }, false],
    ['a video playing, ambient', { playing: true, mode: 'ambient' }, false],
  ];
  for (const [name, o, want] of rows) assert.equal(at(o), want, name);
  assert.equal(C.reloadOk(null), false);
  assert.equal(C.reloadOk(undefined), false);
});

test('typedBusy: only text the reader typed and has not sent; a value set by code never counts', () => {
  assert.equal(C.typedBusy([{ value: 'Write the release notes', typed: undefined, open: true }]), false, 'openCompose draft, never typed');
  assert.equal(C.typedBusy([{ value: 'half a mess', typed: 'half a mess', open: true }]), true);
  assert.equal(C.typedBusy([{ value: 'a new draft', typed: 'half a mess', open: true }]), false, 'code replaced it');
  assert.equal(C.typedBusy([{ value: '', typed: '', open: true }]), false, 'sent or cleared');
  assert.equal(C.typedBusy([{ value: 'half', typed: 'half', open: false }]), false, 'composer closed');
  assert.equal(C.typedBusy(null), false);
});

// ---------------- the page side, with fakes ----------------
function page(opt) {
  opt = opt || {};
  const t = { now: 1_000_000 }, docL = {}, winL = {}, timers = [], posted = [], reloads = [], updates = [], store = {};
  const fire = (L, type, ev) => (L[type] || []).forEach((f) => f(Object.assign({ type }, ev)));
  // a skip starts activation: the browser clears reg.waiting, so a later check never posts twice
  const waiting = opt.waiting === false ? null : { postMessage: (m) => { posted.push(m); reg.waiting = null; } };
  const reg = { waiting, installing: null, addEventListener() {}, update: () => { updates.push(t.now); return Promise.resolve(); } };
  const sw = { controller: opt.controlled === false ? null : {}, register: () => Promise.resolve(reg), addEventListener: (ty, f) => { (winL['sw:' + ty] = winL['sw:' + ty] || []).push(f); } };
  const env = {
    t, posted, reloads, updates, store, reg, sw,
    S: { hidden: false, mode: 'awake', route: 'today', modal: false, vOpen: false, frame: false, videos: [], focus: null },
    fire: (type, ev) => fire(docL, type, ev),
    fireWin: (type) => fire(winL, type, {}),
    swChange: () => { sw.controller = {}; fire(winL, 'sw:controllerchange', {}); },
    later: [],
    flush: () => { while (env.later.length) env.later.shift()(); },
    listen: (type, f) => { (docL[type] = docL[type] || []).push(f); },
    tick: (ms) => { const end = t.now + ms; for (;;) { const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; t.now = due.at; due.at += due.ms; due.f(); } t.now = end; },
  };
  const ctx = {
    navigator: { serviceWorker: sw }, window: { isSecureContext: true },
    document: { get hidden() { return env.S.hidden; }, get activeElement() { return env.S.focus; }, addEventListener: (ty, f) => { (docL[ty] = docL[ty] || []).push(f); },
      querySelector: (sel) => (sel === 'iframe.sf-camf' && env.S.frame ? {} : null), querySelectorAll: (sel) => (sel === 'video' ? env.S.videos : []) },
    addEventListener: (ty, f) => { (winL[ty] = winL[ty] || []).push(f); },
    setInterval: (f, ms) => { timers.push({ f, ms, at: t.now + ms }); return timers.length; },
    setTimeout: (f) => { env.later.push(f); return env.later.length; },
    location: { reload: () => reloads.push(t.now) },
    sessionStorage: { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] ?? null, removeItem: (k) => { delete store[k]; } },
    Date: { now: () => t.now }, Map, Promise, ShellCore: C,
    modalOpen: () => env.S.modal, last: t.now,
  };
  Object.defineProperty(ctx, 'mode', { get: () => env.S.mode });
  Object.defineProperty(ctx, 'vOpen', { get: () => env.S.vOpen });
  Object.defineProperty(ctx, 'SH', { get: () => ({ route: env.S.route }) });
  vm.createContext(ctx);
  vm.runInContext(UPDATE, ctx);
  return env;
}
const settle = () => new Promise((r) => setImmediate(r));
const field = (box, type) => ({ tagName: type ? 'INPUT' : 'TEXTAREA', type: type || 'textarea', value: '', isConnected: true, closest: () => box });

test('a sheet holds the new shell; closing it and a quiet minute let it in; then one reload', async () => {
  const p = page();
  p.S.modal = true;
  p.t.now += 10000; // past the just-opened window
  await settle();
  assert.deepEqual(p.posted, [], 'a waiting worker found at boot, sheet open: no skip');
  p.tick(61000);
  assert.deepEqual(p.posted, [], 'still open after a minute');
  p.S.modal = false;
  p.fire('close', {});
  assert.deepEqual(p.posted, ['skip'], 'the close of the sheet after a quiet minute lets it in');
  p.swChange();
  assert.equal(p.reloads.length, 1, 'reloads once when the new worker controls the page');
  p.swChange();
  p.tick(120000);
  assert.equal(p.reloads.length, 1, 'never twice');
});

test('a page just opened with a worker waiting swaps at once; one the reader is using waits', async () => {
  const fresh = page();
  await settle();
  assert.deepEqual(fresh.posted, ['skip']);
  const used = page();
  used.fire('pointerdown', {});
  await settle();
  assert.deepEqual(used.posted, []);
});

test('wheel and scroll count as reading: a laptop reader scrolling with the wheel is never reloaded', async () => {
  const p = page();
  p.fire('keydown', {});
  await settle();
  for (let i = 0; i < 5; i++) { p.tick(30000); p.fire(i % 2 ? 'wheel' : 'scroll', {}); }
  assert.deepEqual(p.posted, [], 'two and a half minutes of wheel and scroll, no skip');
  p.tick(120000);
  assert.deepEqual(p.posted, ['skip'], 'at the first minute tick after a quiet minute');
});

test('a composer draft set by code never blocks; typed text does until sent or the composer closes', async () => {
  const runp = { tagName: 'DIV', on: true, classList: { contains: () => runp.on } };
  const p = page();
  p.fire('keydown', {});
  await settle();
  const ta = field(runp);
  ta.value = 'Mission: write the release notes'; // openCompose, by code
  p.tick(61000);
  assert.deepEqual(p.posted, ['skip'], 'the draft did not block');

  const q = page();
  q.fire('keydown', {});
  await settle();
  const tb = field(runp);
  tb.value = 'half a th';
  q.fire('input', { target: tb });
  q.tick(61000);
  q.tick(61000);
  assert.deepEqual(q.posted, [], 'typed and unsent');
  runp.on = false; // closeRun
  q.tick(61000);
  assert.deepEqual(q.posted, ['skip'], 'the composer closed');
});

test('another tab let the worker in: this tab reloads at its own idle moment, not mid-typing', async () => {
  const box = { tagName: 'DIV', classList: { contains: () => true } };
  const p = page();
  p.fire('keydown', {});
  await settle();
  const ta = field(box);
  ta.value = 'draft';
  p.fire('input', { target: ta });
  p.swChange();
  p.tick(180000);
  assert.equal(p.reloads.length, 0, 'typed text holds the reload');
  ta.value = ''; // sent
  p.tick(61000);
  assert.equal(p.reloads.length, 1);
});

test('the first worker claiming an uncontrolled page never reloads it', async () => {
  const p = page({ controlled: false, waiting: false });
  await settle();
  p.swChange();
  p.tick(120000);
  assert.equal(p.reloads.length, 0);
});

test('the wall Pixel: update() hourly in every mode and on online; in ambient on House it swaps and keeps its mode', async () => {
  const p = page({ waiting: false });
  p.S.route = 'home/house';
  p.S.mode = 'ambient';
  p.fire('pointerdown', {});
  await settle();
  p.tick(3 * 3600000);
  assert.equal(p.updates.length, 3, 'hourly, ambient included');
  p.fireWin('online');
  assert.equal(p.updates.length, 4, 'and on online');
  p.reg.waiting = { postMessage: (m) => { p.posted.push(m); p.reg.waiting = null; } };
  p.tick(60000);
  assert.deepEqual(p.posted, ['skip'], 'ambient House swaps within the minute');
  p.swChange();
  assert.equal(p.reloads.length, 1);
  assert.equal(p.store['shell:mode'], 'ambient', 'the burn-in mode rides the reload');
  // the boot line of the next page: it comes back in ambient at once, with the idle clock past the ambient mark
  const i = app.indexOf('// a shell reload in dim or ambient'), boot = app.slice(i, app.indexOf('\n', app.indexOf('setMode(m)}}', i)));
  for (const [mode, on, want] of [['ambient', true, 'ambient'], ['dim', true, 'dim'], ['awake', true, null], ['ambient', false, null]]) {
    const seen = [], ss = { 'shell:mode': mode };
    const ctx = { ALWAYS_ON: on, T_AMB: 600000, T_DIM: 120000, last: 0, Date: { now: () => 5e6 }, setMode: (m) => seen.push(m),
      sessionStorage: { getItem: (k) => ss[k] ?? null, removeItem: (k) => { delete ss[k]; } } };
    vm.runInNewContext(boot, ctx);
    assert.deepEqual(seen, want ? [want] : [], mode + (on ? '' : ' (not always-on)'));
    if (want) assert.equal(ctx.last, 5e6 - (want === 'ambient' ? 600000 : 120000));
    assert.equal(ss['shell:mode'], undefined, 'read once');
  }
});

test('a shell that never gets its moment: after 24 h a sheet left open no longer holds it', async () => {
  const p = page();
  p.S.route = 'home/house'; // awake House with a sheet open: never idle by the normal rule
  p.S.modal = true;
  p.fire('pointerdown', {});
  await settle();
  p.tick(23 * 3600000);
  assert.deepEqual(p.posted, []);
  p.tick(3600000 + 60000);
  assert.deepEqual(p.posted, ['skip'], 'at 24 h plus a quiet ten minutes');
});

test('never over a playing cam: the Surf cam frame or a playing video holds the shell until it stops', async () => {
  const p = page();
  p.S.route = 'surf';
  p.S.frame = true;
  p.fire('pointerdown', {});
  await settle();
  p.tick(5 * 60000);
  assert.deepEqual(p.posted, [], 'a quiet five minutes with the cam frame on the page');
  p.S.frame = false;
  p.S.videos = [{ isConnected: true, paused: false, ended: false }];
  p.tick(60000);
  assert.deepEqual(p.posted, [], 'a playing video holds it too');
  p.S.videos[0].paused = true;
  p.tick(15000);
  assert.deepEqual(p.posted, ['skip'], 'stopped: in at the next check');
});

test('a search filter holds the shell only while it has focus; a typed draft holds it while its box is open', async () => {
  const p = page();
  p.fire('keydown', {});
  await settle();
  const q = field(null, 'search');
  q.value = 'backup';
  p.fire('input', { target: q });
  p.S.focus = q;
  p.tick(120000);
  assert.deepEqual(p.posted, [], 'still in the filter field');
  p.S.focus = null; // the filter applied, focus moved on; its value stays
  p.tick(15000);
  assert.deepEqual(p.posted, ['skip'], 'a filter left standing does not hold the shell for 24 h');
  const r = page();
  r.fire('keydown', {});
  await settle();
  const t = field(null, 'text');
  t.value = 'half typ';
  r.fire('input', { target: t });
  r.tick(180000);
  assert.deepEqual(r.posted, [], 'a text field the reader typed in still holds it without focus');
});

test('on hide the check runs after the pages\' own listeners: the Surf cam that stops on hide no longer holds the shell', async () => {
  const p = page();
  p.S.route = 'surf';
  p.S.frame = true;
  p.fire('pointerdown', {});
  await settle();
  p.listen('visibilitychange', () => { if (p.S.hidden) p.S.frame = false; }); // pages/surf.js: camStop on hide, registered after app.js
  p.S.hidden = true;
  p.fire('visibilitychange', {});
  assert.deepEqual(p.posted, [], 'not inside the event itself');
  p.flush();
  assert.deepEqual(p.posted, ['skip'], 'right after it, once the cam has stopped');
});
