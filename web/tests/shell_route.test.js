'use strict';
// Reach and flow in the shell (lane BNav, 2026-11-15): the address names the route and the open sheet (F3, F9) and reads back on a
// reload or a pasted link, never on an installed app's launch; Back closes the sheet, then returns to the page before; a closed sheet
// gives focus back to its row, found again by its key after a repaint (A2); a scrolling sheet body is a keyboard stop (A11); Tab stays in
// the sheet (A12); the tab strip is a tab list (B2); and on a phone the bottom bar holds all eight tabs whole and Home's sub-tab row all
// six (F1, F2), checked by a layout probe from ui.css, tokens.css and the shipped Geist metrics.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), html = read('index.html'), ui = read('ui.css'), tokens = read('tokens.css');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i > 0 && j > i, a); return s.slice(i, j); };
// the blocks under test load when a test asks, so on a build without them each test fails on its own
const once = (f) => { let v; return () => (v === undefined ? (v = f()) : v); };
const route = once(() => vm.runInNewContext(between(app, '// ==== SHELL ROUTE BEGIN', '// ==== SHELL ROUTE END ====') + '\nShellRoute', {}));
const R = new Proxy({}, { get: (_, k) => route()[k] });
const SERVICES = between(app, '// ==== SHELL SERVICES BEGIN', '// ==== SHELL SERVICES END ====');
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------------- the address (F3, F9) ----------------
test('a pasted link or a reload names its route and its sheet; the token, the TV switch and junk are never parameters', () => {
  assert.deepEqual(plain(R.boot('?p=surf&spot=salt-creek', '')), { route: 'surf', params: { spot: 'salt-creek' }, from: 'link' });
  assert.deepEqual(plain(R.boot('?p=realestate/residential&zip=92629', '')), { route: 'realestate/residential', params: { zip: '92629' }, from: 'link' });
  assert.deepEqual(plain(R.boot('?t=tok_secret&view=tv&p=surf', '')).params, {}, 'the token and the TV switch stay out');
  assert.deepEqual(plain(R.boot('?p=surf&q=%3Cscript%3E&X=1', '')).params, {}, 'an odd key or value is dropped, never kept');
  assert.equal(R.boot('?p=../etc', '').route, '', 'a route that is not a route keeps the stored page');
  assert.equal(R.boot('', '').from, 'stored');
  // every older link still opens its page
  assert.equal(R.boot('?p=housing', '').route, 'housing', 'old names pass the redirect table in go()');
  assert.equal(R.boot('?p=home/crons', '').route, 'home/crons');
  assert.equal(R.boot('', '#home/crons').route, 'home/crons');
  assert.equal(R.boot('', '#p=home/crons').route, 'home/crons', 'a #p= link opens its page (it fell back to Today before)');
  assert.equal(R.boot('?p=surf', '#fleet').route, 'fleet', 'a hash route wins over ?p=, as before');
  assert.equal(R.boot('', '#t=5,10').from, 'stored', '#t= is the burn-in timer, not a page');
});

test('an installed app launch reopens on the page used last, never on the ?p= it was installed or bookmarked from', () => {
  assert.deepEqual(plain(R.boot('?p=surf&spot=salt-creek', '', { launch: true })), { route: '', params: {}, from: 'launch' });
  // a launch is standalone and not a reload: a reload inside the app, and any browser tab, read the address
  assert.match(app, /launch:\(navigator\.standalone===true\|\|mm\('\(display-mode: standalone\)'\)\|\|mm\('\(display-mode: fullscreen\)'\)\)&&nav\.type==='navigate'/);
  assert.match(read('manifest.webmanifest'), /"start_url":"\/"/, 'the app starts on "/"');
  // the address is cleared at once, before anything else reads it, so a token never stays on screen
  const clear = app.indexOf("const HASH=location.hash,SEARCH=location.search;history.replaceState(null,'','/');");
  assert.ok(clear > 0, 'the address is cleared on load');
  for (const later of ['localStorage', "fetch('/api/whoami'", 'function go(']) assert.ok(app.indexOf(later) > clear, 'before ' + later);
});

test('the address round trip: what query() writes, boot() reads back, always on "/" (the iOS shell shows Back to deck off it)', () => {
  for (const [route, params, key] of [['surf', {}, ['spot', 'salt-creek']], ['realestate/residential', {}, ['zip', '92629']], ['home/crons', { f: 'all' }, null],
    ['surf', { region: 'oc' }, ['spot', 'trestles']], ['today', {}, null], ['shop/market', {}, ['watch', 'rtx-4080']]]) {
    const u = R.query(route, params, key);
    assert.match(u, /^\/\?p=/, u);
    const b = R.boot(u.slice(1), '');
    assert.equal(b.route, route, u);
    assert.deepEqual(plain(b.params), Object.assign({}, params, key ? { [key[0]]: key[1] } : {}), u);
  }
  assert.equal(R.query('surf', { spot: 'old' }, ['spot', 'new']), '/?p=surf&spot=new', 'the open sheet wins over a stale parameter of the same name');
  assert.equal(R.query('surf', { view: 'tv', t: 'x' }, null), '/?p=surf');
  assert.deepEqual(plain(R.sheetKey('zip', '92629')), ['zip', '92629']);
  assert.equal(R.sheetKey('zip', ''), null);
  assert.equal(R.sheetKey('Zip Code', '1'), null);
  assert.equal(R.sheetKey('spot', 'a b'), null);
});

test('a guest link to a page the guest may not see lands on the guest first page with its parameters dropped', () => {
  const boot = app.slice(app.indexOf('// Reopen on the page used last, unless the address names one'), app.indexOf('// pages/*.js and the old page scripts'));
  assert.match(boot, /ok=b\.from==='link'&&!!pageEl\(wt\)&&!\(GUEST&&wt==='home'&&ws&&ws!=='house'\)/);
  assert.match(boot, /go\(route\+\(ok\?linkQuery\(b\.params\):''\),\{instant:true\}\);reopen\(keys\)/);
  // a sheet reopens only by tapping a row of the page on screen, so a link opens only what that page shows its viewer
  const re = app.slice(app.indexOf('function reopen(keys)'), app.indexOf('// Reopen on the page used last'));
  assert.match(re, /const pg=subOf\(PAGES\[page\]\)\|\|PAGES\[page\];/);
  assert.match(re, /\.find\(x=>!x\.closest\('dialog'\)&&x\.getClientRects\(\)\.length&&!x\.disabled\)/);
});

// ---------------- a fake DOM and browser history for the sheet host ----------------
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function one(sel) {
  const m = sel.trim().match(/^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|[\w-]+))?\])*)$/i);
  if (!m) throw new Error('fake DOM cannot match ' + sel);
  return { tag: m[1].toUpperCase(), cls: [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]), attrs: [...m[2].matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([\w-]+)))?\]/g)].map((x) => [x[1], x[2] !== undefined ? x[2] : x[3]]) };
}
class El {
  constructor(doc, tag) { Object.assign(this, { ownerDocument: doc, tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, dataset: {}, className: '', textContent: '', hidden: false, open: false, disabled: false, listeners: {}, _tab: null, _html: '' }); }
  get tabIndex() { if (this._tab !== null) return this._tab; return ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(this.tagName) ? 0 : -1; }
  set tabIndex(v) { this._tab = +v; this.attrs.tabindex = String(v); }
  get parentElement() { return this.parentNode; }
  get classList() { const s = this; const list = () => s.className.split(/\s+/).filter(Boolean);
    return { contains: (c) => list().includes(c), add: (c) => { if (!list().includes(c)) s.className = list().concat(c).join(' '); }, remove: (c) => { s.className = list().filter((x) => x !== c).join(' '); }, toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; } }; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); if (k === 'open') this.open = true; if (k === 'tabindex') this._tab = +v; }
  getAttribute(k) { if (k === 'open') return this.open ? '' : null; return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'tabindex') this._tab = null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.body) return true; return false; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.clicks = (this.clicks || 0) + 1; if (this.onclick) this.onclick(); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatchEvent(e) { (this.listeners[e.type] || []).forEach((f) => f(e)); return true; }
  showModal() { this.open = true; const af = this.find((x) => 'autofocus' in x.attrs); if (af) af.focus(); }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
  find(fn) { for (const c of this.children) { if (fn(c)) return c; const d = c.find(fn); if (d) return d; } return null; }
  all(fn, out = []) { for (const c of this.children) { if (fn(c)) out.push(c); c.all(fn, out); } return out; }
  matches(sel) { return sel.split(',').some((s) => { const p = one(s); if (p.tag && p.tag !== this.tagName) return false;
    if (!p.cls.every((c) => this.classList.contains(c))) return false;
    return p.attrs.every(([k, v]) => { const a = this.getAttribute(k); return a !== null && (v === undefined || a === v); }); }); }
  closest(sel) { for (let n = this; n && n.matches; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return this.all((x) => x.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function fakeDoc() {
  const doc = { activeElement: null, createElement: (t) => new El(doc, t), dispatchEvent: () => true };
  doc.body = new El(doc, 'body');
  return doc;
}
const el = (doc, tag, attrs = {}, parent) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } (parent || doc.body).appendChild(e); return e; };
// a browser history with addresses: push truncates forward entries; go() and Back move later and fire popstate, as browsers do
function browser() {
  const h = { list: [{ s: null, u: '/' }], i: 0, pending: [], onpop: null,
    push(s, u) { h.list = h.list.slice(0, h.i + 1).concat([{ s, u: u === undefined ? h.list[h.i].u : u }]); h.i++; },
    replace(s, u) { const e = h.list[h.i]; h.list[h.i] = { s: s === undefined ? e.s : s, u: u === undefined ? e.u : u }; },
    go(n) { h.pending.push(n); }, back() { h.pending.push(-1); },
    get url() { return h.list[h.i].u; },
    deliver() { while (h.pending.length) { const n = h.pending.shift(), j = Math.max(0, Math.min(h.list.length - 1, h.i + n)); if (j === h.i) continue; h.i = j; h.onpop({ state: h.list[j].s }); } } };
  return h;
}
// the shell around the sheet host, as app.js wires it: go() writes the route (push for the reader's choice), popstate shows the page
// in the address or writes it again
function shell(o = {}) {
  const doc = fakeDoc(), hist = browser(), SH = { route: 'surf', params: {} }, timers = [];
  const tab = el(doc, 'button', { class: 'on' });
  const env = { doc, CustomEvent: class { constructor(t, x) { this.type = t; this.detail = x && x.detail; } }, now: () => 0,
    setT: (f) => { timers.push(f); return timers.length; }, clearT: (k) => { timers[k - 1] = null; },
    store: { get: () => null, set() {} }, route: () => ({ route: SH.route, full: SH.route, label: '' }), pages: () => null, ui: () => null,
    guest: () => false, tv: () => false, alwaysOn: () => false, ownerOk: () => Promise.resolve(false), paintStatus() {}, fallbackFocus: () => tab,
    refind: (f) => doc.body.all((x) => x.dataset.open === f[0] && x.dataset.key === f[1] && x.isConnected)[0] || null,
    url: (k) => R.query(SH.route, SH.params, k), sheetKey: (a, b) => R.sheetKey(a, b),
    history: { push: (s, u) => hist.push(s, u), replace: (s, u) => hist.replace(s, u), go: (n) => hist.go(n) } };
  Object.assign(env, o.env || {});
  const S = vm.runInNewContext(SERVICES + '\nShellServices;', {})(env);
  const go = (route, push) => { const changed = route !== SH.route; SH.route = route; SH.params = {}; if (changed) S.onRoute(); S.navigate(changed && push && !o.replaceOnly); };
  hist.onpop = (e) => { if (S.onPop(e) < 0) return; const b = R.boot(hist.url.slice(1), ''); if (b.route && b.route !== SH.route) go(b.route, false); else S.navigate(false); };
  const settle = () => { for (let k = 0; k < 5; k++) { const due = timers.splice(0); due.forEach((f) => f && f()); hist.deliver(); } };
  S.navigate(false); // boot: the route on screen is written on the boot entry
  return { S, doc, hist, SH, go, settle, tab, row: (k, v) => el(doc, 'button', { 'data-open': k, 'data-key': v }) };
}

test('Back closes the sheet first, then returns to the page before; the address names each step', () => {
  const t = shell();
  assert.equal(t.hist.url, '/?p=surf', 'boot writes the route on screen');
  t.go('realestate/residential', true); t.settle();
  assert.equal(t.hist.url, '/?p=realestate/residential');
  const row = t.row('zip', '92629');
  t.S.sheet.open({ title: '92629', opener: row }); t.settle();
  assert.equal(t.hist.url, '/?p=realestate/residential&zip=92629', 'the open sheet is in the address, so a reload or a copy keeps it');
  assert.equal(t.hist.list.length, 3);
  t.hist.back(); t.settle();
  assert.equal(t.S.sheet.current(), null, 'first Back: the sheet closes');
  assert.equal(t.SH.route, 'realestate/residential', 'and the page stays');
  assert.equal(t.hist.url, '/?p=realestate/residential');
  assert.equal(t.doc.activeElement, row, 'focus is back on the row');
  t.hist.back(); t.settle();
  assert.equal(t.SH.route, 'surf', 'second Back: the page before');
  assert.equal(t.hist.url, '/?p=surf');
  assert.equal(t.hist.i, 0, 'and the deck never left');
});

test('a route change with a sheet open gives the sheet entry to the new page, so history does not grow and Back is the page before', () => {
  const t = shell();
  t.S.sheet.open({ title: 'Salt Creek', opener: t.row('spot', 'salt-creek') }); t.settle();
  assert.equal(t.hist.url, '/?p=surf&spot=salt-creek');
  t.go('shop/market', true); t.settle();
  assert.equal(t.S.sheet.current(), null);
  assert.deepEqual(t.hist.list.map((e) => e.u), ['/?p=surf', '/?p=shop/market']);
  t.hist.back(); t.settle();
  assert.equal(t.SH.route, 'surf');
  // a refresh or a redirect (replace) never adds an entry
  t.go('surf', false); t.go('today', false); t.settle();
  assert.equal(t.hist.list.length, 2); assert.equal(t.hist.url, '/?p=today');
});

test('inside the iPhone app and on the TV routes only replace; a sheet still owns one entry and Back closes it', () => {
  const t = shell({ replaceOnly: true });
  t.go('realestate/residential', true); t.settle();
  assert.equal(t.hist.list.length, 1, 'no entry per page');
  assert.equal(t.hist.url, '/?p=realestate/residential');
  t.S.sheet.open({ title: '92629', opener: t.row('zip', '92629') }); t.settle();
  assert.equal(t.hist.list.length, 2);
  t.go('surf', true); t.settle();
  assert.equal(t.hist.i, 0, 'the sheet entry is given back');
  assert.equal(t.hist.url, '/?p=surf', 'and the address names the new page');
  assert.equal(t.hist.list[0].s, null, 'the boot entry keeps its own state (the TV guard reads a null state)');
});

test('a sheet a page opens from its link without a row takes the link key; a row inside another sheet gives none', () => {
  const t = shell();
  t.S.hint(['zip', '92629']);
  t.S.sheet.open({ title: '92629' }); t.settle();
  assert.equal(t.hist.url, '/?p=surf&zip=92629');
  assert.deepEqual(plain(t.S.sheet.key()), ['zip', '92629']);
  const inner = el(t.doc, 'button', { 'data-open': 'zip', 'data-key': '92648' }, t.S.sheet.current());
  t.S.sheet.open({ title: '92648', opener: inner }); t.settle();
  assert.equal(t.hist.url, '/?p=surf&zip=92629', 'a link to the inner sheet could not reopen it, so the address keeps the outer one');
});

// ---------------- focus and keys in a sheet (A2, A11, A12) ----------------
test('closing a sheet gives focus to its row, found again by its key when the page repainted it (A2)', () => {
  const t = shell(), row = t.row('zip', '92629');
  t.S.sheet.open({ title: '92629', opener: row }); t.settle();
  t.doc.body.removeChild(row); // the page repainted its list while the sheet was open
  const again = t.row('zip', '92629');
  t.S.sheet.close(); t.settle();
  assert.equal(t.doc.activeElement, again, 'the same row, painted again');
  // no row with that key on the page: the tab, as before
  const lone = t.row('spot', 'x');
  t.S.sheet.open({ title: 'x', opener: lone }); t.settle(); t.doc.body.removeChild(lone);
  t.S.sheet.close(); t.settle();
  assert.equal(t.doc.activeElement, t.tab);
});

test('a sheet opened by a touch or a click keeps focus on its title for a screen reader but draws no ring (Mobile Safari)', () => {
  let ptr = true;
  const t = shell({ env: { pointer: () => ptr } });
  const d = t.S.sheet.open({ title: 'Salt Creek', opener: t.row('spot', 'salt-creek') }), h = d.querySelector('h2');
  assert.equal(t.doc.activeElement, h, 'focus is on the title');
  assert.equal(h.dataset.pointer, '1', 'marked as a pointer open');
  t.S.sheet.close(); t.settle(); ptr = false;
  const k = t.S.sheet.open({ title: 'Status' }).querySelector('h2');
  assert.equal(k.dataset.pointer, undefined, 'a key opened it: the ring shows');
  assert.match(ui, /\n\.sheet-h h2\[data-pointer="1"\]:focus,\.sheet-h h2\[data-pointer="1"\]:focus-visible\{outline:none\}/);
  assert.match(app, /pointer:\(\)=>Date\.now\(\)-lastPointer<3000/);
  assert.match(app, /let lastPointer=0;addEventListener\('pointerdown',\(\)=>\{lastPointer=Date\.now\(\)\},true\);addEventListener\('keydown',\(\)=>\{lastPointer=0\},true\);/);
});

test('L: a page head with nothing to show takes no row (the Pixel band above Today); the freshness copy stays in the bar', () => {
  const l = ui.split('@media (min-width:600px) and (max-height:499px){').slice(1).map((x) => x.split('\n}')[0]);
  assert.ok(l.some((b) => b.includes('\n  .phead:not(:has(.pscope .keep)){min-height:0;padding:0;margin-bottom:var(--s-2)}')));
  assert.ok(l.some((b) => /\.phead>\.pact,\.phead \.fresh\{display:none\}/.test(b)), 'the head copy of the mark was already hidden on L');
  assert.ok(l.some((b) => /#pager \.phead \.ptitle\{position:absolute;/.test(b)), 'the title stays in the tree, out of flow, so it takes no room either');
  assert.ok(l.some((b) => /#tfresh,#tact\{display:contents\}/.test(b)), 'and its copy shows in the bar');
});

test('Tab and Shift Tab stay inside an open sheet (A12)', () => {
  const t = shell();
  const d = t.S.sheet.open({ title: 'Status', opener: t.row('status', 'x') });
  const b = d.querySelector('.sheet-b'), a1 = el(t.doc, 'button', {}, b), a2 = el(t.doc, 'a', { href: '#' }, b);
  const key = (shift) => { const e = { key: 'Tab', shiftKey: !!shift, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; return [t.S.onKey(e), e]; };
  const title = d.querySelector('h2'), close = d.querySelector('.sheet-x');
  assert.equal(t.doc.activeElement, title, 'the sheet opens on its title');
  let [hit] = key(true); assert.equal(hit, true); assert.equal(t.doc.activeElement, a2, 'Shift Tab from the title wraps to the last stop');
  [hit] = key(false); assert.equal(t.doc.activeElement, close, 'Tab from the last stop wraps to the first');
  a1.focus(); const [mid, e] = key(false); assert.equal(mid, false); assert.equal(e.defaultPrevented, false, 'between stops Tab stays native');
  t.doc.activeElement = t.doc.body; key(false); assert.equal(t.doc.activeElement, close, 'focus that left the sheet comes back in');
  t.S.sheet.close(); t.settle();
  t.doc.activeElement = t.doc.body; const [none] = key(false); assert.equal(none, false, 'no sheet: Tab is the browser\'s');
});

test('a sheet body that scrolls is a keyboard stop named by its title, and stops being one when it no longer scrolls (A11)', () => {
  let fire = null;
  const t = shell({ env: { watch: (node, fn) => { fire = fn; return () => { fire = null; }; } } });
  const d = t.S.sheet.open({ title: 'Alerts' }), b = d.querySelector('.sheet-b');
  assert.equal(b.getAttribute('tabindex'), null, 'short: no stop');
  Object.assign(b, { scrollHeight: 900, clientHeight: 400 }); fire();
  assert.equal(b.getAttribute('tabindex'), '0');
  assert.equal(b.getAttribute('role'), 'region');
  assert.equal(b.getAttribute('aria-labelledby'), d.getAttribute('aria-labelledby'));
  Object.assign(b, { scrollHeight: 300 }); fire();
  assert.equal(b.getAttribute('tabindex'), null);
  t.S.sheet.close(); assert.equal(fire, null, 'the watch ends with the sheet');
});

// ---------------- the tab list (B2) ----------------
const TABKEY = once(() => between(app, '// ==== TAB KEYBOARD BEGIN', '// ==== TAB KEYBOARD END ===='));
function strip(orientation, n = 3) {
  const doc = fakeDoc(), box = el(doc, 'nav', { role: 'tablist', 'aria-orientation': orientation }), log = [];
  const tabs = Array.from({ length: n }, (_, i) => { const b = el(doc, 'button', { role: 'tab', 'data-p': String(i) }, box); b.onclick = () => log.push(['click', i]); return b; });
  el(doc, 'div', { class: 'rsub', role: 'none' }, box); // the D rail's nested sub-pages are not page tabs
  const run = (key, at, mods = {}) => { const e = Object.assign({ key, target: tabs[at], currentTarget: box, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, mods);
    const r = vm.runInNewContext(TABKEY() + '\ntabKey(e)', { e }); return { r, e, focus: doc.activeElement }; };
  return { doc, box, tabs, log, run };
}

test('the tab strip is a tab list: arrows along it, Home and End show that tab and keep focus on it (B2)', () => {
  const s = strip('horizontal');
  let x = s.run('ArrowRight', 1); assert.deepEqual(s.log.pop(), ['click', 2]); assert.equal(x.focus, s.tabs[2]); assert.ok(x.e.defaultPrevented);
  x = s.run('ArrowLeft', 0); assert.deepEqual(s.log.pop(), ['click', 2], 'wraps');
  x = s.run('ArrowRight', 2); assert.deepEqual(s.log.pop(), ['click', 0], 'wraps');
  s.run('Home', 2); assert.deepEqual(s.log.pop(), ['click', 0]);
  s.run('End', 0); assert.deepEqual(s.log.pop(), ['click', 2]);
  for (const k of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', ' ']) assert.equal(s.run(k, 1).r, false, k + ' stays native in a row');
  for (const m of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.equal(s.run('ArrowRight', 1, { [m]: true }).r, false, m);
  const v = strip('vertical');
  v.run('ArrowDown', 0); assert.deepEqual(v.log.pop(), ['click', 1], 'the D rail is a column');
  assert.equal(v.run('ArrowRight', 0).r, false);
});

test('a tab the route rebuilt keeps the focus the arrow gave it', () => {
  const s = strip('horizontal');
  s.tabs[2].onclick = () => { s.box.removeChild(s.tabs[2]); const nb = el(s.doc, 'button', { role: 'tab', 'data-p': '2' }, s.box); s.tabs.rebuilt = nb; };
  const x = s.run('ArrowRight', 1);
  assert.equal(x.focus, s.tabs.rebuilt);
});

test('markup and wiring: one tab stop, selected state, panels, the skip link, a tab tap pushes and goes straight to its page', () => {
  assert.match(html, /<a class="skiplink" href="#pager" data-tv-skip>Skip to page content<\/a>\n<div id="app">/);
  assert.match(html, /<nav id="pgs" role="tablist" aria-label="Pages"><\/nav>/);
  assert.match(app, /aria-controls="'\+esc\(p\.id\)\+'" aria-selected="false" tabindex="-1" class="press" data-p=/);
  assert.match(app, /PAGES\.forEach\(p=>\{p\.setAttribute\('role','tabpanel'\);p\.setAttribute\('aria-labelledby','tab-'\+p\.dataset\.name\);p\.tabIndex=-1;/);
  const go = app.slice(app.indexOf('function go(raw,opt)'), app.indexOf("document.dispatchEvent(new CustomEvent('deck:route'"));
  assert.match(go, /b\.setAttribute\('aria-selected',on\?'true':'false'\);b\.tabIndex=on\?0:-1/);
  assert.match(go, /SVC\.navigate\(changed&&!!opt\.push&&routeEntries\(\)\)/);
  // the iPhone app and the TV view replace only, and their Back never changes the page (popstate)
  assert.match(app, /const routeEntries=\(\)=>!IN_SHELL&&!document\.documentElement\.classList\.contains\('tv'\);/);
  assert.match(app, /if\(routeEntries\(\)&&b\.route&&[^\n]*go\(b\.route\+linkQuery\(b\.params\),\{pop:true\}\);else SVC\.navigate\(false\)\}\);/);
  assert.match(app, /go\(pg\.dataset\.name,\{push:true\}\)\}return\}/);
  assert.doesNotMatch(app, /function goPage\(/, 'a tab shows its page at once: no scroll across the pages between');
  assert.match(app, /\$\('#pgs'\)\.addEventListener\('keydown',tabKey\)/);
  assert.match(app, /row\.addEventListener\('keydown',tabKey\)/);
});

// ---------------- the phone bars, by a layout probe (F1, F2) ----------------
// Geist's advance widths from the shipped woff2 (hmtx and cmap are stored untransformed), at the default weight; a medium label is
// about 2.5 % wider, so every width carries 4 % on top
const GEIST = (() => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'static', 'fonts', 'Geist-Variable.woff2'));
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
  let o = 48; const n = b.readUInt16BE(12), tabs = {};
  const u128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = b[o++]; v = v * 128 + (c & 127); if (!(c & 128)) return v; } return v; };
  const list = [];
  for (let i = 0; i < n; i++) { const f = b[o++]; let tag = KNOWN[f & 63]; if ((f & 63) === 63) { tag = b.toString('latin1', o, o + 4); o += 4; }
    const tv = (f >> 6) & 3, len = u128(); let tl = len; if (((tag === 'glyf' || tag === 'loca') && tv === 0) || (tag === 'hmtx' && tv === 1)) tl = u128(); list.push({ tag, tv, tl }); }
  const data = zlib.brotliDecompressSync(b.subarray(o, o + b.readUInt32BE(20)));
  let off = 0; for (const t of list) { tabs[t.tag] = { off, t }; off += t.tl; }
  assert.equal(tabs.hmtx.t.tv, 0, 'hmtx untransformed');
  const at = (tag) => data.subarray(tabs[tag].off, tabs[tag].off + tabs[tag].t.tl);
  const head = at('head'), hhea = at('hhea'), hmtx = at('hmtx'), cmap = at('cmap');
  const upm = head.readUInt16BE(18), nh = hhea.readUInt16BE(34);
  const n4 = (() => { for (let i = 0, k = cmap.readUInt16BE(2); i < k; i++) { const so = cmap.readUInt32BE(4 + i * 8 + 4); if (cmap.readUInt16BE(so) === 4) return so; } return -1; })();
  assert.ok(n4 >= 0, 'a format 4 cmap');
  const seg = cmap.readUInt16BE(n4 + 6) / 2, ends = n4 + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, offs = deltas + seg * 2;
  const gid = (c) => { for (let s = 0; s < seg; s++) { if (c > cmap.readUInt16BE(ends + s * 2)) continue; const st = cmap.readUInt16BE(starts + s * 2); if (c < st) return 0;
    const ro = cmap.readUInt16BE(offs + s * 2), d = cmap.readInt16BE(deltas + s * 2); if (!ro) return (c + d) & 0xffff;
    const g = cmap.readUInt16BE(offs + s * 2 + ro + (c - st) * 2); return g ? (g + d) & 0xffff : 0; } return 0; };
  const adv = (g) => hmtx.readUInt16BE(Math.min(g, nh - 1) * 4);
  return (s, px, ls = 0) => [...s].reduce((w, ch) => w + adv(gid(ch.codePointAt(0))) * px / upm + ls * px, 0) * 1.04;
})();
// a token's px at a width: clamp(MIN, A + Bvw, MAX) as tokens.css writes it
const step = (name, vw) => { const m = new RegExp('--' + name + ':clamp\\((\\d+)px, ([\\d.]+)px \\+ ([\\d.]+)vw, (\\d+)px\\)').exec(tokens); assert.ok(m, name);
  return Math.min(+m[4], Math.max(+m[1], +m[2] + +m[3] * vw / 100)); };
const pBlocks = ui.split('@media (max-width:599px){').slice(1).map((x) => x.split('\n}')[0]);
// the last P rule for a selector wins, as in the cascade
const rule = (blocks, sel) => { const b = [...blocks].reverse().find((x) => x.includes('\n  ' + sel + '{')); if (!b) return null; return new RegExp('\\n  ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(b)[1]; };
const prop = (r, p) => { const m = new RegExp('(?:^|;)' + p + ':([^;]*)').exec(r || ''); return m ? m[1] : null; };
const LABELS = [...html.matchAll(/<section class="page" id="pg-[a-z]+" data-name="[a-z]+" data-label="([^"]+)"/g)].map((m) => m[1]);

// World joined the bar on 2026-11-17: nine tabs. Every cell is 44 px or more wide and 62 px tall. From 396 px nine cells fill the bar (412 and
// 430 get 45.8 and 47.8 px); nine 44 px cells do not fit 390 (396 px), so under 396 px the bar scrolls and snaps, the cell is 1/8.5 of the
// width (a half cell of the next tab shows) and never under 44 px
test('F1 probe: at 360 to 430 the phone bar holds all nine tabs as 44 px cells, every label whole at the 13 px floor, two lines at most', () => {
  assert.equal(LABELS.length, 9, 'nine pages');
  const btn = rule(pBlocks, '#pgs button'), bar = rule(pBlocks, '#pgs');
  assert.ok(btn && bar, 'the P bar rules');
  assert.match(prop(bar, 'overflow-x') || '', /auto/, 'the bar scrolls sideways where nine 44 px cells do not fit');
  assert.match(ui, /@media \(max-width:1099px\),\(max-height:499px\)\{\n  #pgs\{scroll-snap-type:x proximity\}\n  #pgs button\{scroll-snap-align:start\}/, 'the strip snaps to a tab');
  assert.equal(prop(btn, 'flex'), '1 0 44px', 'a cell is 44 px or more and shares the spare width');
  assert.equal(prop(btn, 'min-width'), '44px', 'a cell is never under 44 px');
  const narrow = /@media \(max-width:(\d+)px\)\{#pgs button\{flex:0 0 max\(44px,calc\(\(100vw - var\(--safe-l\) - var\(--safe-r\)\) \/ ([\d.]+)\)\)\}\}/.exec(ui);
  assert.ok(narrow, 'a narrow rule: the cell is 1/8.5 of the width, 44 px at the least');
  const fill = +narrow[1] + 1, third = +narrow[2];
  assert.equal(fill, 396, 'nine 44 px cells fit from 396 px');
  for (const vw of [360, 375, 390, 412, 430]) {
    const cell = vw < fill ? Math.max(44, vw / third) : Math.max(44, vw / LABELS.length);
    assert.ok(cell >= 44, `${vw}: a 44 px wide, 62 px tall target (${cell.toFixed(1)})`);
    if (vw < fill) assert.ok(cell * LABELS.length > vw, `${vw}: the bar scrolls (${(cell * LABELS.length).toFixed(0)} px of cells in ${vw})`);
    if (vw === 375 || vw === 390) assert.ok(vw / cell % 1 > 0.3 && vw / cell % 1 < 0.7, `${vw}: about half a cell of the next tab peeks`);
    const px = /var\(--fs-micro\)/.test(prop(btn, 'font-size')) ? step('fs-micro', vw) : NaN;
    assert.ok(px >= 13, 'the 13 px floor');
    const pad = (prop(btn, 'padding') || '0 0').split(' ').map(parseFloat), side = pad.length > 1 ? pad[1] : pad[0];
    const room = cell - 2 * side, ls = /-\.01em/.test(prop(btn, 'letter-spacing') || '') ? -0.01 : 0;
    for (const label of LABELS) {
      const words = label.split(' ');
      for (const w of words) assert.ok(GEIST(w, px, ls) <= room, `${vw}: "${w}" ${GEIST(w, px, ls).toFixed(1)} px in a ${room.toFixed(1)} px cell`);
      assert.ok(words.length <= 2, label + ': two lines at most');
    }
    // the stack: top padding, the icon, the gap, two lines and the bottom padding fit the 62 px bar
    const icon = parseFloat(prop(rule(pBlocks, '#pgs button svg.i'), 'width')), lh = parseFloat(prop(btn, 'line-height'));
    const h = pad[0] + icon + parseFloat(prop(btn, 'gap')) + 2 * lh * px + (pad[2] !== undefined ? pad[2] : pad[0]);
    assert.ok(h <= 62, `${vw}: a two-line label is ${h.toFixed(1)} px tall in a 62 px bar`);
  }
  assert.match(tokens, /--tabbar-h:calc\(62px \+ var\(--safe-b\)\)/, 'the bar height is unchanged, so no page loses a pixel');
});

// L: the nine tabs fit the 908 px bar (World made the row 14 px too long and cut "Pad"); a tab is never under 44 px wide
test('L probe: the tabs take 6 px a side and are 44 px wide at the least, so all nine fit at 908 px', () => {
  const l = ui.split('@media (min-width:600px) and (max-height:499px){')[1].split('\n}')[0];
  assert.match(l, /\n  #pgs button\{padding:0 6px;min-width:var\(--hit\);font-size:var\(--fs-body\)\}/);
});

test('F2 probe: Home\'s six sub-tabs are whole equal cells of 44 px or more beside a "15 days" freshness mark at 390, 412 and 430', () => {
  const subs = [...html.matchAll(/data-name="home"[\s\S]*?<div class="seg subrow"[^>]*>([\s\S]*?)<\/div>/g)][0][1].match(/>([A-Z][a-z]+)</g).map((s) => s.slice(1, -1));
  assert.deepEqual(subs, ['House', 'Fleet', 'Cluster', 'Dev', 'Crons', 'Launch']);
  const SIX = '.phead .subrow:has(>button:nth-child(5):not([hidden]))';
  const btn = rule(pBlocks, SIX + '>button');
  assert.ok(btn, 'a rule for rows of five and more');
  assert.equal(prop(btn, 'flex'), '1 1 0', 'equal cells');
  assert.equal(prop(btn, 'padding'), '0');
  assert.match(rule(pBlocks, '.phead .subrow'), /overflow:hidden/, 'the row never scrolls');
  const floor = /@media \(max-width:(\d+)px\)\{\.phead \.subrow:has\(>button:nth-child\(5\):not\(\[hidden\]\)\)>button\{font-size:var\(--fs-micro\)\}\}/.exec(ui);
  assert.ok(floor, 'the 13 px floor below a width');
  const fresh = rule(pBlocks, '.phead:has(.subrow) .pact>.fresh');
  assert.ok(fresh, 'the mark beside sub-tabs is compact');
  const rem = (v) => ({ 'var(--s-1)': 4, 'var(--s-2)': 8 }[v.trim()] ?? parseFloat(v));
  for (const vw of [390, 412, 430]) {
    const meta = step('fs-meta', vw), px = vw <= +floor[1] ? step('fs-micro', vw) : meta;
    assert.ok(px >= 13);
    if (vw >= 430) assert.equal(px, meta, 'the owner\'s iPhone reads the meta step');
    // the mark is regular weight; an active sub-tab is medium, about 2 % wider than the default weight
    const mark = 2 * rem(prop(fresh, 'padding').split(' ')[1]) + 0.55 * meta + rem(prop(fresh, 'gap')) + GEIST('15 days', meta) / 1.04;
    const room = vw - 2 * 16 - rem(prop(rule(pBlocks, '.phead:has(.subrow)'), 'column-gap')) - mark;
    const cell = (room - 2) / subs.length; // the segment's own border
    assert.ok(cell >= 44, `${vw}: a ${cell.toFixed(1)} px target`);
    for (const s of subs) { const w = GEIST(s, px) / 1.04 * 1.025; assert.ok(w <= cell - 1, `${vw}: "${s}" ${w.toFixed(1)} px in a ${(cell - 1).toFixed(1)} px cell`); }
  }
});
