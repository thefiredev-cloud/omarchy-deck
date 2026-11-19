'use strict';
// Layout wave 2026-11-15 (ShellL): on L the bar's freshness mark is compact (the mark and its figure; the words are its accessible
// name), and a .btn-sm is a full 44 px touch target wherever the pointer is coarse. Rules, not pixels: the shots live in the PR.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const src = read('deck.js'), ui = read('ui.css'), tv = read('tv.css');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const attr = (h, a) => { const m = new RegExp(' ' + a + '="([^"]*)"').exec(h); return m ? m[1] : null; };

test('a warning mark carries its figure for the compact L copy; the words stay its accessible name and its visible text elsewhere', () => {
  const miss = D.fresh({ age: 60, refresh: 3600, missing: 3 });
  assert.equal(attr(miss, 'data-short'), '3', 'the count');
  assert.equal(attr(miss, 'aria-label'), '3 parts not reporting. Open the Data sheet', 'the full phrase is the name');
  assert.equal(attr(miss, 'data-sheet'), 'data', 'a tap opens what it opened before');
  assert.match(miss, /<span class="sd warn"><\/span><span class="fw">3 parts not reporting<\/span><\/button>$/);
  assert.equal(text(miss), '3 parts not reporting');
  const old = D.fresh({ age: 3 * 86400, refresh: 3600 });
  assert.equal(attr(old, 'data-short'), '3 days', 'out of date: the age');
  assert.equal(text(old), 'Out of date \u00B7 3 days');
  const none = D.fresh({ age: null });
  assert.equal(attr(none, 'data-short'), null, 'not reporting: the mark alone');
  assert.equal(attr(none, 'aria-label'), 'Not reporting. Open the Data sheet');
  const ok = D.fresh({ age: 120, refresh: 3600 });
  assert.doesNotMatch(ok, /data-short|class="fw"/, 'a fresh mark is already short: unchanged');
});

test('the words hide in the L bar and on P (beside sub-tabs always, beside a title when the mark has a figure); T, D and TV keep them', () => {
  const shell = ui.slice(ui.indexOf('/* ===== shell ====='), ui.indexOf('/* ===== page ====='));
  const l = shell.slice(shell.indexOf('@media (min-width:600px) and (max-height:499px){')).split('\n}')[0];
  assert.match(l, /#tfresh>\.fresh>\.fw\{display:none\}/);
  assert.match(l, /#tfresh>\.fresh\[data-short\]::after\{content:attr\(data-short\)/);
  assert.match(l, /#tfresh>\.fresh\.warn\{min-width:var\(--hit\)/, 'a mark alone is still a 44 px target');
  assert.match(shell, /\n#tfresh,#tact\{display:none\}/, '#tfresh shows on L only');
  const blocks = ui.split('@media (max-width:599px){');
  const p = blocks.map((b) => b.split('\n}')[0]).find((b) => b.includes('.phead:has(.subrow) .pact>.fresh>.fw{display:none}'));
  assert.ok(p, 'P: beside sub-tabs (Mobile Safari 402 cut the active sub-tab under the fade)');
  assert.match(p, /\.phead:has\(\.subrow\) \.pact>\.fresh\[data-short\]::after\{content:attr\(data-short\)/);
  assert.match(p, /\.phead:has\(\.subrow\) \.pact>\.fresh\.warn\{min-width:var\(--hit\)/);
  // beside a title too once the mark has a figure: "Out of date · last read 1 min" and Try again cut "Today" to "T..." at 390 (L18)
  assert.match(p, /\.phead:not\(:has\(\.subrow\)\) \.pact>\.fresh\[data-short\]>\.fw\{display:none\}/);
  assert.match(p, /\.phead:not\(:has\(\.subrow\)\) \.pact>\.fresh\[data-short\]::after\{content:attr\(data-short\)/);
  assert.match(p, /\.phead:not\(:has\(\.subrow\)\) \.pact>\.fresh\.warn\[data-short\]\{min-width:var\(--hit\)/);
  assert.match(p, /\.phead:has\(\.subrow\) \.ptitle\{text-overflow:clip\}/, 'a visually hidden title never draws an ellipsis');
  assert.doesNotMatch(p, /\.phead:not\(:has\(\.subrow\)\) \.pact>\.fresh>\.fw\{/, 'a mark with no figure ("Not reporting") keeps its words beside a title');
  const hides = (ui + tv).match(/[^{}]*\.fw\b[^{]*\{[^}]*display:none[^}]*\}/g) || [];
  assert.equal(hides.length, 3, 'no other rule hides the words');
});

test('P sub-tab rows hold every sub-tab whole: two keep their width, five and up share it in equal cells, nothing scrolls (F2)', () => {
  const p = ui.split('@media (max-width:599px){').map((b) => b.split('\n}')[0]).find((b) => b.includes('.phead .subrow{flex:none;overflow:hidden}'));
  assert.ok(p, 'one P block for the sub-tab row');
  assert.match(p, /\.phead \.subrow:has\(>button:nth-child\(5\):not\(\[hidden\]\)\)>button\{flex:1 1 0;min-width:0;padding:0;font-size:var\(--fs-meta\)\}/);
  assert.match(p, /\.phead \.subrow:has\(>button:nth-child\(3\):not\(\[hidden\]\)\):not\(:has\(>button:nth-child\(5\):not\(\[hidden\]\)\)\)>button\{flex:1 1 0;min-width:0;padding:0 var\(--s-1\);font-size:var\(--fs-meta\)\}/,
    'three or four share the row too, so the mark stays whole (Real estate with Markets, L16 at 390)');
  assert.match(ui, /@media \(max-width:419px\)\{\.phead \.subrow:has\(>button:nth-child\(5\):not\(\[hidden\]\)\)>button\{font-size:var\(--fs-micro\)\}\}/, 'the floor only where meta does not fit');
  assert.doesNotMatch(ui, /\.subrow[^{}]*\{[^}]*scroll-snap/, 'no sub-tab row snaps or scrolls on P (the tab bar #pgs does, under 396 px)');
  assert.doesNotMatch(read('app.js'), /classList\.contains\('subrow'\)\)r\.classList\.toggle\('less'/, 'no fade class for a row that cannot scroll');
});

test('.btn-sm is the full control height on touch; a mouse on D and the TV keep the small step', () => {
  assert.match(ui, /\n\.btn-sm\{min-height:var\(--ctl-h\);font-size:var\(--fs-meta\)\}/, 'P, L, T and a touch D: 44 px (LayoutL 28-51, LayoutT 21-31)');
  assert.match(ui, /@media \(min-width:1100px\) and \(min-height:500px\) and \(hover:hover\) and \(pointer:fine\)\{\.btn-sm\{min-height:calc\(var\(--ctl-h\) - 8px\)\}\}/,
    'the same media as the 36 px density in tokens.css');
  assert.match(read('tokens.css'), /@media \(min-width:1100px\) and \(min-height:500px\) and \(hover:hover\) and \(pointer:fine\)\{:root\{--hit:36px;--ctl-h:36px/);
  assert.match(tv, /\nhtml\.tv \.btn-sm\{min-height:calc\(var\(--ctl-h\) - 8px\)\}/, 'TV unchanged, whatever pointer the set reports');
  assert.doesNotMatch(ui, /html\.tv/, 'TV rules stay in tv.css');
});

test('coast labels: under a 1200 px strip the unit is named once, on the first label, so neighbours never read as one string', () => {
  assert.match(ui, /\.coast ol\{[^}]*container:coast\/inline-size\}/);
  assert.match(ui, /@container coast \(max-width:1200px\)\{\.cs b>span\{display:none\}html:not\(\.tv\) \.coast ol>li:first-child \.cs b>span\{display:inline\}\}/);
  assert.match(read('pages/surf.js'), /<span class="sf-cu">\\u00A0ft<\/span><\/b>/, 'the unit is the label\'s one span (surf.js)');
});

