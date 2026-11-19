'use strict';
// node --test tests/shell_ux_l18.test.js
// Deck UX lane L18 (2026-11-17): the shell fixes found by the copy-proof pass at 390x844, 956x440, 1568x900 and 2470x1300.
// Rules and pure helpers only; the before and after shots live in the lane report.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), deck = read('deck.js'), ui = read('ui.css'), tokens = read('tokens.css');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const C = vm.runInNewContext(between(app, '// ==== SHELL CORE BEGIN', '// ==== SHELL CORE END ====') + '\nShellCore', {});
const D = new Function(between(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const F = DeckCore.fmt, NB = '\u00A0';

test('formats for the best-ZIP figures: a figure never parts from its unit word, a missing value is null', () => {
  assert.equal(F.days(39), '39' + NB + 'days');
  assert.equal(F.days(1), '1' + NB + 'day');
  assert.equal(F.days(0.4), '0' + NB + 'days');
  assert.equal(F.days(1234), '1,234' + NB + 'days');
  assert.equal(F.days(-3), '\u22123' + NB + 'days');
  assert.equal(F.months(4.25), '4.3' + NB + 'months');
  assert.equal(F.months(1), '1' + NB + 'month');
  assert.equal(F.months(1.04), '1' + NB + 'month', 'rounds to one place first');
  assert.equal(F.months(2.5, 0), '3' + NB + 'months');
  assert.equal(F.unit(12, 0, 'W'), '12' + NB + 'W');
  assert.equal(F.unit(1.25, 1, 'x'), '1.3' + NB + 'x');
  assert.equal(F.unit(7), '7');
  for (const f of [F.days, F.months, F.unit]) for (const v of [null, undefined, NaN, '12', Infinity]) assert.equal(f(v), null, String(v));
  // the nine data points map onto the formats: the page never invents its own
  assert.equal(F.money(845000), '$845K');
  assert.equal(F.chg(-2.34), '\u22122.3%');
  assert.equal(F.rent(2450), '$2,450/mo');
  assert.equal(F.rate(6.125), '6.13%');
  assert.equal(F.share(18.04), '18.0%');
  assert.equal(F.count(1520), '1,520');
});

test('? opens the keyboard list on D and XL only, never while typing or over a sheet', () => {
  const s = { cls: 'D', field: false, modal: false, tabs: ['today', 'home'], tab: 'today', subs: [], sub: 'main' };
  assert.equal(JSON.stringify(C.deskKey({ key: '?' }, s)), '{"help":true}');
  assert.equal(JSON.stringify(C.deskKey({ key: '?' }, Object.assign({}, s, { cls: 'XL' }))), '{"help":true}');
  assert.equal(C.deskKey({ key: '?' }, Object.assign({}, s, { cls: 'P' })), null);
  assert.equal(C.deskKey({ key: '?' }, Object.assign({}, s, { field: true })), null);
  assert.equal(C.deskKey({ key: '?' }, Object.assign({}, s, { modal: true })), null);
  assert.equal(C.deskKey({ key: '?', ctrlKey: true }, s), null);
});

test('state icons are the deck mark shapes: failed a crossed square, stale a triangle, never a ring', () => {
  const bad = D.empty({ k: 'bad', title: 'Surf is not reporting', retry: 'page' }), stale = D.empty({ k: 'stale', title: 'Old' });
  assert.match(bad, /<svg class="es-i"[^>]*><rect x="4" y="4" width="16" height="16"[^>]*\/><path d="M8\.6 8\.6l6\.8 6\.8M15\.4 8\.6l-6\.8 6\.8"\/><\/svg>/);
  assert.match(stale, /<svg class="es-i"[^>]*><path d="M12 3\.8 21\.2 19\.8H2\.8z"\/>/);
  for (const h of [bad, stale]) assert.doesNotMatch(h, /<circle/);
  // the icon sits beside the title: one grid for a state that has an icon, the rest aligned under the title
  assert.match(ui, /\n\.es:has\(>\.es-i\)\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(ui, /\n\.es:has\(>\.es-i\)>\*\{grid-column:2\}/);
  assert.match(ui, /\n\.es:has\(>\.es-i\)>\.es-i\{grid-column:1;grid-row:1;/);
});

test('the shell bar: 44 px host targets in a bar that holds them, the reserved corner kept clear, L status marks keep their shape', () => {
  assert.match(ui, /\n\.seg\.host>button\{min-width:var\(--hit\);min-height:var\(--hit\);/);
  assert.match(tokens, /@media \(max-width:599px\)\{:root\{--topbar-h:52px;/, 'P bar tall enough for a 44 px button and its border');
  const l = between(ui, '@media (min-width:600px) and (max-height:499px){\n  #top{gap:var(--s-2)}', '\n}');
  assert.match(l, /#status\.bad>\.sd\{background:linear-gradient\(45deg,[^}]*linear-gradient\(-45deg,[^}]*,var\(--c-bad\)\}/, 'the crossed square, not a flat red fill');
  assert.doesNotMatch(l, /#status\.bad>\.sd\{background:var\(--c-bad\)\}/);
});

test('D: the rail foot is two lines and the header names the sub-page; the TV keeps its own', () => {
  assert.match(ui, /html:not\(\.tv\) #topr\{display:grid;grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(ui, /html:not\(\.tv\) #topr>#status\{grid-row:2;grid-column:1\/-1\}/);
  assert.match(ui, /html:not\(\.tv\) \.phead:not\(:has\(\.pscope>\*\)\) \.ptitle\[data-sub\]::after\{content:" \\00B7  " attr\(data-sub\)/, 'a header with scope controls keeps one row');
  const go = between(app, 'function go(raw,opt){', '\nfunction ') || '';
  assert.match(go, /if\(tt\)\{if\(w&&w!==tt\.textContent\.trim\(\)\)tt\.dataset\.sub=w;else delete tt\.dataset\.sub\}/, 'a sub named like its tab (Pad) adds nothing');
});

test('the offline and signed-out panel sits in the page margins', () => {
  assert.match(ui, /\n#roleoff\{max-width:var\(--content-max\);margin:var\(--s-5\) auto 0;padding:0 calc\(var\(--page-pad\) \+ var\(--safe-r\)\) 0 var\(--page-pad\)\}/);
  assert.match(app, /off\.className='roleoff';off\.id='roleoff'/);
});
