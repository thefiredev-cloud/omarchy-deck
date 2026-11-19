'use strict';
// node --test tests/ui_core.test.js  (static/ui-core.js, PlanEng item 4: one helpers module, DeckCore; no DOM, no network)
// One name, loaded first on both pages, and the deck's own names are the very same functions, so moving them changed no output.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const core = read('static/ui-core.js'), deck = read('static/deck.js'), app = read('static/app.js');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const UI_BLOCK = cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const DeckUI = new Function(UI_BLOCK + '\nreturn DeckUI;')();
const scripts = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

test('ui-core.js declares one top-level name, DeckCore, and needs no other global', () => {
  const outside = core.replace(cut(core, 'const DeckCore=(()=>{', '\n})();').slice('const DeckCore=(()=>{'.length), '');
  const top = [...outside.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.deepEqual(top, ['DeckCore']);
  for (const n of ['esc', 'usd', 'safeUrl', 'fmt', 'money']) assert.equal(vm.runInNewContext(core + '\ntypeof ' + n, { DeckCore: undefined }), 'undefined', n + ' stays inside DeckCore');
  // the page's scripts share one global scope: DeckCore is declared nowhere else
  assert.doesNotThrow(() => new vm.Script([core, app, deck, read('static/pad.js')].join('\n;\n')));
  // an own DeckCore of undefined keeps the setup's copy out, so this is the file alone in an empty global
  const C = vm.runInNewContext(core + '\nDeckCore', { DeckCore: undefined });
  for (const k of ['esc', 'str', 'num', 'isObj', 'arr', 'safeUrl', 'fmt', 'ago', 'until', 'toEpoch', 'usd', 'compass']) assert.equal(typeof C[k], 'function', k);
  for (const k of ['money', 'rent', 'psf', 'lease', 'rate', 'share', 'chg', 'pt', 'count', 'date', 'month', 'time', 'age', 'temp', 'ft', 'period', 'wind', 'na', 'compass']) {
    assert.equal(typeof C.fmt[k], 'function', 'fmt.' + k);
  }
});

test('ui-core.js loads first: before app.js on the deck, before cre.js on /cre; the worker caches it and the server serves it', () => {
  const index = scripts(read('static/index.html'));
  assert.equal(index[0], '/ui-core.js', 'the first script of index.html');
  assert.equal(index.filter((s) => s === '/ui-core.js').length, 1);
  const cre = scripts(read('static/cre.html'));
  assert.ok(cre.indexOf('/ui-core.js') >= 0 && cre.indexOf('/ui-core.js') < cre.indexOf('/cre.js'), 'cre.html: ui-core.js before cre.js');
  assert.match(read('static/sw.js'), /\n '\/ui-core\.js',\n/);
  const main = read('rust/src/main.rs');
  assert.match(main, /static UI_CORE_JS: &\[u8\] = include_bytes!\("\.\.\/\.\.\/static\/ui-core\.js"\);/);
  assert.match(main, /"\/ui-core\.js" => Some\(\(UI_CORE_JS, "text\/javascript"\)\)/);
});

test('a deck script that runs before ui-core.js stops at once, never draws with a missing helper', () => {
  const stops = (e) => e && e.name === 'TypeError' && /DeckCore|'esc'/.test(e.message);
  assert.throws(() => vm.runInNewContext(UI_BLOCK + '\nDeckUI', { DeckCore: undefined }), stops);
  assert.throws(() => vm.runInNewContext("const $=()=>null;\n" + cut(app, 'const esc=', '\n') + '\nesc', { DeckCore: undefined }), stops);
});

test('the deck keeps its names, and each is the core function itself (so the move changed no output)', () => {
  for (const k of ['esc', 'fmt', 'toEpoch', 'ago', 'dur', 'until', 'usd', 'compass', 'safeUrl']) assert.equal(DeckUI[k], DeckCore[k], 'DeckUI.' + k);
  for (const k of Object.keys(DeckCore.fmt)) assert.equal(DeckUI.fmt[k], DeckCore.fmt[k], 'DeckUI.fmt.' + k);
  assert.equal(DeckUI.fmt.compass(250), 'W');
  // inside DeckUI the definitions are aliases now; the formats are written once, in ui-core.js
  assert.match(UI_BLOCK, /const \{esc,isObj,arr,num,str,fmt,toEpoch,lapse,ago,whole,dur,until,clock,usd,compass,safeUrl\}=DeckCore;/);
  assert.match(UI_BLOCK, /const \{money,rent,psf,lease,rate,share,chg,pt,count,date,month,time,age,temp,ft,period,wind,na,compass\}=DeckCore\.fmt,FMT=DeckCore\.fmt;/);
  for (const def of [/const esc=s=>/, /function money\(/, /const safeUrl=u=>/, /function ago\(/, /const usd=v=>/]) assert.doesNotMatch(UI_BLOCK, def);
});

test('one escape rule: app.js uses the core escape (the apostrophe too), and no copy escapes four characters', () => {
  assert.match(app, /\nconst esc=DeckCore\.esc;/);
  assert.match(cut(app, 'const ShellServices=env=>{', '// ==== SHELL SERVICES END'), /\n const esc=DeckCore\.esc;/);
  const files = ['app.js', 'cre.js', 'deck.js', 'house.js', 'invest.js', 'ops.js', 'schedules.js', 'agents.js', 'pad.js', 'tv.js', 'ui-core.js',
    'pages/realestate.js', 'pages/commercial.js', 'pages/surf.js', 'pages/shop.js', 'pages/world.js'].map((f) => [f, read('static/' + f)]);
  for (const [f, s] of files) assert.doesNotMatch(s, /\[&<>"\]\/g/, f + ': an escape without the apostrophe');
  // the copies the page lanes swap for the alias (PlanEng mechanism C); this count only goes down, to 1 (ui-core.js)
  const copies = files.flatMap(([f, s]) => (s.match(/\[&<>"'\]\/g/g) || []).map(() => f));
  assert.ok(copies.length <= 9, 'escape definitions: ' + copies.join(', '));
  assert.ok(copies.includes('ui-core.js'));
});

test('the moved helpers still say what they said', () => {
  const C = DeckCore;
  assert.equal(C.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(C.esc(null), '');
  assert.equal(C.esc(0), '0');
  assert.equal(C.safeUrl('https://example.test/a?b=1'), 'https://example.test/a?b=1');
  assert.equal(C.safeUrl('http://example.test/'), 'http://example.test/');
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'https://a.test/"x', 'https://user@a.test/', 'https://a.test/ b', '//a.test/', 42]) assert.equal(C.safeUrl(u), '', String(u));
  assert.equal(C.str('  a  ', 10), 'a');
  assert.equal(C.num(NaN), null);
  assert.equal(C.fmt(null), '--');
  assert.equal(C.fmt(3.14159, 2, '%'), '3.14%');
  assert.equal(C.ago(1000, 1000 * 1000 + 3 * 3600 * 1000), '3 h ago');
  assert.equal(C.until(1000 + 600, 1000 * 1000), 'in 10 min');
  assert.equal(C.usd(1250000), '$1.25M');
  assert.equal(C.fmt.money(1234567), '$1.23M');
  assert.equal(C.fmt.chg(2.26), '+2.3%');
  assert.equal(C.fmt.money(5, { masked: true }), '$\u2022\u2022\u2022');
  assert.equal(C.fmt.chg(-0.04), '0.0%');
  assert.equal(C.fmt.chg(2.25), '+2.3%');
  assert.equal(C.fmt.date('2026-11-15'), 'Nov 15');
  assert.equal(C.fmt.age(7200), '2 h');
  assert.equal(C.fmt.na('sheet'), 'No data');
  // the two compass rules (the leaf one and the v3 one) agree on every whole degree
  for (let d = -720; d <= 720; d++) assert.equal(C.compass(d), C.fmt.compass(d), String(d));
});
