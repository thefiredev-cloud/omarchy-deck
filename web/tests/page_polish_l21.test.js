// Wave 2 page polish (L21, 2026-11-17): the page issues L18 found. Commercial says a real estate outage once; failed states use the shared
// crossed square; a mark with no figure says "No data" where the row holds it; the Filters button in the L bar is its mark and count;
// the Pad says its cause once; Residential uses the deck's "Try again in a moment."
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const block = (file, a, b) => { const s = read(file); return s.slice(s.indexOf(a), s.indexOf(b)); };
const DeckUI = new Function(block('static/deck.js', '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const DeckCRE = new Function(block('static/cre.js', '// ==== DECK CRE PURE BEGIN', '// ==== DECK CRE PURE END ====') + '\nreturn DeckCRE;')();
const C = new Function('DeckUI', 'DeckCRE', block('static/pages/commercial.js', '// ==== DECK COMMERCIAL PURE BEGIN', '// ==== DECK COMMERCIAL PURE END ====') + '\nreturn DeckCom;')(DeckUI, DeckCRE);
const css = read('static/ui.css');

test('Commercial: one cause, one state. Each failed part is named alone; two or three name the data; a loading part is not down', () => {
  const bad = { ok: false, status: 503 };
  assert.deepEqual(C.downParts({}), [], 'nothing answered yet: no state');
  assert.deepEqual(C.downParts({ sumDone: false, summary: null, rank: null, desk: { status: 'loading', data: null } }), [], 'still loading');
  assert.deepEqual(C.downParts({ sumDone: true, summary: null, rates: null, rank: bad, desk: { status: 'bad', data: null } }), ['market', 'zips', 'desk']);
  assert.deepEqual(C.downParts({ sumDone: true, summary: null, rates: { rates: {} }, rank: { ok: true }, desk: { status: 'ok', data: {} } }), [], 'the desk rates still feed the strip');
  assert.deepEqual(C.downParts({ sumDone: true, summary: {}, desk: { status: 'ok', data: { status: 'not_reporting' } } }), ['desk']);
  const all = C.downHtml(['market', 'zips', 'desk']);
  assert.equal((all.match(/class="es es-bad"/g) || []).length, 1, 'one failed state for the page');
  assert.match(all, /<svg class="es-i"[^]*?<rect /, 'the shared crossed square');
  assert.match(all, /Real estate data is not reporting\.<\/b><span class="es-l">Try again in a moment\.<\/span><button type="button" class="b es-retry" data-retry="commercial">Try again<\/button>/);
  assert.match(C.downHtml(['desk']), /<b class="es-t">Deal desk is not reporting\.<\/b>/, 'the desk failure is the shared DeckUI.empty failed state');
  assert.match(C.downHtml(['zips']), /Best ZIPs are not reporting\./);
  assert.equal(C.downHtml([]), '');
});

test('Commercial wiring: the state sits under the type switch, failed sections step aside, and no section draws its own copy of it', () => {
  const page = read('static/pages/commercial.js').split('// ==== DECK COMMERCIAL PURE END ====')[1];
  assert.match(page, /'<div class="com-fbar">'\+fbar\(\)\+'<\/div><div class="com-down"><\/div>'/);
  assert.match(page, /hide\('\.com-market',parts\.includes\('market'\)\);hide\('\.com-zips',parts\.includes\('zips'\)\);hide\('\.com-desk',parts\.includes\('desk'\)\);hide\('\.com-sc',parts\.includes\('desk'\)\)/);
  assert.doesNotMatch(page, /title:'Real estate data is not reporting\.',retry:'commercial'/, 'Best ZIPs no longer repeats the failure with its own Try again');
  assert.doesNotMatch(page, /el\.innerHTML=DeckUI\.empty\(\{k:'bad',title:'Real estate data is not reporting\.'\}\)/, 'nor does the strip');
  assert.match(page, /S\.sumDone=false/, 'a refresh waits for the rollups again before calling the market down');
  assert.match(read('static/css/commercial.css'), /\.com-main:not\(:has\(>\.sect:not\(\[hidden\]\)\)\)\{display:none\}/);
});

test('freshness: a feed with no age carries "No data" for the rows that have room; its words stay the spoken name', () => {
  const h = DeckUI.fresh({ age: null, refresh: 600 });
  assert.match(h, /^<button type="button" class="fresh warn" data-sheet="data" data-none="No data" aria-label="Not reporting\. Open the Data sheet"><span class="sd warn"><\/span><span class="fw">Not reporting<\/span><\/button>$/);
  assert.doesNotMatch(DeckUI.fresh({ age: 9000, refresh: 600 }), /data-none/, 'an out of date mark keeps its age figure');
  assert.doesNotMatch(DeckUI.fresh({ age: 60, refresh: 600 }), /data-none/);
  // L bar: always (eight tabs and the worded mark fit at 908); P: beside up to four sub-tabs from 360 px, never beside Home's six
  assert.match(css, /#tfresh>\.fresh\[data-none\]::after\{content:attr\(data-none\)\}/);
  assert.match(css, /@media \(min-width:360px\) and \(max-width:599px\)\{\s*\.phead:has\(\.subrow\):not\(:has\(\.subrow>button:nth-child\(5\):not\(\[hidden\]\)\)\) \.pact>\.fresh\[data-none\]::after\{content:attr\(data-none\)\}/);
  assert.doesNotMatch(css, /\.phead:not\(:has\(\.subrow\)\)[^{]*\[data-none\]/, 'beside a title "Not reporting" keeps its words');
});

test('L bar: a Filters button there is its mark and count; both Filters builders draw the mark, the word in its own span and a spoken name', () => {
  assert.match(css, /#tact>\.fbar-open\{position:relative;min-width:var\(--hit\);justify-content:center;gap:var\(--s-1\);padding:0 var\(--s-2\)\}/);
  assert.match(css, /#tact>\.fbar-open>\.fbw\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap\}/, 'visually hidden, never font-size 0 (the type-scale check reads that as a 0 px label)');
  assert.doesNotMatch(css, /#tact>\.fbar-open\{[^}]*font-size:0/);
  const jobs = DeckUI.jobs(null, {}, Date.now(), { person: 'tanner' });
  assert.match(jobs, /data-open-fbar="jobs" aria-haspopup="dialog" aria-label="Filters"><svg class="i" aria-hidden="true"><use href="#i-filter"\/><\/svg><span class="fbw">Filters<\/span><\/button>/);
  assert.match(DeckUI.filters({ id: 'res', count: 2 }), /aria-label="Filters, 2 set"><svg class="i" aria-hidden="true"><use href="#i-filter"\/><\/svg><span class="fbw">Filters<\/span> <span class="cnt">2<\/span><\/button>/);
});

test('Money > Accounts: a failed read is the failed state, never a warn wash', () => {
  const h = DeckUI.finPage({ error: 'HTTP 503' }, Date.now(), null);
  assert.match(h, /^<div class="es es-bad" role="status">/);
  assert.match(h, /Money is not reporting<\/b><span class="es-l">The source is not reporting\. Try again in a moment\.<\/span><button type="button" class="b es-retry" data-retry="money\/accounts">Try again<\/button>/);
  assert.doesNotMatch(h, /stale-bar|sd warn/);
});

test('Residential: the failed board says "Try again in a moment.", the deck-wide wording', () => {
  const re = read('static/pages/realestate.js');
  assert.match(re, /title:'Real estate data is not reporting\.',line:'Try again in a moment\.',retry:'page'/);
  assert.doesNotMatch(re, /Try again in a minute/);
});

test('Pad: with the link down the off panel tells the cause and the link line says Offline, so "Connection closed" shows once', () => {
  const pad = read('static/pad.js');
  const retry = pad.slice(pad.indexOf('function retry(why, kind)'), pad.indexOf('function disconnect()'));
  assert.match(retry, /status\('bad', 'Offline'\);/);
  assert.doesNotMatch(retry, /status\('bad', [^)]*why/, 'the cause is never on the link line too');
  const P = require('../static/pad.js');
  assert.equal(P.connectCopy('closed', 'Mini', 'Connection closed', 6).line, 'Connection closed. Trying again in 6 s.');
});
