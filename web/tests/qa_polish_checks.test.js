'use strict';
// node --test tests/qa_polish_checks.test.js
// qa/polish-checks.mjs holds the in-page rules qa/copy-proof.mjs runs in a real browser. Here the same source strings run in a vm
// against a small fake DOM (elements with explicit rects and computed styles), so each rule is proven to fire on a bad page and to
// stay quiet on a good one without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const VW = 390, VH = 844;
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const DEFAULT_CSS = {
  textTransform: 'none', letterSpacing: 'normal', fontSize: '15px', fontWeight: '400', fontVariantNumeric: 'tabular-nums', visibility: 'visible',
  display: 'block', opacity: '1', backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(240, 240, 240)', borderRadius: '0px', borderTopLeftRadius: '0px',
  boxShadow: 'none', textOverflow: 'clip', webkitLineClamp: 'none', paddingRight: '0px', backdropFilter: 'none',
};
const VARS = { '--tint': 'rgb(10, 132, 255)', '--warn': 'rgb(255, 159, 10)' };

function parseCompound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], notAttrs: [], first: false };
  for (const m of s.matchAll(/^([a-z*][\w-]*)|#([\w-]+)|\.([\w-]+)|:not\(\[([\w-]+)\]\)|(:first-child)|\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (m[1]) c.tag = m[1]; else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]); else if (m[4]) c.notAttrs.push(m[4]); else if (m[5]) c.first = true; else c.attrs.push([m[6], m[7]]);
  }
  return c;
}
function matchCompound(e, c) {
  if (c.tag && c.tag !== '*' && c.tag !== e.tag) return false;
  if (c.id && c.id !== e.id) return false;
  if (!c.cls.every((k) => e.classes.has(k))) return false;
  if (!c.attrs.every(([k, v]) => k in e.attrs && (v === undefined || e.attrs[k] === v))) return false;
  if (c.notAttrs.some((k) => k in e.attrs)) return false;
  return !c.first || (e.parentElement && e.parentElement.kids[0] === e);
}
function matchSeq(e, toks, i) {
  if (!matchCompound(e, toks[i])) return false;
  if (i === 0) return true;
  if (toks[i - 1] === '>') return !!e.parentElement && matchSeq(e.parentElement, toks, i - 2);
  for (let p = e.parentElement; p; p = p.parentElement) if (matchSeq(p, toks, i - 1)) return true;
  return false;
}
const compile = (sel) => sel.split(',').map((part) => part.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/).map((t) => (t === '>' ? t : parseCompound(t))));
const matches = (e, sel) => compile(sel).some((toks) => matchSeq(e, toks, toks.length - 1));

class El {
  constructor(tag, o = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.id = o.id || '';
    this.classes = new Set(o.cls ? o.cls.split(' ') : []);
    this.attrs = o.attrs || {};
    this.dataset = o.data || {};
    this.ownText = o.text || '';
    this.kids = [];
    this.parentElement = null;
    this.rect = o.rect || rect(0, 0, 0, 0);
    this.css = o.css || {};
    this.before = o.before || {};
    this.scrollW = o.scrollW;
    this.scrollH = o.scrollH;
    this.style = {};
    this.props = {};
  }
  add(...kids) { for (const k of kids) { k.parentElement = this; this.kids.push(k); } return this; }
  appendChild(k) { this.add(k); return k; }
  remove() { if (this.parentElement) this.parentElement.kids = this.parentElement.kids.filter((k) => k !== this); this.parentElement = null; }
  get className() { return [...this.classes].join(' '); }
  get classList() { return { contains: (k) => this.classes.has(k) }; }
  get childNodes() { return [...(this.ownText ? [{ nodeType: 3, textContent: this.ownText }] : []), ...this.kids.map((k) => ({ nodeType: 1, textContent: k.textContent }))]; }
  get textContent() { return this.ownText + this.kids.map((k) => k.textContent).join(''); }
  get clientWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get scrollWidth() { return this.scrollW ?? this.rect.width; }
  get scrollHeight() { return this.scrollH ?? this.rect.height; }
  getBoundingClientRect() { return this.rect; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let p = this; p; p = p.parentElement) if (matches(p, sel)) return p; return null; }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const k of n.kids) { if (matches(k, sel)) out.push(k); walk(k); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// A healthy 390x844 deck page: top bar with a quiet clock, an empty Home page with one titled card, a status pill and a tab strip.
function deck(over = {}) {
  const el = (tag, o) => new El(tag, o);
  const root = el('html'), body = el('body');
  root.add(body);
  const clock = el('span', { id: 'clock', text: '12:00', rect: rect(300, 14, 40, 16), css: { fontSize: '13px' } });
  const topr = el('div', { id: 'topr', rect: rect(280, 10, 80, 30) });
  const hosts = el('div', { id: 'hosts', rect: rect(24, 10, 100, 44) });
  const top = el('div', { id: 'top', rect: rect(16, 8, 358, 44), css: { borderTopLeftRadius: '22px' }, before: { backdropFilter: 'blur(20px)' } });
  top.add(hosts, topr.add(clock));
  const status = el('div', { id: 'status', rect: rect(20, 60, 100, 20), css: { fontSize: '12px' } });
  const fs = el('button', { id: 'fs', rect: rect(0, 0, 0, 0), css: { display: 'none' } });
  const on = el('button', { cls: 'on', text: 'Home', rect: rect(10, 90, 50, 30), css: { fontSize: '13px' } });
  const pgs = el('div', { id: 'pgs', rect: rect(0, 88, VW, 34) }).add(on);
  const title = el('span', { text: 'Home', rect: rect(16, 130, 60, 24), css: { fontSize: '20px' } });
  const card = el('div', { cls: 'secttl', rect: rect(16, 126, 358, 32) }).add(title);
  const page = el('div', { cls: 'page', data: { name: 'home' }, rect: rect(0, 0, VW, 2000) }).add(card);
  const pager = el('div', { id: 'pager', rect: rect(0, 0, VW, VH) }).add(page);
  const app = el('div', { id: 'app', css: { paddingRight: '16px' }, rect: rect(0, 0, VW, VH) }).add(top, status, fs, pgs, pager);
  body.add(app);
  const sandbox = {
    innerWidth: VW, innerHeight: VH, navigator: { userAgent: 'Mozilla/5.0 (iPhone) OmarchyDeck/1.0' }, window: {},
    document: { documentElement: root, body, querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s), createElement: (t) => el(t) },
    getComputedStyle: (e, pseudo) => {
      if (pseudo) return { ...(pseudo === '::before' ? e.before : {}) };
      if (/^var\(/.test(e.style.color || '')) return { color: VARS[e.style.color.slice(4, -1)] };
      const cs = { ...DEFAULT_CSS, ...e.css };
      if (e === root) cs.getPropertyValue = (n) => root.props[n] || '';
      return cs;
    },
  };
  Object.assign(sandbox, over);
  return { root, top, clock, status, fs, page, card, title, app, pgs, on, sandbox };
}

// Violation text is "<page> <rule>: <selector-ish label> "<text>" <detail>"; an element with no id or class leaves a double space, so compare with spaces collapsed.
const run = (src, sandbox) => Array.from(vm.runInNewContext(src, sandbox, { timeout: 2000 }), (v) => v.replace(/\s+/g, ' '));

test('polish checks: a plain, healthy page returns no violations', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  assert.deepEqual(run(POLISH_CHECKS, deck().sandbox), []);
});

test('polish checks: eyebrow styling is named, whether capitals or tracking', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const a = deck();
  a.title.css = { fontSize: '20px', textTransform: 'uppercase' };
  assert.deepEqual(run(POLISH_CHECKS, a.sandbox), ['home uppercase: "Home"']);

  const b = deck();
  b.title.css = { fontSize: '20px', letterSpacing: '1.2px' };
  assert.deepEqual(run(POLISH_CHECKS, b.sandbox), ['home tracked: "Home" 1.2px']);

  const c = deck();
  c.title.css = { fontSize: '20px', letterSpacing: '0.4px' };
  assert.deepEqual(run(POLISH_CHECKS, c.sandbox), [], 'tracking up to half a pixel is allowed');
});

test('polish checks: font sizes must sit on the ramp, except a key glyph the owner chose', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const bad = deck();
  bad.title.css = { fontSize: '17px' };
  assert.deepEqual(run(POLISH_CHECKS, bad.sandbox), ['home off-ramp size: "Home" 17px']);

  const input = deck();
  input.title.css = { fontSize: '16px' };
  assert.deepEqual(run(POLISH_CHECKS, input.sandbox), [], 'inputs use 16px');

  const glyph = deck();
  const key = new El('div', { cls: 'key', rect: rect(16, 170, 60, 60) });
  key.add(new El('span', { cls: 'ic', text: 'K', rect: rect(30, 180, 20, 30), css: { fontSize: '30px' } }));
  glyph.card.add(key);
  assert.deepEqual(run(POLISH_CHECKS, glyph.sandbox), []);
});

test('polish checks: the clock must stay small, light and tabular; the top bar may not outrank a title', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const heavy = deck();
  heavy.clock.css = { fontSize: '13px', fontWeight: '600' };
  assert.deepEqual(run(POLISH_CHECKS, heavy.sandbox), ['home clock not quiet: #clock "12:00" 13px 600 tabular-nums']);

  const loose = deck();
  loose.clock.css = { fontSize: '13px', fontVariantNumeric: 'normal' };
  assert.equal(run(POLISH_CHECKS, loose.sandbox).length, 1);

  const big = deck();
  big.clock.css = { fontSize: '28px' };
  const found = run(POLISH_CHECKS, big.sandbox);
  assert.ok(found.some((v) => v.startsWith('home top bar outranks a title')), found.join('|'));
  assert.ok(found.some((v) => v.startsWith('home clock not quiet')), found.join('|'));
});

test('polish checks: the fullscreen button is only a violation inside the OmarchyDeck shell', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const inShell = deck();
  inShell.fs.css = { display: 'block' };
  assert.deepEqual(run(POLISH_CHECKS, inShell.sandbox), ['home fullscreen button shown inside the shell: #fs ""']);

  const browser = deck();
  browser.fs.css = { display: 'block' };
  browser.sandbox.navigator.userAgent = 'Mozilla/5.0 Safari/605.1.15';
  assert.deepEqual(run(POLISH_CHECKS, browser.sandbox), []);
});

test('polish checks: the reserved shell corner must stay empty of the top-right group', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  d.sandbox.document.documentElement.props['--shell-reserve-top-right'] = '56px';
  // right edge 360 is past 390 - 16 - 56 = 318
  const found = run(POLISH_CHECKS, d.sandbox);
  assert.ok(found.some((v) => v.startsWith('home content inside the reserved corner: #topr')), found.join('|'));

  const ok = deck();
  ok.sandbox.document.documentElement.props['--shell-reserve-top-right'] = '56px';
  const topr = ok.top.kids.find((k) => k.id === 'topr');
  topr.rect = rect(200, 10, 100, 30); // right edge 300 <= 318
  topr.kids[0].rect = rect(250, 14, 40, 16);
  assert.deepEqual(run(POLISH_CHECKS, ok.sandbox), []);
});

test('polish checks: bare "--" placeholders fail healthy pages, and only the listed pages when the proof runs against a broken feed', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const healthy = deck();
  healthy.title.ownText = '--';
  assert.deepEqual(run(POLISH_CHECKS, healthy.sandbox), ['home bare placeholder: "--"']);

  const broken = deck();
  broken.title.ownText = '--';
  broken.sandbox.window.__proofMode = 'broken';
  assert.deepEqual(run(POLISH_CHECKS, broken.sandbox), [], 'a failed home page may keep its dash');

  const shop = deck();
  shop.title.ownText = '--';
  shop.page.dataset.name = 'shop';
  shop.sandbox.window.__proofMode = 'broken';
  assert.deepEqual(run(POLISH_CHECKS, shop.sandbox), ['shop bare placeholder: "--"']);
});

test('polish checks: colour emoji are flagged', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  d.title.ownText = '\u{1F525} Hot';
  assert.deepEqual(run(POLISH_CHECKS, d.sandbox), ['home colour emoji glyph: "\u{1F525} Hot"']);
});

test('polish checks: contrast needs 4.5:1, or 3:1 once the text is large', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const grey = 'rgb(118, 118, 118)'; // about 4:1 on the deck's dark base
  const small = deck();
  small.title.css = { fontSize: '13px', color: grey };
  const found = run(POLISH_CHECKS, small.sandbox);
  assert.equal(found.length, 1);
  assert.match(found[0], /^home low contrast: "Home" 3\.9\d:1$/);

  const large = deck();
  large.title.css = { fontSize: '28px', color: grey };
  assert.deepEqual(run(POLISH_CHECKS, large.sandbox), []);

  const faded = deck(); // group opacity counts: white text at 20% opacity over the base
  faded.card.css = { opacity: '0.2' };
  assert.match(run(POLISH_CHECKS, faded.sandbox).join('|'), /home low contrast: "Home"/);

  const lit = deck(); // text is judged on the colour really painted behind it
  lit.card.css = { backgroundColor: 'rgb(250, 250, 250)' };
  assert.match(run(POLISH_CHECKS, lit.sandbox).join('|'), /home low contrast: "Home"/);
});

test('polish checks: a filled rounded card inside another is a nested card, but pills and the top bar are exempt', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const surface = (cls, r) => new El('div', { cls, rect: r, css: { borderRadius: '12px', backgroundColor: 'rgb(40, 40, 46)' } });
  const nested = deck();
  const outer = surface('tcard', rect(16, 170, 358, 120));
  outer.add(surface('inner', rect(24, 180, 200, 60)));
  nested.page.add(outer);
  assert.deepEqual(run(POLISH_CHECKS, nested.sandbox), ['home nested card: .inner "" in .tcard ""']);

  const exempt = deck();
  const holder = surface('tcard', rect(16, 170, 358, 120));
  holder.add(surface('pill', rect(24, 180, 200, 60)));
  exempt.page.add(holder);
  assert.deepEqual(run(POLISH_CHECKS, exempt.sandbox), []);

  const single = deck();
  single.page.add(surface('tcard', rect(16, 170, 358, 120)));
  assert.deepEqual(run(POLISH_CHECKS, single.sandbox), []);
});

test('polish checks: short labels that overflow their own box are reported as cut text', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  d.page.add(new El('span', { cls: 'pill', text: 'Needs attention soon', rect: rect(16, 200, 80, 20), scrollW: 140, css: { fontSize: '12px' } }));
  assert.deepEqual(run(POLISH_CHECKS, d.sandbox), ['home text cut: .pill "Needs attention soon" 140x20 in 80x20']);

  const below = deck(); // a row that starts below the fold is cut by the scroller, not by its own clamp
  below.page.add(new El('span', { cls: 'pill', text: 'Later', rect: rect(16, 1200, 80, 20), scrollW: 140, css: { fontSize: '12px' } }));
  assert.deepEqual(run(POLISH_CHECKS, below.sandbox), []);
});

test('polish checks: the status pill and the active tab must fit their strips', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  d.status.scrollW = 180;
  assert.deepEqual(run(POLISH_CHECKS, d.sandbox).map((v) => v.split(':')[0]), ['home status cut']);

  const clipped = deck();
  clipped.on.rect = rect(350, 90, 80, 30); // runs past the strip's right edge
  assert.match(run(POLISH_CHECKS, clipped.sandbox).join('|'), /home active tab clipped: .on "Home" tab 350-430 strip 0-390/);

  const none = deck();
  none.on.classes.clear();
  assert.match(run(POLISH_CHECKS, none.sandbox).join('|'), /home active tab clipped/);
});

test('polish checks: tap tint and warning colour may not share a hue', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  d.sandbox.getComputedStyle = ((orig) => (e, p) => (/^var\(--tint\)/.test(e.style && e.style.color || '') ? { color: 'rgb(255, 170, 20)' } : orig(e, p)))(d.sandbox.getComputedStyle);
  const found = run(POLISH_CHECKS, d.sandbox);
  assert.equal(found.length, 1);
  assert.match(found[0], /^home tint and warn are one hue: /);
});

test('polish checks: host switch buttons need a 44 px target and must sit inside the capsule corner', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const small = deck();
  small.top.kids[0].add(new El('button', { rect: rect(24, 14, 30, 30) }));
  assert.deepEqual(run(POLISH_CHECKS, small.sandbox), ['home host switch under 44 px: "" 30x30']);

  const good = deck();
  good.top.kids[0].add(new El('button', { rect: rect(60, 8, 44, 44), css: { borderTopLeftRadius: '4px' } }));
  assert.deepEqual(run(POLISH_CHECKS, good.sandbox), []);

  const corner = deck(); // a square 44 px button flush with the capsule's rounded left edge pokes out of the corner
  corner.top.kids[0].add(new El('button', { rect: rect(16, 8, 44, 44), css: { borderTopLeftRadius: '22px' } }));
  const found = run(POLISH_CHECKS, corner.sandbox);
  assert.equal(found.length, 0, 'a 22 px pill in a 22 px capsule fits');

  const poke = deck();
  poke.top.kids[0].add(new El('button', { rect: rect(16, 8, 44, 44), css: { borderTopLeftRadius: '0px' } }));
  assert.match(run(POLISH_CHECKS, poke.sandbox).join('|'), /home host pill clipped by the capsule corner/);
});

test('polish checks: the Keys page needs twelve usable keys on screen and, in landscape, the first row near the top', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const padPage = (keyCount, top) => {
    const d = deck();
    d.page.dataset.name = 'pad';
    const sub = new El('div', { cls: 'sub', attrs: { 'data-sub': 'keys' }, rect: rect(0, 130, VW, 600) });
    const keys = new El('div', { id: 'keys', rect: rect(0, top, VW, 400) });
    for (let i = 0; i < keyCount; i++) keys.add(new El('div', { cls: 'key', rect: rect(8 + (i % 5) * 70, top + Math.floor(i / 5) * 60, 60, 52) }));
    sub.add(keys);
    d.page.add(sub);
    return d;
  };
  assert.deepEqual(run(POLISH_CHECKS, padPage(15, 140).sandbox), []);

  const few = run(POLISH_CHECKS, padPage(6, 140).sandbox);
  assert.deepEqual(few, ['pad keys off screen or under 44 px: .key "" 6 of 6 on screen']);

  const land = padPage(15, 300);
  land.sandbox.innerWidth = 844;
  land.sandbox.innerHeight = 390;
  assert.match(run(POLISH_CHECKS, land.sandbox).join('|'), /pad first key row below the fold: .key "" 170px under the page top/);
});

// ---- the v3 deck (L18, 2026-11-17): one page un-hidden, a fluid type scale read from the tokens, a square solid bar
test('polish checks judge the page that is shown, not the first section in the pager', async () => {
  const { POLISH_CHECKS, CENSUS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  const hiddenToday = new El('div', { cls: 'page', data: { name: 'today' }, attrs: { hidden: '' }, rect: rect(0, 0, 0, 0) });
  d.page.parentElement.kids.unshift(hiddenToday); hiddenToday.parentElement = d.page.parentElement;
  d.title.css = { fontSize: '17px' };
  assert.deepEqual(run(POLISH_CHECKS, d.sandbox), ['home off-ramp size: "Home" 17px'], 'named after the page on screen');
  assert.equal(vm.runInNewContext(CENSUS, d.sandbox, { timeout: 2000 }).name, 'home');
});

test('polish checks read the v3 type steps from the tokens at this viewport; strip figures may scale between lead and fig', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const STEPS = { '--fs-micro': '13px', '--fs-meta': '14px', '--fs-body': '16px', '--fs-lead': '17px', '--fs-title': '21px', '--fs-page': '26px', '--fs-fig': '30px', '--fs-display': '40px' };
  const v3 = (title) => { const d = deck(); d.root.props['--fs-body'] = '16px'; d.title.css = { fontSize: title };
    d.sandbox.getComputedStyle = ((orig) => (e, p) => { const m = /^var\((--fs-[a-z]+)\)$/.exec(e.style && e.style.fontSize || ''); return m ? { fontSize: STEPS[m[1]] } : orig(e, p); })(d.sandbox.getComputedStyle);
    return d; };
  assert.deepEqual(run(POLISH_CHECKS, v3('17px').sandbox), [], 'lead is a v3 step');
  assert.deepEqual(run(POLISH_CHECKS, v3('26px').sandbox), [], 'page is a v3 step');
  assert.deepEqual(run(POLISH_CHECKS, v3('12px').sandbox), [], 'the 12 px map codes on a phone');
  assert.deepEqual(run(POLISH_CHECKS, v3('18.5px').sandbox), ['home off-ramp size: "Home" 18.5px']);
  const strip = v3('20px');
  const s = new El('div', { cls: 'strip', rect: rect(16, 200, 358, 90) }), t = new El('div', { cls: 'tile', rect: rect(16, 200, 179, 90) });
  t.add(new El('b', { cls: 'v', text: '$1,715', rect: rect(30, 220, 150, 26), css: { fontSize: '24.5px' } })); s.add(t); strip.page.add(s);
  assert.deepEqual(run(POLISH_CHECKS, strip.sandbox), ['home off-ramp size: "Home" 20px'], 'a strip figure between lead and fig passes; a title at 20 px does not');
});

test('polish checks: only a rounded capsule bar must be glass; the v3 square bar is solid', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const capsule = deck(); capsule.top.before = {};
  assert.deepEqual(run(POLISH_CHECKS, capsule.sandbox), ['home top bar is not glass: #top "12:00"']);
  const square = deck(); square.top.before = {}; square.top.css = { borderTopLeftRadius: '0px' };
  assert.deepEqual(run(POLISH_CHECKS, square.sandbox), []);
});

test('polish checks: a figure that overhangs its 1.05 line box a little is not cut unless its box clips', async () => {
  const { POLISH_CHECKS } = await import('../qa/polish-checks.mjs');
  const fig = (overflowY) => { const d = deck(); const t = new El('div', { cls: 'tile', rect: rect(16, 200, 179, 90) });
    t.add(new El('b', { cls: 'v', text: '2 of 3', rect: rect(30, 220, 146, 32), scrollH: 35, css: { fontSize: '28px', overflowY } })); d.page.add(t); return d; };
  assert.deepEqual(run(POLISH_CHECKS, fig('visible').sandbox), []);
  assert.deepEqual(run(POLISH_CHECKS, fig('hidden').sandbox), ['home text cut: .v "2 of 3" 146x35 in 146x32']);
});

test('census: counts visible blocks with their own text, on screen and on the whole page', async () => {
  const { CENSUS } = await import('../qa/polish-checks.mjs');
  const d = deck();
  const text = (t, top) => new El('p', { text: t, rect: rect(16, top, 200, 20) });
  d.page.add(
    text('on screen', 200),
    text('below the fold', 1500),
    new El('p', { text: 'hidden', rect: rect(16, 220, 200, 20), css: { display: 'none' } }),
    new El('div', { cls: 'diag', rect: rect(0, 0, 10, 10) }).add(text('diagnostic', 240)),
    new El('details', { rect: rect(16, 260, 200, 60) }).add(text('folded away', 270)),
    new El('details', { attrs: { open: '' }, rect: rect(16, 330, 200, 60) }).add(text('opened', 340)),
  );
  const census = vm.runInNewContext(CENSUS, d.sandbox, { timeout: 2000 });

  assert.equal(census.name, 'home');
  // title "Home" and "on screen" and "opened" are on screen; "below the fold" only counts for the page
  assert.equal(census.screen, 3);
  assert.equal(census.page, 4);
});
