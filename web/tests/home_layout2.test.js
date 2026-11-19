// node --test tests/home_layout2.test.js
// Home pages, layout second pass (2026-11-15): the rows the audit by eye found at phone, laptop and desktop. These pin the rules
// that fix them; the proof that the pages read well is the lane's shots in slices (the PR names the sizes).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deckJs = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deckJs.slice(deckJs.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deckJs.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();

const read = (f) => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const home = strip(read('css/home.css'));
const ops = strip(read('css/homeops.css'));
const app = read('app.js');
const deck = deckJs;
const NOW = Date.parse('2026-11-15T20:00:00Z');
const T = (s) => NOW / 1000 - s;

test('Background services opens at eight rows with Show N more, and lists every unit once it is tapped', () => {
  const failed = Array.from({ length: 21 }, (_, i) => 'unit-' + i + '.service');
  const u = { src: 'x', t: T(60), stale: false, writer_ok: true, failed_units: failed };
  const h = D.bUnits(u, NOW);
  assert.match(h, /<span>21 need attention<\/span>/, 'the title still counts every unit');
  assert.equal((h.match(/class="frow"/g) || []).length, 8);
  assert.match(h, /<button type="button" class="btn" data-more="fleetunits">Show 13 more<\/button>/);
  const all = D.board({ units: u }, NOW, { allUnits: true })[4];
  assert.equal((all.match(/class="frow"/g) || []).length, 21);
  assert.doesNotMatch(all, /data-more="fleetunits">Show \d+ more/);
  assert.equal((D.board({ units: u }, NOW)[4].match(/class="frow"/g) || []).length, 8, 'no option: eight');
  assert.match(app, /DeckUI\.board\(bd,now,\{allUnits:fleetUnitsAll,nodes:nd\}\)/);
  assert.match(app, /closest\('\[data-more="fleetunits"\]'\);if\(!b\)return;const less=!!b\.dataset\.less;fleetUnitsAll=!less;/);
});

test('House: products are one grouped list, five rows and Show more on P and L; the weather tile takes the row on P', () => {
  assert.match(home, /#prodg\{display:flex;flex-direction:column;/);
  assert.doesNotMatch(home, /#prodg>\*\{flex:1 1 13rem/, 'no tile grid left');
  assert.match(home, /@media \(max-width:599px\),\(min-width:600px\) and \(max-height:499px\)\{#prod:not\(\.open\) #prodg \.pgrp>:nth-child\(n\+6\)\{display:none\}#prod:not\(\.open\) #prodmore:not\(\[hidden\]\)\{display:flex\}\}/);
  assert.match(deck, /function prodMore\(\)/);
  assert.match(deck, /closest\('\[data-prodmore\]'\);if\(!b\)return;const p=\$\('#prod'\);if\(p\)p\.classList\.add\('open'\)/);
  const p = home.slice(home.indexOf('@media (max-width:599px){'));
  assert.match(p.slice(0, p.indexOf('\n}')), /#vit>\.flist\+\.wxt\{grid-column:1\/-1\}/);
});

test('House: the readings strip keeps each figure with its word ("of 125 GB", "load 12.44") and never puts a bad number in a style (X4)', () => {
  const H = new Function(app.slice(app.indexOf('// ==== HOUSE UI HELPERS BEGIN'), app.indexOf('// ==== HOUSE UI HELPERS END ====')) + '\nreturn HouseUI;')();
  const [cpu, ram, gpu] = H.readings({ cpu_pct: 59, load: [12.44, 9, 8], ram_pct: 57, ram_gb: 125.3, gpu_util: null });
  assert.equal(H.readTile(cpu), '<span class="h">CPU</span><b class="v">59%<span class="u">load 12.44</span></b><div class="bar"><i style="width:59%"></i></div>');
  assert.match(H.readTile(ram), /57%<span class="u">of 125 GB<\/span>/);
  assert.equal(H.readTile(gpu), '<span class="h">GPU</span><b class="v"><span class="na">No reading</span></b>', 'no figure, no bar');
  for (const bad of ['59;background:url(x)', '200', -5, NaN, null]) {
    const h = H.readTile(H.readings({ cpu_pct: bad })[0]);
    assert.doesNotMatch(h, /style=/, 'a value that is not a number from 0 to 100 never reaches a style: ' + bad);
    assert.match(h, /No reading/);
  }
  assert.match(home, /#hrd \.v \.u\{white-space:nowrap\}/, 'the unit never breaks from itself');
  assert.match(home, /#car \.bar\{overflow:visible\}\n#car \.bar>u\{position:absolute;top:-3px;bottom:-3px;width:2px;/, 'the car bar shows its charge-limit tick above and below the bar');
});

test('Cluster: on P the Model and Proxy tiles take the row; the benchmarks are a figure list with units, the same words as Fleet (V13)', () => {
  assert.match(home, /@media \(max-width:599px\)\{#cluster \.strip>\.tile:first-child,#cluster \.strip>\.tile:last-child\{grid-column:1\/-1\}/);
  const f = { t: T(5), engine: { status: 'up', served_name: 'm' }, bench: { prose_tps: 55.1, code_tps: 107.5, prefill_tps: 1977, conc6_tps: 131, at: T(4 * 86400) } };
  const c1 = D.cluster(f, NOW)[0];
  assert.match(c1, /Writing \u00B7 measured\u00A04\u00A0d\u00A0ago/);
  const rows = [...c1.matchAll(/<b>([^<]+)<\/b><\/span><span class="fr"><b class="fig">([^<]+)<\/b><small>([^<]+)<\/small>/g)].map((m) => m.slice(1).join(' '));
  assert.deepEqual(rows, ['Writing 55.1 tok/s', 'Coding 107.5 tok/s', 'Prefill 1,977 tok/s', '6 at once 131.0 tok/s']);
  const fleet = D.bCluster({ ok: true, model: 'm', running: 0, waiting: 0, kv_cache_pct: 1, bench: { date: '2026-11-12', t: T(60), fields: [{ k: 'prose_tps', v: 55.1 }, { k: 'code_tps', v: 107.5 }, { k: 'conc6_tps', v: 131 }, { k: 'prefill_tps', v: 1977 }] } }, NOW);
  assert.deepEqual([...fleet.matchAll(/<b>([^<]+)<\/b><\/span><span class="fr"><b class="fig">([^<]+)<\/b><small>([^<]+)<\/small>/g)].map((m) => m.slice(1).join(' ')), rows, 'one list, one set of words on both pages');
});

// W4-9 (SeeWs4): on the 2470 px window two one-value lines on Cluster ran 1,700 px across a full-width panel
test('Cluster: a one-value line in a wide panel stops at the reading measure (W4-9)', () => {
  assert.match(home, /#cluster \.tile\.wrap>:is\(\.v,\.t\),#cluster \.flist \.fl>small\{max-width:var\(--measure\)\}/);
  const pf = { t: T(60), enabled: true, stop: false, last_tick: T(60), runs_today: { total: 2 }, queue: { queued: 1, running: 0 },
    last_result: { outcome: 'rejected', gain: '-1.8%', title: 'IB_HCA both rails', note: "deltas {'prose_tps': -0.0379, 'code_tps': 0.002}", finished: T(3600) } };
  const h = D.perf(pf, NOW);
  assert.match(h, /<div class="tile wrap">/, 'the perf loop card is a wrap tile, so its value and line take the cap');
  assert.match(h, /<span class="fl"><b>Rejected · gain −1\.8%<\/b><small>IB_HCA both rails · Writing −3\.8%/, 'the last result line is the .fl small the cap reaches');
  const c1 = D.cluster({ t: T(60), engine: { status: 'up' }, ratchet: { last_outcome: 'APPLIED', last_date: '2026-11-12' } }, NOW)[0];
  assert.match(c1, /<div class="tile wrap"><div class="h"><i class="sd ok"><\/i>Tuning<\/div>/);
});

test('Crons: the phone search has room for its word in one row; job columns are two gaps apart', () => {
  assert.match(ops, /@media \(max-width:599px\)\{#scsel\{max-width:8\.75rem;padding-left:var\(--s-3\)\}#hcrons \.fix,#hcrons \.scfail\{padding-left:var\(--s-3\);padding-right:var\(--s-3\)\}\}/);
  assert.doesNotMatch(ops, /#hcrons \.hops-bar\{flex-wrap:wrap\}/, 'one row, so the first job stays in the first screen');
  assert.match(ops, /#sclist\{display:block;columns:26rem 3;column-gap:calc\(var\(--gap\) \* 2\)\}/);
});

test('Dev: two columns on D up to XL; Launch: the row title is a full-height target', () => {
  assert.match(ops, /@media \(min-width:1100px\) and \(max-width:1599px\) and \(min-height:500px\)\{html:not\(\.tv\) #hdev\{--col-max:2\}\}/);
  assert.match(ops, /\.lnrow \.lninfo\{[^}]*align-self:stretch;min-height:var\(--hit\);margin:calc\(var\(--row-pad\) \* -1\) 0;padding:var\(--row-pad\) 0;/);
});

test('Launch: the sticky side column clears the page header and scrolls inside itself when taller than the screen (not on TV)', () => {
  const m = /@media \(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) \.lside\{([^}]*)\}\}/.exec(ops);
  assert.ok(m, 'one D rule, off TV');
  assert.match(m[1], /top:calc\(var\(--sticky-top\) \+ var\(--s-3\)\)/, 'sticks under the header, from the header\'s own height');
  assert.match(m[1], /max-height:calc\(100dvh - var\(--sticky-top\) - var\(--s-3\) - var\(--s-8\)\)/, 'never taller than the screen below it, with a foot gap that keeps the title clear at the page foot');
  assert.match(m[1], /overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin/);
  assert.match(app, /setProperty\('--sticky-top'/, 'app.js sets the header bottom');
});
