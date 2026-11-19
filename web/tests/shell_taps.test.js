'use strict';
// Item 9 (C5, C6, decision 11): a failed tap says so on the control, a control call is bounded and honest, and whoami never blocks a paint.
// Runs the real ShellCore helpers and the real q(), tapFail and role boot blocks of app.js in a vm with fakes.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const between = (a, b) => { const i = app.indexOf(a), j = app.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return app.slice(i, j); };
const C = vm.runInNewContext(between('// ==== SHELL CORE BEGIN', '// ==== SHELL CORE END ====') + '\nShellCore', {});
const ROLE_SRC = between('const ROLE=(()=>', 'let GUEST=');
const Q_SRC = between('const Q_MS=', 'const other=()=>');
const TAP_SRC = between('// C5: a failed tap says so', "// House (Home's first sub)");
const BOOT_SRC = between('// ---- role (item 9', '// pages/*.js and the old page scripts');
const settle = () => new Promise((r) => setImmediate(r));
const WORDS = 'Did not work \u00B7 Tap again';

// ---------------- callResult ----------------
test('callResult: yes only for a 2xx JSON object with no error; everything else is a failure with words', () => {
  assert.deepEqual(C.callResult({ status: 200, body: { ok: true, volume: 40 } }), { ok: true, volume: 40 });
  const rows = [
    [{ status: 200, body: { error: 'host down' } }, 'host down', false],
    [{ status: 200, body: { ok: false } }, 'Refused', false],
    [{ status: 502, body: { error: 'ssh failed' } }, 'ssh failed', false],
    [{ status: 500, body: null }, 'HTTP 500', false],
    [{ status: 200, body: null }, 'The answer was not readable', false],
    [{ status: 200, body: [1, 2] }, 'The answer was not readable', false],
    [{ threw: true, timeout: true }, 'The computer did not answer in time', false],
    [{ threw: true }, 'The deck did not answer', true],
  ];
  for (const [x, words, offline] of rows) {
    const r = C.callResult(x);
    assert.equal(r.failed, true, JSON.stringify(x));
    assert.equal(r.error, words);
    assert.equal(r.offline, offline);
  }
  assert.equal(C.TAP_WORDS, WORDS);
});

// ---------------- notePlace ----------------
test('notePlace: above the control, below it at the top edge, never over it, whole inside the window', () => {
  const overlaps = (c, n, p) => !(p.left + n.w <= c.left || p.left >= c.left + c.width || p.top + n.h <= c.top || p.top >= c.top + c.height);
  const n = { w: 190, h: 34 };
  for (const v of [{ w: 908, h: 411 }, { w: 430, h: 932 }]) {
    const cases = [
      { left: 300, top: 200, width: 44, height: 44 }, // middle: above
      { left: 300, top: 10, width: 44, height: 44 }, // top edge: below
      { left: 2, top: 200, width: 44, height: 44 }, // left edge: clamped
      { left: v.w - 46, top: 200, width: 44, height: 44 }, // right edge: clamped
      { left: v.w - 46, top: 4, width: 44, height: 44 }, // top right corner
    ];
    for (const c of cases) {
      const p = C.notePlace(c, n, v);
      assert.ok(!overlaps(c, n, p), JSON.stringify({ v, c, p }) + ' covers the control');
      assert.ok(p.left >= 4 && p.left + n.w <= v.w - 4 && p.top >= 4 && p.top + n.h <= v.h - 4, JSON.stringify({ v, c, p }) + ' leaves the window');
    }
    assert.ok(C.notePlace(cases[0], n, v).top < cases[0].top, 'above when there is room');
    assert.ok(C.notePlace(cases[1], n, v).top >= cases[1].top + cases[1].height, 'below at the top edge');
  }
});

// ---------------- rolePlan ----------------
test('rolePlan: the stored role picks the first page only; an answer decides; no answer keeps the stored tabs', () => {
  const rows = [
    ['owner', 'owner', { known: true, tabs: true, changed: false, reload: false, store: 'owner', offline: false }],
    ['guest', 'guest', { known: true, tabs: true, changed: false, reload: false, store: 'guest', offline: false }],
    ['', 'owner', { known: true, tabs: true, changed: true, reload: false, store: 'owner', offline: false }],
    ['', 'guest', { known: true, tabs: true, changed: true, reload: true, store: 'guest', offline: false }],
    ['owner', 'guest', { known: true, tabs: true, changed: true, reload: true, store: 'guest', offline: false }],
    ['guest', 'owner', { known: true, tabs: true, changed: true, reload: true, store: 'owner', offline: false }],
    ['owner', '', { known: true, tabs: true, changed: false, reload: false, store: '', offline: true }],
    ['guest', '', { known: true, tabs: true, changed: false, reload: false, store: '', offline: true }],
    ['', '', { known: false, tabs: false, changed: false, reload: false, store: '', offline: true }],
    ['', 'viewer', { known: false, tabs: false, changed: false, reload: false, store: '', offline: true }],
  ];
  for (const [s, a, want] of rows) {
    const p = C.rolePlan(s, a);
    for (const [k, v] of Object.entries(want)) assert.equal(p[k], v, `${s || 'none'} + ${a || 'no answer'}: ${k}`);
  }
});

// ---------------- q() ----------------
function qPage(fetchFn) {
  const timers = [];
  const ctx = {
    host: 'pc-desktop', ShellCore: C, fetch: fetchFn, AbortController, URLSearchParams,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].f = null; },
    localStorage: { getItem: () => 'owner' },
  };
  vm.createContext(ctx);
  vm.runInContext(ROLE_SRC + Q_SRC + '\nthis.q=q;this.ROLE=ROLE;', ctx);
  ctx.fire = (ms) => timers.filter((t) => t.ms === ms && t.f).forEach((t) => { const f = t.f; t.f = null; f(); });
  return ctx;
}

test('q: no call leaves before whoami; the answer is honest; a hung call ends at 11 s, past the server\'s 10 s', async () => {
  const seen = [];
  const ok = qPage(async (url, o) => { seen.push([url, o.method]); return { status: 200, json: async () => ({ ok: true }) }; });
  const r = ok.q('lock', 1);
  await settle();
  assert.deepEqual(seen, [], 'waits for the role');
  ok.ROLE.open();
  assert.deepEqual(await r, { ok: true });
  assert.deepEqual(seen, [['/api/lock?host=pc-desktop', 'POST']]);

  const bad = qPage(async () => ({ status: 502, json: async () => ({ error: 'ssh failed' }) }));
  bad.ROLE.open();
  const b = await bad.q('vol-set?v=40', 1);
  assert.equal(b.failed, true);
  assert.equal(b.error, 'ssh failed');

  const down = qPage(async () => { throw new TypeError('Failed to fetch'); });
  down.ROLE.open();
  assert.equal((await down.q('media')).offline, true, 'no answer: the bar says Offline');

  let abort = null;
  const hung = qPage((url, o) => new Promise((_, no) => { abort = () => no(new Error('aborted')); o.signal.addEventListener('abort', abort); }));
  hung.ROLE.open();
  const h = hung.q('ws?v=2', 1);
  await settle();
  hung.fire(11000);
  const hr = await h;
  assert.equal(hr.failed, true);
  assert.equal(hr.error, 'The computer did not answer in time');
});

test('oneCall: a tap while the same control\'s call is out sends nothing; the control shows it waits until the answer', async () => {
  const ctx = qPage(async () => ({ status: 200, json: async () => ({ ok: true }) }));
  const b = { dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  let sent = 0, answer = null;
  const call = () => ctx.oneCall(b, () => { sent++; return new Promise((r) => { answer = r; }); });
  const first = call();
  assert.equal(b.dataset.wait, '1', 'waiting');
  assert.equal(b.attrs['aria-busy'], 'true');
  await call(); await call(); // a double and a triple tap on Lock, mute or play-pause
  assert.equal(sent, 1, 'one toggle, never two');
  answer(); await first;
  assert.equal(b.dataset.wait, undefined);
  assert.equal(b.attrs['aria-busy'], undefined);
  const again = call(); answer(); await again;
  assert.equal(sent, 2, 'a tap after the answer is a new call');
  // a failure clears the wait too
  const boom = ctx.oneCall(b, async () => { throw new Error('x'); });
  await assert.rejects(boom);
  assert.equal(b.dataset.wait, undefined);
});

// ---------------- tapFail ----------------
function tapPage() {
  const body = [], reports = [], haps = [], timers = [];
  const el = (tag) => ({ tag, className: '', textContent: '', style: {}, attrs: {}, offsetWidth: 190, offsetHeight: 34, setAttribute(k, v) { this.attrs[k] = v; }, remove() { const i = body.indexOf(this); if (i >= 0) body.splice(i, 1); } });
  const ctx = {
    ShellCore: C, innerWidth: 908, innerHeight: 411,
    document: { createElement: el, body: { appendChild: (n) => body.push(n) } },
    deckReport: (...a) => reports.push(a), haptic: (s) => haps.push(s),
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (i) => { if (timers[i - 1]) timers[i - 1].f = null; },
  };
  vm.createContext(ctx);
  vm.runInContext(TAP_SRC + '\nthis.tapFail=tapFail;', ctx);
  ctx.body = body; ctx.reports = reports; ctx.haps = haps;
  ctx.later = () => timers.filter((t) => t.f).forEach((t) => { const f = t.f; t.f = null; f(); });
  return ctx;
}
// a fake control: `label` is its .lb (or a direct text node when text:true); `grows` makes its box wider once the words are in the label
const button = (w, label, o) => {
  o = o || {};
  const lb = label == null ? null : o.text ? { nodeType: 3, textContent: label } : { textContent: label };
  return { isConnected: true, lb, childNodes: o.text && lb ? [{ nodeType: 1, textContent: '' }, lb] : [],
    getBoundingClientRect: () => ({ left: 400, top: 200, width: o.grows && lb && lb.textContent === WORDS ? w + 60 : w, height: 44 }),
    querySelector: (s) => (s === '.lb' && !o.text ? lb : null) };
};

test('tapFail: a wide labelled control reads the words in its label, then its label comes back', () => {
  const p = tapPage(), b = button(240, 'Living room TV');
  p.tapFail(b, { error: 'ssh failed', failed: true }, 'key?v=3');
  assert.equal(b.lb.textContent, WORDS);
  assert.equal(p.body.length, 0, 'no note for a labelled control');
  assert.deepEqual(p.reports[0].slice(0, 2), ['error', '']);
  assert.match(p.reports[0][2].msg, /^tap key: ssh failed$/, 'the failure reaches the client error route, path without its query');
  assert.deepEqual(p.haps, ['error']);
  p.later();
  assert.equal(b.lb.textContent, 'Living room TV', 'after 4 s it is itself again');
});

test('tapFail: a label beside an icon (a launcher) reads the words too; a label the words would not fit gets the note instead', () => {
  const p = tapPage(), launcher = button(240, 'Terminal', { text: true });
  p.tapFail(launcher, { error: 'x', failed: true }, 'launch?v=terminal');
  assert.equal(launcher.lb.textContent, WORDS, 'its own words, where the thumb is');
  assert.equal(p.body.length, 0);
  p.later();
  assert.equal(launcher.lb.textContent, 'Terminal');
  const lock = button(85, 'Lock', { grows: true });
  p.tapFail(lock, { error: 'x', failed: true }, 'lock');
  assert.equal(lock.lb.textContent, 'Lock', 'the words would widen the control: its label stays');
  assert.equal(p.body.length, 1, 'and the note says it beside it');
});

test('tapFail: an icon or number control gets one note beside it; a second failure replaces the first', () => {
  const p = tapPage(), one = button(44, null), two = button(44, '25');
  p.tapFail(one, { error: 'x', failed: true }, 'mute');
  assert.equal(p.body.length, 1);
  const n = p.body[0];
  assert.equal(n.className, 'tapnote');
  assert.equal(n.textContent, WORDS);
  assert.equal(n.attrs.role, 'status');
  assert.equal(n.style.top, (200 - 34 - 6) + 'px', 'above the control');
  assert.equal(n.style.visibility, '', 'shown once placed');
  p.tapFail(two, { error: 'x', failed: true }, 'vol-set?v=25');
  assert.equal(p.body.length, 1, 'one at a time');
  assert.notEqual(p.body[0], n);
  p.later();
  assert.equal(p.body.length, 0, 'gone after 4 s');
});

test('every control call says a failure on the control that was tapped', () => {
  for (const [name, re] of [
    ['host buttons', /b\.onclick=\(\)=>oneCall\(b,async\(\)=>\{const p=b\.dataset\.a\+'\?v='\+\(b\.dataset\.v\|\|''\),r=await q\(p,1\);flag\(r\);if\(r\.failed\)tapFail\(b,r,p\)/],
    ['lock', /if\(l\.dataset\.wait\)return;[^\n]*oneCall\(l,async\(\)=>\{const r=await q\('lock',1\);flag\(r\);if\(r\.failed\)tapFail\(l,r,'lock'\)/],
    ['volume', /if\(r\.failed\)\{if\(volNow!=null\)showVol\(volNow\);tapFail\(from\|\|\$\('#vs'\),r,'vol-set'\)\}else\{volNow=v;showVol\(v\)\}\};return from&&from\.tagName==='BUTTON'\?oneCall\(from,go\):go\(\)/],
    ['workspace', /oneCall\(b,async\(\)=>\{const p=\(wsMode=='move'\?'mvws':'ws'\)\+'\?v='\+b\.dataset\.n,r=await q\(p,1\);flag\(r\);if\(r\.failed\)tapFail\(b,r,p\);setTimeout\(refresh,400\)\}\)/],
    ['key', /async function fire\(b,k,i\)\{if\(b\.dataset\.wait\)return;[\s\S]{0,600}return oneCall\(b,async\(\)=>\{[^\n]*if\(r\.failed\)tapFail\(b,r,'key'\)/],
    ['bedroom', /\$\('#bedpp'\)\.onclick=\(\)=>\{const b=\$\('#bedpp'\);oneCall\(b,async\(\)=>\{const r=await q\('ha-media\?v=play-pause',1\);flag\(r\);if\(r\.failed\)tapFail\(b,r,'ha-media'\)/],
  ]) assert.match(app, re, name);
  assert.doesNotMatch(app, /fetch\('\/api\/ha-media/, 'no bare fetch for a control');
  assert.doesNotMatch(app, /XMLHttpRequest/, 'no synchronous request');
  // the level never shows before the server said yes: setVol paints only after the answer
  const i = app.indexOf('function setVol('), setVol = app.slice(i, app.indexOf('\n', app.indexOf('\n', i) + 1));
  assert.ok(i > 0 && setVol.indexOf('await q(') > 0 && setVol.indexOf('await q(') < setVol.indexOf('showVol('), 'setVol shows the level only after the answer');
});

// ---------------- the role boot ----------------
function boot(opt) {
  const ev = [], ls = Object.assign({}, opt.ls || {}), ss = Object.assign({}, opt.ss || {}), win = {}, timers = [], calls = { go: [], vis: 0, guestMode: 0, replace: [], st: 0 };
  const pages = [{ hidden: false, name: 'today' }, { hidden: false, name: 'home' }];
  const tabs = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  const made = [];
  let whoami = opt.whoami;
  const ctx = {
    ShellCore: C, PAGES: pages, page: 0, GUEST: ls.role === 'guest', GUEST_PAGES: ['home', 'pad'], errText: '', errMsg: '',
    $: (s) => (s === '#pgs' ? tabs : null), $$: () => [],
    pager: { before: (n) => made.push(n) },
    go: (r, o) => calls.go.push([r, o]), revealTab() {}, pageVisible: () => { calls.vis++; }, showSt: () => { calls.st++; }, guestMode: () => { calls.guestMode++; },
    localStorage: { getItem: (k) => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); } },
    sessionStorage: { getItem: (k) => ss[k] ?? null, setItem: (k, v) => { ss[k] = String(v); }, removeItem: (k) => { delete ss[k]; } },
    location: { replace: (u) => calls.replace.push(u), assign: (u) => calls.replace.push('assign ' + u) },
    document: {
      dispatchEvent: (e) => ev.push(e), createElement: () => {
        const n = { attrs: {}, dataset: {}, set innerHTML(h) { this.html = h; }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => n.btn, remove() { n.gone = true; } };
        n.btn = { onclick: null }; return n;
      },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    fetch: async () => { const w = whoami; if (w === 'down') throw new TypeError('Failed to fetch'); if (w === 401) return { ok: false, status: 401, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ role: w }) }; },
    AbortController, addEventListener: (t, f) => { win[t] = f; },
    setTimeout: () => 0, clearTimeout() {}, setInterval: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearInterval: (i) => { if (timers[i - 1]) timers[i - 1].f = null; },
  };
  vm.createContext(ctx);
  vm.runInContext(ROLE_SRC + '\nthis.ROLE=ROLE;\n' + BOOT_SRC, ctx);
  return { ctx, ev, ls, ss, calls, pages, tabs, made, win, timers, set whoami(v) { whoami = v; } };
}

test('role boot: stored owner paints the stored page at once, tabs wait for whoami, reads wait too', async () => {
  const b = boot({ ls: { role: 'owner' }, whoami: 'owner' });
  assert.equal(b.tabs.style.visibility, 'hidden', 'tabs invisible (no layout shift)');
  assert.equal(b.tabs.attrs.inert, '', 'and inert');
  assert.equal(b.pages[0].hidden, false, 'the stored page shows at once');
  assert.equal(b.ctx.ROLE.known, false);
  await settle();
  assert.equal(b.ctx.ROLE.known, true);
  assert.equal(b.tabs.style.visibility, '');
  assert.equal(b.tabs.attrs.inert, undefined);
  assert.equal(b.calls.vis, 1, 'the page reads once whoami answered');
  assert.deepEqual(b.ev, [], 'no role change, no deck:role');
  assert.deepEqual(b.calls.replace, []);
});

test('role boot: stored guest paints House; whoami confirms', async () => {
  const b = boot({ ls: { role: 'guest' }, whoami: 'guest' });
  await settle();
  assert.equal(b.ctx.ROLE.known, true);
  assert.deepEqual(b.ev, []);
  assert.deepEqual(b.calls.replace, []);
});

test('role boot: no stored role shows the bar only; owner then shows the page and fires deck:role', async () => {
  const b = boot({ ls: {}, whoami: 'owner' });
  assert.ok(b.pages.every((p) => p.hidden), 'no page before whoami');
  await settle();
  assert.equal(b.pages[0].hidden, false);
  assert.equal(b.ls.role, 'owner');
  assert.equal(b.ev.length, 1);
  assert.equal(b.ev[0].type, 'deck:role');
  assert.deepEqual([b.ev[0].detail.role, b.ev[0].detail.was], ['owner', null]);
});

test('role boot: owner turned guest stores guest, fires deck:role and reloads to House once; never twice', async () => {
  const b = boot({ ls: { role: 'owner' }, whoami: 'guest' });
  await settle();
  assert.equal(b.ls.role, 'guest');
  assert.deepEqual(b.ev.map((e) => [e.type, e.detail.role, e.detail.was]), [['deck:role', 'guest', 'owner']]);
  assert.deepEqual(b.calls.replace, ['/?p=home/house']);
  assert.equal(b.calls.vis, 0, 'no read under the old role');
  // the same session again (a storage that does not keep the role): the guest view applies in place, no loop
  const again = boot({ ls: { role: 'owner' }, ss: { 'role:reload': 'guest' }, whoami: 'guest' });
  await settle();
  assert.deepEqual(again.calls.replace, []);
  assert.equal(again.ctx.GUEST, true);
  assert.equal(again.calls.guestMode, 1);
  assert.deepEqual(again.calls.go[0][0], 'home/house');
  // a first visit of a guest device: bar only, then House
  const fresh = boot({ ls: {}, whoami: 'guest' });
  await settle();
  assert.deepEqual(fresh.calls.replace, ['/?p=home/house']);
  assert.ok(fresh.pages.every((p) => p.hidden), 'never an owner page for a frame');
});

test('role boot: offline with a stored role shows its tabs and Offline, asks again, and clears Offline on the answer', async () => {
  const b = boot({ ls: { role: 'owner' }, whoami: 'down' });
  await settle();
  assert.equal(b.ctx.ROLE.known, true);
  assert.equal(b.ctx.ROLE.offline, true);
  assert.equal(b.tabs.style.visibility, '', 'an offline owner is not trapped on one page');
  assert.equal(b.ctx.errText, 'offline');
  assert.equal(b.timers.filter((t) => t.f && t.ms === 30000).length, 1, 'asks again every 30 s');
  b.whoami = 'owner';
  b.win.online();
  await settle();
  assert.equal(b.ctx.ROLE.offline, false);
  assert.equal(b.ctx.errText, '');
  assert.equal(b.timers.filter((t) => t.f && t.ms === 30000).length, 0);
});

test('role boot: whoami answered 401 shows the bar and the Signed out panel with Sign in: no page, no tappable control, no read', async () => {
  const b = boot({ ls: { role: 'owner' }, whoami: 401 });
  await settle();
  assert.equal(b.ctx.ROLE.known, false, 'nothing reads with a cookie that is gone');
  assert.equal(b.ctx.ROLE.role, undefined, 'no role is taken from a 401');
  assert.equal(b.ctx.errText, '', 'not Offline');
  // a stored owner would have shown the stored page at once: a sign-out hides it, so no control inside it can be tapped
  assert.ok(b.pages.every((p) => p.hidden), 'no page visible');
  assert.equal(b.tabs.style.visibility, 'hidden', 'no tabs');
  assert.equal(b.tabs.attrs.inert, '', 'and none reachable by keyboard');
  assert.equal(b.calls.vis, 0, 'no page read');
  assert.equal(b.made.length, 1);
  assert.match(b.made[0].html, /^<div class="es es-setup"><svg class="es-i"[^]*<b class="es-t">Signed out<\/b><span class="es-l">[^<]+<\/span><button type="button" class="btn btn-primary">Sign in<\/button><\/div>$/);
  assert.equal(b.made[0].id, 'roleoff', 'the panel the page margins style');
  b.made[0].btn.onclick();
  assert.deepEqual(b.calls.replace, ['assign /?t='], 'the sign-in page, past the worker\'s cached page');
  assert.equal(b.ls.role, 'owner', 'the stored role is not changed by a sign-out');
  // a later ask in the same session says owner: the page comes back and the line goes
  b.whoami = 'owner';
  b.win.online();
  await settle();
  assert.equal(b.ctx.ROLE.known, true);
  assert.equal(b.pages[0].hidden, false);
  assert.equal(b.made[0].gone, true);
  assert.equal(b.tabs.style.visibility, '');
});


test('role boot: offline with no stored role shows the failed panel with Try again; Try again asks and then shows the page', async () => {
  const b = boot({ ls: {}, whoami: 'down' });
  await settle();
  assert.equal(b.ctx.ROLE.known, false);
  assert.ok(b.pages.every((p) => p.hidden));
  assert.equal(b.made.length, 1);
  assert.match(b.made[0].html, /^<div class="es es-bad"><svg class="es-i"[^]*<b class="es-t">The deck server did not answer<\/b><span class="es-l">[^<]+<\/span><button type="button" class="btn btn-primary">Try again<\/button><\/div>$/);
  assert.doesNotMatch(b.made[0].html, /\u2014/, 'no em dash');
  b.whoami = 'owner';
  b.made[0].btn.onclick();
  await settle();
  assert.equal(b.made[0].gone, true);
  assert.equal(b.ctx.ROLE.known, true);
  assert.equal(b.pages[0].hidden, false);
});

test('no page read and no control call before whoami: pageVisible, the 15 s tick and q wait for the role', () => {
  assert.match(app, /function pageVisible\(\)\{if\(!ROLE\.known\)return;/);
  assert.match(app, /setInterval\(\(\)=>\{if\(!ROLE\.known\|\|document\.hidden/);
  assert.match(app, /async function q\(p,post\)\{await ROLE\.ready;/);
  // deck.js renders the opening page itself once it has parsed: only when whoami has answered (else app.js dispatches through pageVisible)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'static', 'deck.js'), 'utf8'), /\nif\(!document\.hidden&&\(typeof ROLE==='undefined'\|\|ROLE\.known\)\)deckPage\(leafOf\(pname\(\)\),false\);/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'static', 'deck.js'), 'utf8'), /\nif\(!document\.hidden\)deckPage\(/, 'no ungated first dispatch');
  // the client waits longer than the server waits for the host (main.rs hosts.call, 10 s), so a slow yes is never called a failure
  assert.match(app, /const Q_MS=11000;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'rust', 'src', 'main.rs'), 'utf8'), /"mute" \| "screenshot" \| "lock" => app\.hosts\.call\(host, &\[a\], 10\)\.await/);
  // the read guard forgets every kept answer on deck:role (pinned in tests/ui_guard.test.js); the shell fires it on a change
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'static', 'deck.js'), 'utf8'), /document\.addEventListener\('deck:role',forget\)/);
});
