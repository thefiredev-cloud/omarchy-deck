// The balancer after Show more (layout wave 3, 2026-11-15): the plan is made from closed heights. A block open beyond its default
// carries data-bal-open and plans with the height it had closed (DeckUI.balanceHeights, remembered per box and block key), so opening
// or closing a list, or a repaint while it is open, moves no block to another column. Show fewer exists wherever Show more is.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const deck = read('deck.js');
const D = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const agents = read('agents.js');
const { A, L } = new Function('DeckUI', cut(agents, '// ==== AGENTS UI HELPERS BEGIN', '// ==== AGENTS UI HELPERS END ====') + '\nreturn {A: AgentsUI, L: LaunchUI};')(D);
const I = new Function('DeckUI', cut(read('invest.js'), '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(D);

// ---- a small DOM: enough of Element for DeckBalance.run (children, classes, attributes, closest, heights) ----
let COLS = 3, DC = 'XL', SCROLLED = [];
class El {
  constructor(o) { o = o || {}; this.nodeType = 1; this.children = []; this.parentElement = null; this.id = o.id || ''; this.dataset = Object.assign({}, o.data);
    this.attrs = new Map(Object.entries(o.attrs || {})); this.cls = new Set(o.cls || []); this.h = o.h || 0; this.top = o.top || 0;
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c),
      toggle: (c, f) => ((f === undefined ? !this.cls.has(c) : f) ? this.cls.add(c) : this.cls.delete(c)) };
    (o.kids || []).forEach((k) => this.appendChild(k)); }
  set className(v) { this.cls = new Set(String(v).split(' ').filter(Boolean)); }
  get offsetHeight() { return this.h; }
  get clientWidth() { return 1800; }
  get isConnected() { let e = this; while (e.parentElement) e = e.parentElement; return e === ROOT; }
  appendChild(e) { if (e.parentElement) e.remove(); e.parentElement = this; this.children.push(e); return e; }
  remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
  hasAttribute(a) { return this.attrs.has(a); }
  getAttribute(a) { return this.attrs.has(a) ? this.attrs.get(a) : null; }
  setAttribute(a, v) { this.attrs.set(a, v); }
  removeAttribute(a) { this.attrs.delete(a); }
  matches(s) { return s === '[id]' ? !!this.id : /^\.[\w-]+$/.test(s) ? this.cls.has(s.slice(1)) : /^\[[\w-]+\]$/.test(s) ? this.attrs.has(s.slice(1, -1)) : false; }
  closest(s) { for (let e = this; e; e = e.parentElement) if (e.matches(s)) return e; return null; }
  querySelectorAll(s) { const out = []; const walk = (e) => e.children.forEach((x) => { if (x.matches(s)) out.push(x); walk(x); }); walk(this); return out; }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  getBoundingClientRect() { return { top: this.top }; }
  scrollIntoView(o) { SCROLLED.push([this, o]); }
}
const ROOT = new El();
const HTML = new El();
Object.defineProperty(HTML, 'dataset', { get: () => ({ dc: DC }) });
const documentStub = { documentElement: HTML, addEventListener() {}, createElement: () => new El() };
const B = new Function('document', 'getComputedStyle', 'innerWidth', 'DeckUI',
  cut(deck, 'const DeckBalance=(()=>{', '// Today\'s flow opts in to DeckBalance') + '\nreturn DeckBalance;')(
  documentStub, (e) => (e === documentStub.documentElement ? { scrollPaddingTop: '80px' } : { columnWidth: 'auto', columnCount: String(COLS), columnGap: '0' }), 1920, D);

// a page: an element with an id holding one balanced box of sections (height, key, open)
function page(id, boxId, blocks) {
  const old = ROOT.children.find((x) => x.id === id); if (old) old.remove();
  const sects = blocks.map((b) => new El({ h: b.h, data: b.k ? { k: b.k } : {}, attrs: b.open ? { 'data-bal-open': '' } : {}, cls: ['sect'],
    kids: [new El({ cls: ['secttl'], top: b.top || 0 })].concat(b.inner ? [new El({ attrs: { 'data-bal-open': '' } })] : []) }));
  const box = new El({ id: boxId, attrs: { 'data-balance': '' }, kids: sects });
  ROOT.appendChild(new El({ id, kids: [box] }));
  B.run(box);
  return { box, sects };
}
// the column of every block, in block order, and each column's height
const where = ({ box, sects }) => sects.map((s) => box.children.filter((c) => c.cls.has('bal-col')).findIndex((c) => c.children.includes(s)));
const ends = ({ box }) => box.children.filter((c) => c.cls.has('bal-col')).map((c) => c.children.reduce((s, x) => s + x.h, 0));

// Money > Markets at 1920 (three columns): Markets, Watchlist, Catalysts, Headlines, Movers; Headlines from 6 rows to 18
const MK = [560, 980, 520, 520, 400], HL = 3, OPEN = 1300;
const mk = (open, at) => page('pg-money-markets', '', MK.map((h, i) => ({ h: i === at && open ? OPEN : h, open: i === at && open })));

test('planner input: an open block plans with the height it last had closed, so its plan is the closed plan', () => {
  const mem = {}, view = '1920 XL 3', closed = MK.map((h, i) => ({ k: '#' + i, h }));
  const a = D.balanceHeights(mem, view, closed);
  assert.deepEqual(a, MK);
  const opened = closed.map((b, i) => (i === HL ? { k: b.k, h: OPEN, open: true } : b));
  const b = D.balanceHeights(mem, view, opened);
  assert.deepEqual(b, MK, 'Headlines open plans at its closed 520');
  assert.deepEqual(D.balanceColumns(b, 3), D.balanceColumns(a, 3));
  assert.notDeepEqual(D.balanceColumns(opened.map((x) => x.h), 3), D.balanceColumns(a, 3), 'planned at the open height, a block would move');
  // a repaint while open: the same memory, the same answer; Show fewer: measured again
  assert.deepEqual(D.balanceHeights(mem, view, opened), MK);
  assert.deepEqual(D.balanceHeights(mem, view, closed), MK);
  // a resize, a rotation or another block set plans afresh from what is measured; an open block with nothing remembered uses its own height
  assert.equal(D.balanceHeights(mem, '1440 D 3', opened)[HL], OPEN);
  assert.equal(D.balanceHeights({}, view, opened)[HL], OPEN);
  assert.equal(D.balanceHeights(mem, view, opened.slice(1)).length, 4);
  assert.equal(D.balanceHeights(mem, view, opened)[HL], OPEN, 'memory was reset by the other set; the open block is measured');
});

test('DeckBalance: Show more, a repaint that rebuilds the box while open and Show fewer keep every block in its column', () => {
  COLS = 3; DC = 'XL';
  const fresh = mk(false), before = where(fresh), endsBefore = ends(fresh);
  assert.equal(new Set(before).size, 3, 'three columns');
  // Show more on Headlines: the page repaints with Headlines open beyond its first page
  const open = mk(true, HL);
  assert.deepEqual(where(open), before, 'nothing moves on the tap');
  assert.equal(ends(open)[before[HL]] - endsBefore[before[HL]], OPEN - MK[HL], 'the open list only pushes down its own column');
  // the poll repaints while it is open: a new box, new sections, the same columns
  assert.deepEqual(where(mk(true, HL)), before);
  // Show fewer: the fresh load, to the pixel
  const fewer = mk(false);
  assert.deepEqual(where(fewer), before);
  assert.deepEqual(ends(fewer), endsBefore);
});

test('DeckBalance: a first load, a new column count and a new device class plan afresh from measured heights', () => {
  DC = 'XL'; COLS = 3;
  const first = page('pg-fresh', '', MK.map((h, i) => ({ h: i === HL ? OPEN : h, open: i === HL })));
  const plan = D.balanceColumns(MK.map((h, i) => (i === HL ? OPEN : h)), 3);
  assert.deepEqual(where(first), plan, 'no memory: planned with the open height');
  COLS = 2;
  const two = mk(true, HL);
  assert.deepEqual(where(two), D.balanceColumns(MK.map((h, i) => (i === HL ? OPEN : h)), 2), 'two columns: afresh');
  COLS = 3; DC = 'D';
  assert.deepEqual(where(mk(true, HL)), D.balanceColumns(MK.map((h, i) => (i === HL ? OPEN : h)), 3), 'another device class: afresh');
  DC = 'XL';
});

test('Dev: Show more marks the section open in place, Show fewer closes it and brings a title above the viewport back', () => {
  COLS = 3; DC = 'XL'; SCROLLED = [];
  const keys = ['apps', 'prs', 'vercel', 'supabase', 'rank', 'ws'], H = [620, 760, 420, 300, 330, 260];
  const dev = (open, top) => page('pg-home-dev', 'hdev', keys.map((k, i) => ({ k, h: k === 'prs' && open ? 3100 : H[i], open: k === 'prs' && open, top })));
  const before = where(dev(false));
  // the page's own click glue, on a fake document
  let click = null;
  const DEV = { open: new Set() };
  const glue = deck.slice(deck.indexOf("document.addEventListener('click',e=>{const b=e.target&&e.target.closest&&e.target.closest('[data-more5]')"));
  new Function('document', 'DEV', 'DeckBalance', glue.slice(0, glue.indexOf('\n//')))({ addEventListener: (t, fn) => { click = fn; } }, DEV, B);
  const p = dev(false), s = p.sects[1];
  s.cls.add('c5');
  const btn = (less) => { const b = new El({ data: Object.assign({ more5: 'prs' }, less ? { less: '1' } : {}), attrs: { 'data-more5': 'prs' } }); s.appendChild(b); return b; };
  click({ target: btn(false) });
  assert.ok(s.cls.has('open') && s.hasAttribute('data-bal-open') && DEV.open.has('prs'));
  s.h = 3100; B.run(p.box);
  assert.deepEqual(where(p), before, 'Pull requests opens in its column');
  s.children[0].top = -2400;
  s.h = H[1]; click({ target: btn(true) });
  assert.ok(!s.cls.has('open') && !s.hasAttribute('data-bal-open') && !DEV.open.has('prs'));
  assert.deepEqual(where(p), before);
  assert.equal(SCROLLED.length, 1, 'the title above the viewport is scrolled back into view');
  assert.equal(SCROLLED[0][0], s.children[0]);
  // a title already in view stays put
  SCROLLED = []; s.children[0].top = 300; click({ target: btn(false) }); click({ target: btn(true) });
  assert.equal(SCROLLED.length, 0);
});

const NOW = Date.UTC(2026, 10, 14, 20, 0, 0);
const PR = (n) => ({ repo: 'o/r', num: n, title: 'fix ' + n, ci: 'pass', url: 'https://github.com/o/r/pull/' + n });
const DEVF = (n) => ({ t: NOW / 1000 - 30, errors: [], github: { open_prs: Array.from({ length: n }, (_, i) => PR(i + 1)), failing_main: [], at: NOW / 1000 - 60 }, vercel: { projects: [] }, supabase: { projects: [] } });
const devSect = (h, k) => { const i = h.indexOf('data-k="' + k + '"'), j = h.indexOf('<section ', i); return h.slice(h.lastIndexOf('<section ', i), j < 0 ? h.length : j); };

test('Dev renders Show fewer where Show more is, and CSS shows it only on an open section at the size its Show more was shown', () => {
  const tf = { t: NOW / 1000 - 60, errors: [], apps: [] };
  const closed = devSect(D.devPage(DEVF(41), NOW, tf), 'prs'), open = devSect(D.devPage(DEVF(41), NOW, tf, undefined, new Set(['prs'])), 'prs');
  assert.doesNotMatch(closed, /data-bal-open/);
  assert.match(open, /^<section class="sect c5 c10 open" data-k="prs" data-bal-open>/);
  assert.match(open, /<div class="more-row less5"><button type="button" class="btn btn-quiet" data-less="1" data-more5="prs">Show fewer<\/button><\/div>/);
  assert.doesNotMatch(devSect(D.devPage(DEVF(4), NOW, tf, undefined, new Set(['prs'])), 'prs'), /less5/, 'four rows: nothing to close');
  const css = read('css/homeops.css');
  assert.match(css, /\.c5 \.more5,\.c5 \.less5\{display:none\}/);
  assert.match(css, /\(max-height:499px\)\{[^}]*\}[^@]*\.c5\.open \.less5\{display:flex\}\}/, 'P and L: an open five-row section');
  assert.match(css, /\(min-height:500px\)\{html:not\(\.tv\) \.c10:not\(\.open\)[^@]*html:not\(\.tv\) \.c10\.open \.less5\{display:flex\}/, 'T, D, XL: an open ten-row section');
});

test('Launch renders Show fewer and data-bal-open on an open group and on Missions opened past five; none when closed or searching', () => {
  const item = (i) => ({ id: 'skill:s' + i, kind: 'skill', name: 's' + i, label: 'Helper ' + i, does: 'x', area: 'Revenue', ao: 0, tier: 'useful', score: 60, targets: ['hermes'], where: [] });
  const items = D.launchItems({ t: NOW / 1000, items: Array.from({ length: 30 }, (_, i) => item(i)) });
  const closed = L.list(items, {}, '', {}), open = L.list(items, {}, '', { 'a:Revenue': 25 });
  assert.doesNotMatch(closed, /data-bal-open|Show fewer/);
  assert.match(open, /<section class="sect lgrp" data-g="a:Revenue" data-bal-open>/);
  assert.match(open, /data-lmore="a:Revenue">Show 5 more<\/button><button type="button" class="btn btn-quiet" data-less="1" data-lmore="a:Revenue">Show fewer<\/button>/);
  const all = L.list(items, {}, '', { 'a:Revenue': 45 });
  assert.match(all, /data-less="1" data-lmore="a:Revenue">Show fewer/, 'every row open: Show fewer alone');
  const m = A.missions(null, null, A.ALL, {}), mo = A.missions(null, null, A.ALL, { open: 25 });
  assert.doesNotMatch(m.html, /data-bal-open|Show fewer/);
  assert.match(mo.html, /^<section class="sect" data-bal-open>/);
  assert.match(mo.html, /data-less="1" data-lmore="missions">Show fewer/);
  assert.doesNotMatch(A.missions(null, null, A.ALL, { q: 'fix', open: 25 }).html, /Show fewer|data-bal-open/, 'a search shows every match: nothing to close');
  // the glue closes the group, repaints and hands the section to DeckBalance.fewer
  assert.match(agents, /if\(more\.dataset\.less\)\{delete LN\.open\[k\];paint\(\);[^}]*DeckBalance\.fewer\(s\)/);
});

test('Markets: a list open past its first page carries data-bal-open; Show fewer hands the section to DeckBalance.fewer', () => {
  const m = { t: NOW / 1000, board: [], catalysts: Array.from({ length: 20 }, (_, i) => ({ date: '2099-01-' + String(10 + (i % 9)).padStart(2, '0'), title: 'Event ' + i, kind: 'macro' })) };
  assert.doesNotMatch(I.catalysts(m, NOW, null), /data-bal-open/);
  assert.match(I.catalysts(m, NOW, { up: 18 }), /^<section class="sect" data-bal-open><h2 class="secttl"><span>Catalysts/);
  assert.match(read('invest.js'), /if\(less&&typeof DeckBalance!=='undefined'\)\{[^}]*DeckBalance\.fewer\(s\.closest\('\.sect'\)\)/);
});

test('Fleet: Background services opened past eight marks its list open (its section plans at the closed height) and offers Show fewer', () => {
  const u = { t: NOW / 1000 - 60, stale: false, writer_ok: true, failed_units: Array.from({ length: 21 }, (_, i) => 'unit-' + i + '.service') };
  const closed = D.bUnits(u, NOW), open = D.bUnits(u, NOW, true);
  assert.doesNotMatch(closed, /data-bal-open|Show fewer/);
  assert.match(open, /<div class="flist" data-bal-open>/);
  assert.match(open, /<button type="button" class="btn btn-quiet" data-less="1" data-more="fleetunits">Show fewer<\/button>/);
  assert.doesNotMatch(D.bUnits(Object.assign({}, u, { failed_units: ['a.service'] }), NOW, true), /data-bal-open|Show fewer/, 'one unit: nothing to close');
  // a block that holds an open list plans at its closed height: the Fleet section is the block, its list carries the mark
  COLS = 2; DC = 'D';
  const fl = (open) => page('pg-home-fleet', 'fleet', [{ h: 900 }, { h: open ? 1500 : 600, inner: open }, { h: 500 }, { h: 300 }]);
  const before = where(fl(false));
  assert.deepEqual(where(fl(true)), before);
  assert.deepEqual(where(fl(false)), before);
  assert.notDeepEqual(D.balanceColumns([900, 1500, 500, 300], 2), D.balanceColumns([900, 600, 500, 300], 2), 'at its open height it would move');
  assert.match(read('app.js'), /if\(less\)DeckBalance\.fewer\(section\)/);
});
