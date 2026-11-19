'use strict';
// Layout wave 2 (2026-11-15, LayoutP 34-42): sheets and shared controls on a phone. Rules, not pixels.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const src = read('deck.js'), ui = read('ui.css');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();

test('Data sheet: each switch is a 44 px label row, so a tap on its words toggles it (P 42)', () => {
  const h = D.dataSheet({ display: { tv: true } });
  assert.match(h, /<label class="toggle-row"><span>TV view<\/span><input type="checkbox" data-display="tv" checked><\/label>/);
  assert.match(h, /<label class="toggle-row"><span>Always-on display<\/span><input type="checkbox" data-display="always-on"><\/label>/);
  assert.match(ui, /\.toggle-row\{[^}]*min-height:var\(--hit\)/);
  assert.match(ui, /\.toggle-row>input\[type="checkbox"\]\{[^}]*width:1\.5rem;height:1\.5rem/);
});

test('Data sheet: Method reads as prose, full width under its label in the body face; other lists keep mono figures (P 41)', () => {
  const h = D.dataSheet({ method: [['Tide', 'Height from the nearest NOAA station, 0-1 ft bins, every 24 h']] });
  assert.match(h, /<dl class="kv prose"><div><dt>Tide<\/dt><dd>/);
  assert.match(ui, /\.kv\.prose\{grid-template-columns:minmax\(0,1fr\);max-width:none\}/);
  assert.match(ui, /\.kv\.prose dd\{[^}]*font-family:inherit;[^}]*text-align:left/);
  assert.match(ui, /\.kv dd\{[^}]*font-family:var\(--mono\)[^}]*text-align:right/, 'figures elsewhere stay mono, right-aligned');
});

test('an age drawn beside other words never breaks inside itself (P 40, D 9)', () => {
  const core = read('ui-core.js'), start = core.indexOf('const whole=');
  const whole = new Function('return ' + core.slice(start + 'const whole='.length, core.indexOf('\n', start)).replace(/;$/, ''))();
  assert.equal(whole('Nov 15, 9:08 am \u00B7 3 h ago'), 'Nov 15, 9:08 am \u00B7 3\u00A0h\u00A0ago');
  assert.equal(whole('measured 4 d ago'), 'measured 4\u00A0d\u00A0ago');
  assert.equal(whole('12 min ago'), '12\u00A0min\u00A0ago');
  assert.equal(whole('just now'), 'just now');
  assert.match(src, /const dwhen=[^\n]*whole\(ago\(e,now\)\)/, 'the Dev sheet times');
  assert.match(src, /when=b\.at==null\?'':cday\(b\.at\)\|\|whole\(ago\(b\.at,now\)\)/, 'the Cluster speed note');
});

test('Today Status sheet: the fleet figure is a bare count under its label; run times sit under their names (P 36, 37)', () => {
  const s = src.slice(src.indexOf('function tdStatusSheet('), src.indexOf('\n\n', src.indexOf('function tdStatusSheet(')));
  assert.match(s, /label:hc&&hc\.count\?'Fleet problems':'Fleet check',value:hc\?\(hc\.count\?n\(hc\.count\):'All clear'\)/);
  assert.match(s, /tdSRow\(str\(j\.name,40\)\|\|'Automation','Next run, '\+at\(j\.at\)\)/);
  assert.match(s, /tdSRow\(str\(j\.name,40\)\|\|'Briefing',at\(j\.at\)\)/);
});

test('shared controls: a sheet\'s three tiles sit three across; a segmented control is 44 px with its border (P 38, 34)', () => {
  assert.match(ui, /\ndialog\.sheet \.strip\[data-nb="3"\]\{--cols:3\}/);
  assert.doesNotMatch(ui, /\n\.strip\[data-nb="3"\]/, 'sheets only: a page strip keeps its own columns');
  assert.match(ui, /\.seg\{[^}]*border:1px solid/);
  assert.match(ui, /\.seg>button\{[^}]*min-height:calc\(var\(--ctl-h\) - 2px\);/, '42 px buttons inside a 1 px border: a 44 px control');
});
