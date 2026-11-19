'use strict';
// Design v3 shell navigation (DESIGN-v3 5): the D keyboard map, tab and sub steps for the page swipe and the L freshness copy
// in the bar. The Chrome 108 rule for every stylesheet lives in tests/css_engine_floor.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const app = read('app.js'), html = read('index.html'), ui = read('ui.css');
const a = app.indexOf('// ==== SHELL CORE BEGIN'), b = app.indexOf('// ==== SHELL CORE END ====');
const C = vm.runInNewContext(app.slice(a, b) + '\nShellCore', {});
const TABS = ['today', 'home', 'realestate', 'surf', 'shop', 'money', 'work', 'pad'];
const at = (o) => Object.assign({ cls: 'D', field: false, modal: false, tabs: TABS, tab: 'realestate', subs: ['residential', 'commercial'], sub: 'residential' }, o);
const key = (k, mods) => Object.assign({ key: k, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false }, mods);
const plain = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);

test('D keys: [ ] step tabs, { } step sub-tabs, 1-8 jump, / search, j k rows', () => {
  assert.deepEqual(plain(C.deskKey(key(']'), at())), { go: 'surf' });
  assert.deepEqual(plain(C.deskKey(key('['), at())), { go: 'home' });
  assert.deepEqual(plain(C.deskKey(key('}'), at())), { go: 'realestate/commercial' });
  assert.equal(C.deskKey(key('{'), at()), null, 'no sub before the first');
  assert.deepEqual(plain(C.deskKey(key('1'), at())), { go: 'today' });
  assert.deepEqual(plain(C.deskKey(key('8'), at())), { go: 'pad' });
  assert.equal(C.deskKey(key('3'), at()), null, 'the tab on screen');
  assert.equal(C.deskKey(key('9'), at()), null);
  assert.deepEqual(plain(C.deskKey(key('/'), at())), { search: true });
  assert.deepEqual(plain(C.deskKey(key('j'), at())), { row: 1 });
  assert.deepEqual(plain(C.deskKey(key('k'), at())), { row: -1 });
  assert.deepEqual(plain(C.deskKey(key(']'), at({ cls: 'XL' }))), { go: 'surf' }, 'XL is a D');
  assert.equal(C.deskKey(key(']'), at({ tab: 'pad' })), null, 'no wrap past Pad');
});

test('D keys stay out of the way: other classes, typing, an open sheet, modifiers', () => {
  for (const cls of ['P', 'L', 'T', 'TV']) assert.equal(C.deskKey(key(']'), at({ cls })), null, cls);
  assert.equal(C.deskKey(key('j'), at({ field: true })), null, 'typing a j in a field');
  assert.deepEqual(plain(C.deskKey(key('Escape'), at({ field: true }))), { blur: true });
  assert.equal(C.deskKey(key(']'), at({ modal: true })), null, 'a sheet has the keys');
  assert.equal(C.deskKey(key('1', { ctrlKey: true }), at()), null);
  assert.equal(C.deskKey(key('1', { metaKey: true }), at()), null);
  assert.equal(C.deskKey(key('j', { defaultPrevented: true }), at()), null, 'a page that took the key');
  // a guest reaches two tabs only
  const g = at({ tabs: ['home', 'pad'], tab: 'home', subs: ['house'], sub: 'house' });
  assert.deepEqual(plain(C.deskKey(key('2'), g)), { go: 'pad' });
  assert.equal(C.deskKey(key('3'), g), null);
  assert.equal(C.deskKey(key('}'), g), null);
});

test('a swipe steps one tab and stops at the ends', () => {
  assert.equal(C.step(TABS, 'surf', C.swipe(-80, 10)), 'shop', 'swipe left: next tab');
  assert.equal(C.step(TABS, 'surf', C.swipe(80, 10)), 'realestate');
  assert.equal(C.step(TABS, 'today', -1), '');
  assert.equal(C.step(TABS, 'pad', 1), '');
  assert.equal(C.step(TABS, 'nope', 1), '');
});

test('the swipe is P and L only and never starts on a table, a scroller, a strip, the Pad or a screen edge', () => {
  const sw = app.slice(app.indexOf("pager.addEventListener('touchstart'"), app.indexOf("pager.addEventListener('touchcancel'"));
  assert.match(sw, /dclass!=='P'&&dclass!=='L'/);
  assert.match(sw, /modalOpen\(\)/);
  assert.match(sw, /SH\.tab==='pad'/);
  assert.match(sw, /p\.clientX<24\|\|p\.clientX>innerWidth-24/);
  const no = app.match(/const NOSWIPE='([^']+)'/)[1].split(',');
  for (const s of ['table', '.htw', '.chips', '.seg', '.subrow', 'input', '.usmap', '.coast', '.chart', '#pgs', '#padpg', '#keyspg']) assert.ok(no.includes(s), s);
});

test('the active sub-tab is scrolled into view on every route change where its row can scroll (T)', () => {
  const go = app.slice(app.indexOf('function go(raw,opt)'), app.indexOf("document.dispatchEvent(new CustomEvent('deck:route'"));
  assert.match(go, /if\(changed\)\{[^}]*revealSub\(opt\.instant\)/);
  assert.match(app, /function revealSub\(instant\)\{const pg=PAGES\[page\],row=pg&&pg\.querySelector\('\.phead \.subrow'\)/);
});

test('L: the freshness mark has a copy in the bar; the header copy hides on L only', () => {
  assert.match(html, /<div id="topr"><span id="tact"><\/span><span id="tfresh"><\/span><button type="button" id="status"/);
  assert.match(app, /querySelector\('\.phead \.pact>\.fresh'\)/);
  const shell = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  assert.match(shell, /\n#tfresh,#tact\{display:none\}/);
  const l = shell.slice(shell.indexOf('@media (min-width:600px) and (max-height:499px){\n'));
  const block = l.slice(0, l.indexOf('\n}'));
  assert.match(block, /#tfresh,#tact\{display:contents\}/);
  // the L header row collapses: no visible title, no actions of its own, the freshness mark lives in the bar; the corner reserve stays.
  // The title stays in the tree, visually hidden (SeeAccess A3)
  assert.match(block, /\.phead\{min-height:0;padding:0 calc\(var\(--reserve\)\) 0 0/);
  assert.match(block, /\.phead>\.pact,\.phead \.fresh\{display:none\}/);
  assert.match(block, /#pager \.phead \.ptitle\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap\}/);
});

test('L: the page Filters button moves into the bar as itself when that saves a row, and moves back in every other class', () => {
  assert.match(app, /function moveFilters\(\)\{const pg=PAGES\[page\],slot=\$\('#tact'\)/);
  assert.match(app, /const alone=!!top&&!\[\.\.\.top\.children\]\.some\(c=>!c\.matches\('\.fbar-open,\.chips'\)\)/, 'the same test as the CSS that collapses the emptied row');
  assert.match(app, /if\(dclass==='L'&&alone\)\{if\(!inBar&&box\)slot\.appendChild\(box\);return\}/, 'the same element moves: [data-open-fbar] keeps working');
  assert.match(app, /if\(inBar\)\{if\(top\)top\.insertBefore\(inBar,top\.querySelector\('\.chips'\)\|\|null\);else inBar\.remove\(\)\}/, 'and goes back where it was');
  assert.match(app, /document\.addEventListener\('deck:class',\(\)=>syncBar\(\)\)/);
  const shell = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  const l = shell.slice(shell.indexOf('@media (min-width:600px) and (max-height:499px){'));
  const block = l.slice(0, l.indexOf('\n}'));
  assert.match(block, /\.fbar>\.fbar-top:not\(:has\(>:not\(\.fbar-open,\.chips\)\)\)\{display:none\}/, 'the emptied row goes');
  assert.doesNotMatch(shell.replace(block, ''), /#tact\{display:contents\}/, 'the bar slot is L only');
  assert.match(app, /let inBar=slot\.querySelector\('\.fbar-open'\);const box=sc\.querySelector\('\.fbar \.fbar-open'\)/, 'only the Filters button moves, never a scope or a search');
  assert.match(app, /if\(inBar&&box\)\{inBar\.remove\(\);inBar=null\}/, 'one control: a repainted row\'s new button replaces the stale copy in the bar');
  // which sub-page owns the button in the bar, and that it goes home on a route change: shell_filters_bar.test.js runs it
});

test('L: the status collapses to its mark and the freshness mark to its figure; P, L and T strips fade a hidden side, so no tab ends in a hard cut', () => {
  const shell = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  const block = shell.slice(shell.indexOf('@media (min-width:600px) and (max-height:499px){')).split('\n}')[0];
  assert.match(block, /#status\{max-width:var\(--hit\)\}/);
  assert.match(block, /#status>span:last-child\{display:none\}/, 'the words live in the Status sheet on L');
  assert.match(block, /#status>\.sd\{display:inline-block;background:var\(--c-text-3\)\}/, 'the mark shows even with nothing to report');
  assert.match(block, /#tfresh>\.fresh>\.fw\{display:none\}/, 'L: the bar copy of a warning mark drops its words');
  assert.match(block, /#tfresh>\.fresh\[data-short\]::after\{content:attr\(data-short\)/, 'and shows its figure');
  assert.doesNotMatch(shell.replace(block, '') + read('tv.css'), /\.fw\{display:none\}/, 'T, D and TV keep the words (P beside sub-tabs: shell_compact.test.js)');
  const edge = shell.slice(shell.indexOf('@media (max-width:1099px),(max-height:499px){')).split('\n}')[0];
  assert.match(edge, /#pgs\.more::after\{content:"";position:sticky;right:0/);
  assert.match(edge, /#pgs\.less::before\{content:"";position:sticky;left:0/);
  assert.equal((shell.match(/#pgs\.more::after/g) || []).length, 1, 'one fade rule for every class with a sideways strip (T834 cut "Mor" hard)');
  assert.match(app, /function tabEdges\(\)\{const s=\$\('#pgs'\);s\.classList\.toggle\('less'/);
});

test('a sub-tab hidden for a guest leaves no cell in the row', () => {
  const shell = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  assert.match(shell, /\.subrow>\[data-sub\]\[hidden\]\{display:none!important\}/);
  // the guest path hides the other subs by the attribute (app.js), so the rule is the one thing that keeps the row honest
  assert.match(app, /#pg-home \.subrow \[data-sub\]:not\(\[data-sub=house\]\)'\).forEach\(e=>\{e\.hidden=true/);
});
