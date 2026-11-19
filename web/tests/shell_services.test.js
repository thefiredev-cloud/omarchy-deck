'use strict';
// Design v3 shell services (UiApi 1.3, 1.4): the sheet host and its focus, the Data sheet with and without a page's data(),
// the 30 s money hold and the three ways it drops, the status slot, and the document wiring by attribute.
// The services block runs against a small fake DOM; DeckUI and DeckPages are the real blocks from deck.js.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), deck = read('deck.js'), ui = read('ui.css');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i > 0 && j > i, a); return s.slice(i, j); };
const SERVICES = between(app, '// ==== SHELL SERVICES BEGIN', '// ==== SHELL SERVICES END ====');
const DeckUI = new Function(between(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const REGISTRY = between(deck, '// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');

// ---- a fake DOM: just enough elements, selectors, focus, events and <dialog> for the shell services
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function parseSel(sel) {
  const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i);
  if (!m) throw new Error('fake DOM cannot match ' + sel);
  return { tag: m[1].toUpperCase(), cls: [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]), attrs: [...m[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((x) => [x[1], x[2]]) };
}
class El {
  constructor(doc, tag) {
    Object.assign(this, { ownerDocument: doc, tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, dataset: {}, className: '', textContent: '', hidden: false, open: false, disabled: false, tabIndex: 0, id: '', listeners: {}, focusCount: 0, clicks: 0, _html: '' });
  }
  get classList() { const s = this; const list = () => s.className.split(/\s+/).filter(Boolean);
    return { contains: (c) => list().includes(c), add: (c) => { if (!list().includes(c)) s.className = list().concat(c).join(' '); }, remove: (c) => { s.className = list().filter((x) => x !== c).join(' '); }, toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; } }; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); if (k === 'open') this.open = true; if (k === 'id') this.id = String(v); }
  getAttribute(k) { if (k === 'id') return this.id || null; return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.body) return true; return false; }
  focus() { this.ownerDocument.activeElement = this; this.focusCount++; }
  click() { this.clicks++; this.ownerDocument.lastClick = this; }
  addEventListener(t, f, o) { (this.listeners[t] = this.listeners[t] || []).push({ f, once: !!(o && o.once) }); }
  dispatchEvent(e) { const ls = this.listeners[e.type] || []; this.listeners[e.type] = ls.filter((l) => !l.once); ls.forEach((l) => l.f(e)); return true; }
  showModal() { if (!this.isConnected) throw new Error('not connected'); this.open = true; const af = this.find((x) => 'autofocus' in x.attrs); if (af) af.focus(); }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
  getBoundingClientRect() { return { left: 0, right: 390, top: 400, bottom: 844, width: 390, height: 444 }; }
  find(fn) { for (const c of this.children) { if (fn(c)) return c; const d = c.find(fn); if (d) return d; } return null; }
  all(fn, out = []) { for (const c of this.children) { if (fn(c)) out.push(c); c.all(fn, out); } return out; }
  matches(sel) { const p = parseSel(sel); if (p.tag && p.tag !== this.tagName) return false;
    if (!p.cls.every((c) => this.classList.contains(c))) return false;
    return p.attrs.every(([k, v]) => { const a = this.getAttribute(k); return a !== null && (v === undefined || a === v); }); }
  closest(sel) { for (let n = this; n && n.matches; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { const parts = sel.trim().split(/\s+/), last = parts.pop();
    return this.all((x) => x.matches(last) && parts.every((p) => { for (let n = x.parentNode; n && n !== this.parentNode; n = n.parentNode) if (n.matches && n.matches(p)) return true; return false; })); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function fakeDoc() {
  const doc = { activeElement: null, events: [], createElement: (t) => new El(doc, t), dispatchEvent: (e) => { doc.events.push(e); return true; } };
  doc.body = new El(doc, 'body'); doc.getElementById = (id) => doc.body.find((x) => x.id === id);
  return doc;
}
class CE { constructor(type, o) { this.type = type; this.detail = o && o.detail; } }
const el = (doc, tag, attrs = {}, parent) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } (parent || doc.body).appendChild(e); return e; };
const click = (target, extra) => Object.assign({ type: 'click', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, extra || {});

// fake timers: run(ms) advances the clock and fires what is due
function clock() {
  let t = 1000, id = 0; const q = new Map();
  return { now: () => t, setT: (f, ms) => { q.set(++id, { f, at: t + ms }); return id; }, clearT: (i) => q.delete(i),
    run(ms) { const end = t + ms; for (;;) { const due = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; t = due[1].at; q.delete(due[0]); due[1].f(); } t = end; } };
}
// a browser history: push truncates forward entries; go() and the user's Back move later and fire popstate, as browsers do
function fakeHistory() {
  const h = { list: [null], i: 0, pending: [], S: null,
    push(s) { h.list = h.list.slice(0, h.i + 1).concat([s]); h.i++; },
    go(n) { h.pending.push(n); },
    back() { h.pending.push(-1); },
    get length() { return h.list.length; },
    deliver() { while (h.pending.length) { const n = h.pending.shift(); const j = Math.max(0, Math.min(h.list.length - 1, h.i + n)); if (j === h.i) continue; h.i = j; h.S.onPop({ state: h.list[j] }); } } };
  return h;
}
function setup(over = {}) {
  const doc = fakeDoc(), c = clock(), mem = {}, reloads = [], hist = fakeHistory();
  const tab = el(doc, 'button', { class: 'on' });
  let painted = 0;
  const pages = over.pages === undefined ? vm.runInNewContext(REGISTRY + '\nDeckPages;', { console: { error() {} }, setTimeout, clearTimeout, Promise, Date, document: undefined }) : over.pages;
  const env = Object.assign({ doc, CustomEvent: CE, now: c.now, setT: c.setT, clearT: c.clearT,
    store: { get: (k) => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = String(v); } },
    route: () => ({ route: 'realestate/residential', full: 'realestate/residential', label: 'Real estate \u00B7 Residential' }),
    pages: () => pages, ui: () => DeckUI, guest: () => false, tv: () => false, alwaysOn: () => false,
    ownerOk: () => Promise.resolve(true), paintStatus: () => { painted++; }, fallbackFocus: () => tab, reload: (o) => reloads.push(o),
    history: { push: (s) => hist.push(s), go: (n) => hist.go(n) } }, over.env || {});
  const S = vm.runInNewContext(SERVICES + '\nShellServices;', {})(env);
  hist.S = S;
  // let the task end: deferred history sync runs, then the browser delivers the moves it was asked for
  const settle = () => { for (let k = 0; k < 5; k++) { c.run(0); hist.deliver(); } };
  return { S, doc, c, mem, reloads, tab, pages, hist, settle, painted: () => painted, money: () => doc.events.filter((e) => e.type === 'deck:money').map((e) => e.detail.revealed) };
}
const tick = () => new Promise((r) => setImmediate(r));

// ---------------- Back closes a sheet (history) ----------------
test('system Back closes the open sheet and stays on the route; history ends where it started', () => {
  const t = setup(), opener = el(t.doc, 'button');
  const d = t.S.sheet.open({ title: 'Spot', opener });
  t.settle();
  assert.equal(t.hist.length, 2, 'one entry for the sheet');
  t.hist.back(); t.settle(); // Android Back, a TV browser Back, the desktop Back button
  assert.equal(d.isConnected, false);
  assert.equal(t.doc.activeElement, opener);
  assert.equal(t.hist.i, 0, 'still on the deck entry, nothing left behind');
  assert.equal(t.reloads.length, 0);
});

test('Close, Escape and a route change give the entry back, so history does not grow', () => {
  const t = setup();
  for (const how of ['close', 'escape', 'route']) {
    const d = t.S.sheet.open({ title: how });
    t.settle();
    assert.equal(t.hist.i, 1, how + ': entry pushed');
    if (how === 'close') t.S.sheet.close(); else if (how === 'escape') d.close(); else t.S.onRoute();
    t.settle();
    assert.equal(d.isConnected, false, how);
    assert.equal(t.hist.i, 0, how + ': back on the deck entry');
  }
  // the next open reuses the slot: the list never grows past one sheet entry
  t.S.sheet.open({ title: 'again' }); t.settle();
  assert.equal(t.hist.length, 2);
});

test('a sheet from a sheet is one level deeper: Back closes only the top; a page reopening its sheet costs no entry', () => {
  const t = setup();
  const a = t.S.sheet.open({ id: 'deal', title: 'Deal' }); t.settle();
  const b = t.S.sheet.open({ id: 'data', title: 'Data' }); t.settle();
  assert.equal(t.hist.i, 2);
  t.hist.back(); t.settle();
  assert.equal(b.isConnected, false);
  assert.ok(a.open, 'the deal sheet is still there');
  assert.equal(t.hist.i, 1);
  // close then open in one task (cre.js, realestate.js repaint this way): same level, no push, no pop
  t.S.sheet.close(); const c = t.S.sheet.open({ id: 'zip', title: 'ZIP' }); t.settle();
  assert.equal(t.hist.i, 1);
  assert.equal(t.hist.length, 3, 'the forward entry of the closed Data sheet is not reused as a second sheet entry');
  t.hist.back(); t.settle();
  assert.equal(c.isConnected, false);
  assert.equal(t.S.sheet.current(), null);
  assert.equal(t.hist.i, 0);
  // a route change with two levels open closes both and goes back two entries at once
  t.S.sheet.open({ id: 'a', title: 'A' }); t.S.sheet.open({ id: 'b', title: 'B' }); t.settle();
  assert.equal(t.hist.i, 2);
  t.S.onRoute(); t.settle();
  assert.equal(t.S.sheet.current(), null);
  assert.equal(t.hist.i, 0);
});

test('Back and a UI close for the same press never close two levels', () => {
  const t = setup();
  const a = t.S.sheet.open({ id: 'a', title: 'A' }); t.S.sheet.open({ id: 'b', title: 'B' }); t.settle();
  t.S.sheet.close(); // the remote's Back key closed the top through the UI
  t.hist.back(); t.hist.deliver(); // and the browser also took the press as history Back, before the shell's own sync ran
  t.settle();
  assert.ok(a.open, 'the lower sheet stays');
  assert.equal(t.S.sheet.current(), a);
  assert.equal(t.hist.i, 1);
});

// ---------------- sheet host ----------------
test('a sheet opens as a dialog with focus on its title and returns focus to the opener on close', () => {
  const { S, doc } = setup();
  const opener = el(doc, 'button', { class: 'frow', 'data-open': 'zip' });
  opener.focus();
  const d = S.sheet.open({ id: 'zip', title: '92647', sub: 'Huntington Beach', body: '<p>Body</p>', actions: '<button class="btn">Find homes</button>', wide: true });
  assert.equal(d.tagName, 'DIALOG');
  assert.ok(d.open && d.isConnected, 'open and in the document');
  assert.ok(d.classList.contains('sheet') && d.classList.contains('wide'));
  assert.equal(d.dataset.id, 'zip');
  const h = d.querySelector('.sheet-h h2');
  assert.equal(h.textContent, '92647');
  assert.equal(doc.activeElement, h, 'focus lands on the title, not on Close (critique 14)');
  assert.equal(h.tabIndex, -1, 'the title takes focus without joining the tab order');
  assert.equal(d.getAttribute('aria-labelledby'), h.id);
  assert.equal(d.querySelector('.sheet-h p').textContent, 'Huntington Beach');
  assert.equal(d.querySelector('.sheet-b').innerHTML, '<p>Body</p>');
  assert.match(d.querySelector('.sheet-a').innerHTML, /Find homes/);
  assert.equal(d.querySelector('.sheet-x').getAttribute('aria-label'), 'Close');
  assert.equal(S.sheet.close(), true);
  assert.equal(d.isConnected, false, 'the dialog leaves the document');
  assert.equal(doc.activeElement, opener, 'focus is back on the row that opened it');
  assert.equal(S.sheet.close(), false, 'closing twice is harmless');
});

test('Escape or TV Back (a native dialog close) also removes the sheet and returns focus', () => {
  const { S, doc } = setup();
  const opener = el(doc, 'button');
  const d = S.sheet.open({ title: 'Spot', opener });
  d.close(); // what the browser does on Escape and what tv.js does on Back
  assert.equal(d.isConnected, false);
  assert.equal(doc.activeElement, opener);
  assert.equal(S.sheet.current(), null);
});

test('a sheet opened from a sheet stacks one level deeper; Close returns to the sheet below and its button', () => {
  const { S, doc, tab } = setup();
  const opener = el(doc, 'button');
  const a = S.sheet.open({ id: 'deal', title: 'Deal', opener, actions: '<button data-sheet="data">Data</button>' });
  const dataBtn = el(doc, 'button', { 'data-sheet': 'data' }, a);
  const b = S.sheet.open({ id: 'data', title: 'Data', opener: dataBtn });
  assert.ok(a.open && a.isConnected, 'the first sheet stays under the second');
  assert.equal(S.sheet.current(), b);
  S.sheet.close();
  assert.equal(doc.activeElement, dataBtn, 'back on the Data button inside the first sheet');
  assert.equal(S.sheet.current(), a);
  S.sheet.close();
  assert.equal(doc.activeElement, opener);
  // an opener that left the page sends focus to the active tab instead of nowhere
  const gone = el(doc, 'button');
  S.sheet.open({ title: 'X', opener: gone });
  doc.body.removeChild(gone);
  S.sheet.close();
  assert.equal(doc.activeElement, tab);
});

test('opening the id that is on top repaints it in place: same level, same opener, the old element reads as closed', () => {
  const { S, doc } = setup();
  const opener = el(doc, 'button');
  const a = S.sheet.open({ id: 'deal', title: 'Deal 1', opener });
  const b = S.sheet.open({ id: 'deal', title: 'Deal 1, in compare' });
  assert.equal(a.isConnected, false);
  assert.ok(!a.open);
  assert.equal(S.sheet.current(), b);
  S.sheet.close();
  assert.equal(S.sheet.current(), null, 'one close empties it');
  assert.equal(doc.activeElement, opener);
});

test('the data option adds one Data button; a detail() sheet that has one keeps exactly one', () => {
  const { S } = setup();
  const d = S.sheet.open({ title: 'ZIP', data: 'zip:92647' });
  assert.match(d.querySelector('.sheet-a').innerHTML, /<button type="button" class="btn" data-sheet="data" data-scope="zip:92647">Data<\/button>/);
  const det = DeckUI.detail({ title: 'ZIP', body: 'b', scope: 'zip:92647' });
  const e = S.sheet.open(Object.assign({ data: true }, det));
  assert.equal((e.querySelector('.sheet-a').innerHTML.match(/data-sheet="data"/g) || []).length, 1);
  const f = S.sheet.open({ title: 'Plain' });
  assert.equal(f.querySelector('.sheet-a'), null, 'no empty action bar');
  assert.equal(f.querySelector('.sheet-h p').hidden, true, 'no empty sub line');
});

// ---------------- Data sheet ----------------
test('the Data sheet draws the page data() for the route and the scope, with the Display section', () => {
  const t = setup();
  let seen = null;
  t.pages.register('realestate/residential', { show() {}, data(ctx, scope) { seen = [ctx.route, scope]; return { sources: [{ name: 'Zillow Home Value Index', gives: '26,265 ZIPs', asOf: '2026-09', state: 'ok' }], method: [['Gross rent yield', 'Higher is better']] }; } });
  const d = t.S.sheet.data('zip:92647');
  assert.deepEqual(seen, ['realestate/residential', 'zip:92647']);
  assert.equal(d.querySelector('.sheet-h h2').textContent, 'Data');
  assert.equal(d.querySelector('.sheet-h p').textContent, 'Real estate \u00B7 Residential \u00B7 92647');
  const body = d.querySelector('.sheet-b').innerHTML;
  assert.match(body, /Zillow Home Value Index/);
  assert.match(body, /Sep 2026/);
  assert.match(body, /data-display="tv"/);
  assert.match(body, /data-display="always-on"/);
  assert.match(body, /data-display="units"/);
});

test('a page without data() gets a plain, honest Data sheet, never four empty sections', () => {
  const t = setup();
  t.pages.register('realestate/residential', { show() {} });
  const body = t.S.sheet.data('').querySelector('.sheet-b').innerHTML;
  assert.match(body, /This page does not list its sources yet\./);
  assert.doesNotMatch(body, /No sources listed|No blended numbers|Nothing to explain/);
  assert.match(body, /<h3>Display<\/h3>/, 'the Display toggles are still there');
  // no registry at all (an old page before deck.js loaded) reads the same
  const u = setup({ pages: null });
  assert.match(u.S.sheet.data().querySelector('.sheet-b').innerHTML, /does not list its sources yet/);
});

test('a data() that throws says so; one that returns a promise fills in when it answers', async () => {
  const t = setup();
  t.pages.register('realestate/residential', { show() {}, data() { throw new Error('boom'); } });
  assert.match(t.S.sheet.data().querySelector('.sheet-b').innerHTML, /could not list its sources/);
  t.pages.register('realestate/residential', { show() {}, data: () => Promise.resolve({ sources: [{ name: 'Census ACS', asOf: '2024', state: 'stale' }] }) });
  const d = t.S.sheet.data();
  assert.match(d.querySelector('.sheet-b').innerHTML, /Reading the sources/);
  await tick();
  assert.match(d.querySelector('.sheet-b').innerHTML, /Census ACS/);
  assert.match(d.querySelector('.sheet-b').innerHTML, /Out of date/);
});

test('a guest gets data() only from pages open to guests', () => {
  const t = setup({ env: { guest: () => true } });
  t.pages.register('realestate/residential', { show() {}, data: () => ({ sources: [{ name: 'Owner feed' }] }) });
  assert.doesNotMatch(t.S.sheet.data().querySelector('.sheet-b').innerHTML, /Owner feed/);
});

test('Display: units are stored and announced; TV view and Always-on reload the same route', () => {
  const t = setup();
  const d = t.S.sheet.data();
  const seg = el(t.doc, 'div', { class: 'seg' }, d.querySelector('.sheet-b'));
  const us = el(t.doc, 'button', { 'data-display': 'units', 'data-v': 'us', class: 'on' }, seg);
  const metric = el(t.doc, 'button', { 'data-display': 'units', 'data-v': 'metric' }, seg);
  assert.ok(t.S.onClick(click(metric)));
  assert.equal(t.mem.units, 'metric');
  assert.equal(t.S.units(), 'metric');
  assert.ok(metric.classList.contains('on') && !us.classList.contains('on'));
  assert.equal(metric.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(t.doc.events.filter((e) => e.type === 'deck:units').map((e) => e.detail.units), ['metric']);
  const tv = el(t.doc, 'input', { 'data-display': 'tv' }, d); tv.checked = true;
  assert.ok(t.S.onChange({ target: tv }));
  const ao = el(t.doc, 'input', { 'data-display': 'always-on' }, d); ao.checked = false;
  assert.ok(t.S.onChange({ target: ao }));
  assert.equal(t.mem.alwaysOn, '0');
  assert.deepEqual(JSON.parse(JSON.stringify(t.reloads)), [{ view: 'tv' }, {}]);
});

test('a section scope opens the Data sheet on that section; a record scope stays at the top', () => {
  // the fake DOM has no layout and no parsed innerHTML, so the scroll itself is pinned on the source and the heading lookup rule
  assert.match(app, /function section\(dlg,sc\)\{if\(!sc\|\|sc\.indexOf\(':'\)>=0\)return/);
  assert.match(app, /const want=sc\.trim\(\)\.toLowerCase\(\),heads=b\.querySelectorAll\('\.sh-sec>h3'\)/);
  assert.match(app, /for\(const h of heads\)if\(h\.textContent\.trim\(\)\.toLowerCase\(\)===want\)\{h\.scrollIntoView\(\{block:'start'\}\);return\}/);
  assert.match(app, /if\(!pend\)section\(dlg,sc\);/, 'on an open sheet');
  assert.match(app, /if\(b\)b\.innerHTML=dataBody\(d,env\.ui\(\),disp\);section\(dlg,sc\)\}/, 'and on the promise answer');
  const t = setup();
  t.pages.register('realestate/residential', { show() {}, data: () => ({ sources: [{ name: 'Zillow' }], setup: [{ name: 'eBay', state: 'needs_key' }] }) });
  assert.equal(t.S.sheet.data('setup').querySelector('.sheet-h p').textContent, 'Real estate \u00B7 Residential \u00B7 setup', 'the sub line keeps the word');
  assert.equal(t.S.sheet.data('zip:92647').querySelector('.sheet-h p').textContent, 'Real estate \u00B7 Residential \u00B7 92647');
});

// ---------------- money ----------------
test('Show amounts holds for 30 s, then the amounts drop on their own', async () => {
  const t = setup();
  assert.equal(t.S.money.revealed(), false, 'hidden by default');
  assert.equal(await t.S.money.reveal(), true);
  assert.equal(t.S.money.revealed(), true);
  assert.equal(t.S.money.until(), t.c.now() + 30000);
  t.c.run(29999);
  assert.equal(t.S.money.revealed(), true);
  t.c.run(1);
  assert.equal(t.S.money.revealed(), false);
  assert.deepEqual(t.money(), [true, false]);
  assert.equal(t.doc.events.at(-1).detail.why, 'time');
});

test('a second Show amounts restarts the hold; it never stacks past 30 s from the last tap', async () => {
  const t = setup();
  await t.S.money.reveal(); t.c.run(20000);
  await t.S.money.reveal(); t.c.run(20000);
  assert.equal(t.S.money.revealed(), true);
  t.c.run(10000);
  assert.equal(t.S.money.revealed(), false);
  assert.deepEqual(t.money(), [true, false], 'one reveal event, one drop');
});

test('the amounts drop at once on Hide, on a route change and when the page is hidden', async () => {
  for (const [why, act] of [['hide', (t) => t.S.onClick(click(el(t.doc, 'button', { 'data-money': 'hide' })))], ['route', (t) => t.S.onRoute()], ['hidden', (t) => t.S.onHidden()]]) {
    const t = setup();
    await t.S.money.reveal();
    act(t);
    assert.equal(t.S.money.revealed(), false, why);
    assert.equal(t.doc.events.at(-1).detail.why, why);
    t.c.run(60000);
    assert.deepEqual(t.money(), [true, false], why + ': no second drop from the old timer');
  }
});

test('only the owner reveals; a route change while the check is out cancels it', async () => {
  const t = setup({ env: { ownerOk: () => Promise.resolve(false) } });
  assert.equal(await t.S.money.reveal(), false);
  assert.deepEqual(t.money(), []);
  let answer; const u = setup({ env: { ownerOk: () => new Promise((r) => { answer = r; }) } });
  const p = u.S.money.reveal();
  u.S.onRoute();
  answer(true);
  assert.equal(await p, false);
  assert.equal(u.S.money.revealed(), false);
  // the button wiring: data-money="show" asks for the reveal
  const w = setup();
  assert.ok(w.S.onClick(click(el(w.doc, 'button', { 'data-money': 'show' }))));
  await tick();
  assert.equal(w.S.money.revealed(), true);
});

// ---------------- status ----------------
test('the status slot shows one mark and at most two words; offline wins, then the page, then a host reply, then weather', () => {
  const t = setup();
  assert.deepEqual({ ...t.S.slot({ weather: '64°F' }) }, { k: '', word: '64°F', title: '64°F', label: '64°F. Open the status' });
  assert.equal(t.S.slot({ err: 'PC: That did not go through' }).word, 'Not sent');
  const s = t.S.status({ k: 'warn', word: 'Not sent to the printer', detail: 'The printer did not answer.' });
  assert.equal(s.word, 'Not sent', 'never a sentence in the bar');
  assert.equal(t.painted(), 1, 'the bar repaints');
  const sl = t.S.slot({ err: 'PC: That did not go through', weather: '64°F' });
  assert.equal(sl.k, 'warn');
  assert.equal(sl.title, 'The printer did not answer.');
  assert.equal(t.S.slot({ offline: true }).word, 'Offline');
  t.S.onRoute();
  assert.equal(t.S.slot({ weather: '64°F' }).word, '64°F', 'a page status leaves with its page');
  t.S.status({ k: 'bad', word: 'Failed' });
  assert.equal(t.S.status(null), null);
  assert.equal(t.S.slot({}).word, '');
  assert.equal(t.S.status({ k: 'bad', word: '   ' }), null, 'no word, no status');
});

test('the status slot is named by the words it shows, the detail after them (SeeAccess A4: voice control says "Not sent")', () => {
  const t = setup();
  const starts = (sl) => assert.ok(sl.label.startsWith(sl.word || 'Status'), JSON.stringify(sl));
  const err = t.S.slot({ err: 'PC: That did not go through' });
  assert.equal(err.label, 'Not sent. PC: That did not go through. Open the details');
  starts(err);
  starts(t.S.slot({ offline: true }));
  assert.equal(t.S.slot({ offline: true }).label, 'Offline. The deck server did not answer. Open the details');
  starts(t.S.slot({ weather: '64°F · Wind W 8 mph' }));
  assert.equal(t.S.slot({}).label, 'Status', 'an empty slot keeps a name');
  t.S.status({ k: 'warn', word: 'Not sent to the printer', detail: 'The printer did not answer.' });
  const pg = t.S.slot({ weather: '64°F' });
  assert.equal(pg.label, 'Not sent. The printer did not answer. Open the details');
  starts(pg);
  t.S.status({ k: 'bad', word: 'Failed' });
  assert.equal(t.S.slot({}).label, 'Failed. Open the details', 'no detail, no repeat');
  // the static markup names the button by its own text until the first paint
  const html = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
  assert.match(html, /<button type="button" id="status"><i class="sd"><\/i><span id="st">connecting<\/span><\/button>/);
});

test('the full status message opens in a sheet', () => {
  const t = setup();
  t.S.status({ k: 'bad', word: 'Not sent', detail: 'That did not go through: the Pad link is down.' });
  const body = t.S.statusSheet({ err: 'PC: Timed out', weather: '64°F · Wind W 8 mph' }).querySelector('.sheet-b').innerHTML;
  assert.match(body, /the Pad link is down/);
  assert.match(body, /PC: Timed out/);
  assert.match(body, /Wind W 8 mph/);
  t.S.status(null);
  assert.match(t.S.statusSheet({}).querySelector('.sheet-b').innerHTML, /All clear/);
});

test('the status never wraps the bar: the slot is capped, nowrap and clipped, and the bar never wraps', () => {
  const block = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  const rule = (sel) => (block.match(new RegExp('(^|\\n)' + sel.replace(/[#.]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[2] || '';
  assert.match(rule('#status'), /white-space:nowrap/);
  assert.match(rule('#status'), /overflow:hidden/);
  assert.match(rule('#status'), /max-width:9rem/);
  assert.match(block, /#top\{flex-wrap:nowrap\}/);
  assert.match(block, /#status:not\(\.bad\):not\(\.warn\)>\.sd\{display:none\}/, 'a warn status shows its mark too');
});

// ---------------- wiring by attribute ----------------
test('[data-sheet="data"] opens the Data sheet for its scope and gives focus back to the button', () => {
  const t = setup();
  let scope = null;
  t.pages.register('realestate/residential', { show() {}, data(c, s) { scope = s; return null; } });
  const btn = el(t.doc, 'button', { 'data-sheet': 'data', 'data-scope': 'zip:92647' });
  const inner = el(t.doc, 'span', {}, btn);
  assert.ok(t.S.onClick(click(inner)));
  assert.equal(scope, 'zip:92647');
  t.S.sheet.close();
  assert.equal(t.doc.activeElement, btn);
});

test('[data-close] closes the shell sheet, or the page dialog it sits in; a backdrop tap closes too', () => {
  const t = setup();
  const d = t.S.sheet.open({ title: 'A', actions: '' });
  assert.ok(t.S.onClick(click(d.querySelector('.sheet-x'))));
  assert.equal(d.isConnected, false);
  // a page-owned filter sheet: [data-open-fbar] opens #fb-<id>, focus goes to its title, [data-close] closes it, focus returns
  const fbar = el(t.doc, 'div', { class: 'fbar' });
  const openBtn = el(t.doc, 'button', { 'data-open-fbar': 'res' }, fbar);
  const panel = el(t.doc, 'dialog', { class: 'sheet fbar-panel', id: 'fb-res' }, fbar);
  const head = el(t.doc, 'header', { class: 'sheet-h' }, panel);
  const h2 = el(t.doc, 'h2', {}, el(t.doc, 'div', {}, head));
  const show = el(t.doc, 'button', { class: 'btn btn-primary', 'data-close': '' }, el(t.doc, 'footer', { class: 'sheet-a' }, panel));
  assert.ok(t.S.onClick(click(openBtn)));
  assert.ok(panel.open);
  assert.equal(t.doc.activeElement, h2);
  assert.ok(t.S.onClick(click(show)));
  assert.equal(panel.open, false);
  assert.equal(t.doc.activeElement, openBtn);
  assert.ok(panel.isConnected, 'a page dialog stays in the page');
  // backdrop: a tap on the dialog element outside its box
  const s = t.S.sheet.open({ title: 'B' });
  assert.equal(t.S.onClick(click(s, { clientX: 100, clientY: 100 })), true);
  assert.equal(s.isConnected, false);
  const s2 = t.S.sheet.open({ title: 'C' });
  assert.equal(t.S.onClick(click(s2, { clientX: 100, clientY: 500 })), false, 'a tap inside the sheet padding is not a backdrop tap');
  assert.ok(s2.open);
});

test('Enter on a focused tr[data-open] clicks it; Enter elsewhere is left alone', () => {
  const t = setup();
  const tr = el(t.doc, 'tr', { tabindex: '0', 'data-open': 'zip', 'data-key': '92647' });
  const e = { key: 'Enter', target: tr, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  assert.ok(t.S.onKey(e));
  assert.equal(tr.clicks, 1);
  assert.ok(e.defaultPrevented);
  const input = el(t.doc, 'input', {}, tr);
  assert.equal(t.S.onKey({ key: 'Enter', target: input, preventDefault() {} }), false, 'typing in a field inside a row');
  assert.equal(t.S.onKey({ key: ' ', target: tr, preventDefault() {} }), false);
});

test('[data-retry] asks the page on screen to read again, once, unless the page handled the tap itself', () => {
  const t = setup(); const log = [];
  t.pages.register('realestate/residential', { show: () => log.push('show'), refresh: (c, tick) => log.push('refresh:' + tick + ':' + c.route) });
  const btn = el(t.doc, 'button', { class: 'btn btn-sm', 'data-retry': 'realestate' });
  btn.textContent = 'Try again';
  assert.ok(t.S.onClick(click(btn)));
  assert.deepEqual(log, ['refresh:false:realestate/residential']);
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Trying\u2026');
  t.c.run(6000);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Try again');
  const handled = click(btn); handled.preventDefault();
  assert.equal(t.S.onClick(handled), false);
  const old = el(t.doc, 'button', { class: 'b es-retry', 'data-retry': 'fleet' });
  assert.equal(t.S.onClick(click(old)), false, 'the old empty-state retry stays with deck.js');
  assert.equal(log.length, 1);
});

test('app.js exposes the services on DeckShell and drops money on route change and on a hidden page', () => {
  assert.match(app, /sheet:SVC\.sheet,status:o=>SVC\.status\(o\),money:SVC\.money/);
  const go = app.slice(app.indexOf('function go(raw,opt)'), app.indexOf("document.dispatchEvent(new CustomEvent('deck:route'"));
  assert.match(go, /if\(changed\)\{[^}]*SVC\.onRoute\(\)/);
  assert.match(app, /if\(document\.hidden\)\{saveScroll\(\);if\(SVC\)SVC\.onHidden\(\);return\}/);
  assert.match(app, /document\.addEventListener\('click',e=>\{if\(SVC\.onClick\(e\)\)/);
  assert.match(app, /document\.addEventListener\('keydown',e=>SVC\.onKey\(e\)\)/);
  assert.match(app, /addEventListener\('popstate',e=>\{if\(SVC\.onPop\(e\)<0\)return;/);
  assert.match(app, /history:\{push:\(s,u\)=>\{try\{history\.pushState\(s,'',u\)/);
});

// ---------------- the keyboard sheet (L18, 2026-11-17: the D keyboard map existed but nothing on screen said so) ----------------
test('the keyboard sheet lists every shortcut, names the number keys by their pages, and opens from the Data sheet on a keyboard class', () => {
  const tabs = ['Today', 'Home', 'Real estate', 'Surf', 'Shop', 'Money', 'Work', 'Pad'];
  const t = setup({ env: { keyboard: () => true, tabs: () => tabs } }), opener = el(t.doc, 'button');
  const d = t.S.keys(opener);
  assert.equal(d.dataset.id, 'keys');
  const body = d.querySelector('.sheet-b').innerHTML;
  for (const k of ['[', ']', '{', '}', '/', 'j', 'k', 'Enter', 'Esc', '?']) assert.match(body, new RegExp('<kbd>' + k.replace(/[[\]{}/?]/g, '\\$&') + '</kbd>'), k);
  assert.match(body, /1 Today, 2 Home, 3 Real estate, 4 Surf, 5 Shop, 6 Money, 7 Work, 8 Pad/);
  assert.match(body, /<kbd>1<\/kbd> to <kbd>8<\/kbd>/);
  assert.doesNotMatch(body, /\u2014/, 'no em dash');
  // the Data sheet's Display section carries a Keyboard row on a keyboard class only, and its button opens the sheet
  const data = t.S.sheet.data('', opener);
  const btn = data.querySelector('.sheet-b').innerHTML;
  assert.match(btn, /<span>Keyboard shortcuts<\/span><button type="button" class="btn btn-sm" data-keys>Show<\/button>/);
  const b = el(t.doc, 'button', { 'data-keys': '' }, data);
  assert.equal(t.S.onClick(click(b)), true);
  assert.equal(t.S.sheet.current().dataset.id, 'keys', 'stacked over the Data sheet');
  const touch = setup({ env: { keyboard: () => false } });
  assert.doesNotMatch(touch.S.sheet.data('', el(touch.doc, 'button')).querySelector('.sheet-b').innerHTML, /data-keys/, 'a touch class has no keyboard row');
  assert.doesNotMatch(DeckUI.dataSheet({ display: { units: 'us' } }), /data-keys/, 'and the pure sheet adds it only when asked');
});

test('app.js: ? opens the keyboard sheet on D and XL, the services know the class and the tab labels', () => {
  assert.match(app, /if\(a\.help\)\{e\.preventDefault\(\);SVC\.keys\(document\.activeElement\);return\}/);
  assert.match(app, /keyboard:\(\)=>dclass==='D'\|\|dclass==='XL',tabs:\(\)=>PAGES\.map\(p=>p\.dataset\.label\|\|p\.dataset\.name\)/);
  assert.match(ui, /\.kv\.keys kbd\{/);
});
