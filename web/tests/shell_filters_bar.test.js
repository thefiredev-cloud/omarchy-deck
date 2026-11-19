'use strict';
// L: the bar's Filters slot (#tact). Runs the shell's own moveFilters() from app.js against a small fake DOM.
// - It holds the button of the sub-page on screen only. Before #284, Commercial's button stayed in the bar on Surf and on every later
//   page (WebKit lane, 2026-11-15; the same in Chromium and WebKitGTK).
// - It takes a button only when that saves a row: the button's row holds nothing else (Gigs: the button and its chips). A button beside
//   a search, a person picker or a type switch stays in its row, so the strip keeps room for the eight tabs (LayoutL 1, 2, 73, 75).
// - One control: a repainted filter row never leaves a second button anywhere (LayoutL 42, 47: Residential showed two).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const start = app.indexOf('function moveFilters(){');
const src = app.slice(start, app.indexOf('\nfunction syncBar(', start));

// a tree with the few DOM calls moveFilters makes: querySelector ('.a' and '.a .b'), closest('.a'), matches('.a,.b'), contains,
// insertBefore, appendChild, remove, children, getElementById, dataset, hidden
class N {
  constructor(cls, o = {}) { this.cls = cls ? cls.split(' ') : []; this.id = o.id || ''; this.dataset = o.data || {}; this.hidden = !!o.hidden; this.children = []; this.parentElement = null; }
  add(...kids) { for (const k of kids) this.appendChild(k); return this; }
  appendChild(n) { n.remove(); n.parentElement = this; this.children.push(n); return n; }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); n.remove(); n.parentElement = this; this.children.splice(this.children.indexOf(ref), 0, n); return n; }
  remove() { const p = this.parentElement; if (p) p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; }
  is(c) { return this.cls.includes(c.slice(1)); }
  matches(sel) { return sel.split(',').some((c) => this.is(c.trim())); }
  *all() { for (const k of this.children) { yield k; yield* k.all(); } }
  contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; }
  closest(c) { for (let x = this; x; x = x.parentElement) if (x.is(c)) return x; return null; }
  querySelector(sel) {
    const [outer, inner] = sel.split(' ');
    for (const n of this.all()) {
      if (inner ? n.is(inner) && n.parentElement && n.closest(outer) && this.contains(n.closest(outer)) : n.is(outer)) return n;
    }
    return null;
  }
}
// one filter row as DeckUI.filters draws it: .fbar > .fbar-top > button.fbar-open beside the page's lead (a search, a type switch) or
// its chips, and the #fb-<id> sheet beside the row
const filterRow = (sub, id, lead) => {
  const btn = new N('btn fbar-open', { data: { openFbar: id } });
  const top = new N('fbar-top').add(btn, new N(lead));
  sub.add(new N('fbar', { data: { fbar: id } }).add(top, new N('sheet fbar-panel', { id: 'fb-' + id })));
  return { sub, btn, top };
};

function deck() {
  const res = filterRow(new N('sub', { hidden: true }), 're-res', 'search');
  const com = filterRow(new N('sub', { hidden: true }), 'com-fb', 'seg keep');
  const gigs = filterRow(new N('sub', { hidden: true }), 'gigs', 'chips');
  const realestate = new N('page').add(res.sub, com.sub), work = new N('page').add(gigs.sub);
  const surfSub = new N('sub', { hidden: true }), surf = new N('page').add(surfSub);
  const slot = new N('', { id: 'tact' });
  const root = new N('').add(slot, realestate, work, surf);
  const ctx = {
    PAGES: [realestate, work, surf], page: 0, dclass: 'L', $: (s) => (s === '#tact' ? slot : null),
    subOf: (pg) => pg.children.find((c) => c.is('.sub') && !c.hidden) || null,
    document: { getElementById: (id) => [...root.all()].find((n) => n.id === id) || null },
  };
  vm.runInNewContext(src + '\nthis.moveFilters=moveFilters', ctx);
  // show one route: its page and its sub-page, the others hidden, then the shell's sync
  const show = (pageIx, sub) => { ctx.page = pageIx; for (const s of [res.sub, com.sub, gigs.sub, surfSub]) s.hidden = s !== sub; ctx.moveFilters(); };
  // the page draws its filter row again (Residential's paint() replaces the whole page): a new button and a new #fb-<id> dialog
  const repaint = (sub, id, lead) => { for (const k of [...sub.children]) k.remove(); return filterRow(sub, id, lead).btn; };
  const buttons = (id) => [...root.all()].filter((n) => n.is('.fbar-open') && n.dataset.openFbar === id);
  return { ctx, slot, res, com, gigs, surfSub, show, repaint, buttons, inBar: () => slot.children.map((b) => b.dataset.openFbar) };
}

test('L: the bar takes the button only to save a row; beside a search or a type switch it stays in its row', () => {
  const d = deck();
  d.show(0, d.res.sub);
  assert.deepEqual(d.inBar(), [], 'Residential: the button stays beside the search');
  assert.equal(d.res.btn.parentElement, d.res.top);
  d.show(0, d.com.sub);
  assert.deepEqual(d.inBar(), [], 'Commercial: beside the type switch');
  d.show(1, d.gigs.sub);
  assert.deepEqual(d.inBar(), ['gigs'], 'Gigs: a row of the button and its chips goes, the button sits in the bar');
  d.gigs.top.appendChild(new N('search'));
  d.ctx.moveFilters();
  assert.deepEqual(d.inBar(), [], 'a row that gains a search takes its button back');
  assert.equal(d.gigs.btn.parentElement, d.gigs.top);
});

test('L: the Filters slot follows the sub-page on screen, and every button goes home', () => {
  const d = deck();
  d.show(1, d.gigs.sub);
  assert.deepEqual(d.inBar(), ['gigs']);
  d.show(2, d.surfSub);
  assert.deepEqual(d.inBar(), [], 'Surf has no filters: the bar is empty');
  assert.equal(d.gigs.btn.parentElement, d.gigs.top, 'and Gigs has its button back');
  d.show(0, d.res.sub);
  assert.deepEqual(d.inBar(), [], 'never another page\'s button');
  d.show(1, d.gigs.sub);
  assert.deepEqual(d.inBar(), ['gigs']);
  d.ctx.dclass = 'P'; d.ctx.moveFilters();
  assert.deepEqual(d.inBar(), [], 'any other class: back in its row');
  assert.equal(d.gigs.btn.parentElement, d.gigs.top);
});

test('a button whose filter row is gone leaves the bar', () => {
  const d = deck();
  d.show(1, d.gigs.sub);
  d.gigs.sub.children[0].remove(); // the page repainted without filters
  d.show(2, d.surfSub);
  assert.deepEqual(d.inBar(), []);
});

test('one Filters control: a repainted filter row never leaves a second button in the bar or in the row', () => {
  const d = deck();
  d.show(1, d.gigs.sub);
  const fresh = d.repaint(d.gigs.sub, 'gigs', 'chips');
  d.ctx.moveFilters();
  assert.equal(d.buttons('gigs').length, 1, 'L: one button on the whole page');
  assert.equal(d.slot.children[0], fresh, 'the bar holds the new button, with its current count');
  const again = d.repaint(d.gigs.sub, 'gigs', 'chips');
  d.ctx.dclass = 'P'; d.ctx.moveFilters();
  assert.equal(d.buttons('gigs').length, 1, 'any other class: the row keeps its own new button and the stale one goes');
  assert.equal(again.parentElement.is('.fbar-top'), true);
  assert.deepEqual(d.inBar(), []);
  // Residential at L, the page of LayoutL rows 42 and 47: after a repaint, one button, beside the search
  d.ctx.dclass = 'L'; d.show(0, d.res.sub);
  d.repaint(d.res.sub, 're-res', 'search'); d.ctx.moveFilters();
  assert.equal(d.buttons('re-res').length, 1);
  assert.deepEqual(d.inBar(), []);
});

test('one Filters control: a stale button sent home to a row that has a new one is dropped, not doubled', () => {
  const d = deck();
  d.show(1, d.gigs.sub);
  d.repaint(d.gigs.sub, 'gigs', 'chips');
  d.show(2, d.surfSub);
  assert.equal(d.buttons('gigs').length, 1);
  d.show(1, d.gigs.sub);
  assert.deepEqual(d.inBar(), ['gigs']);
  assert.equal(d.buttons('gigs').length, 1);
});
