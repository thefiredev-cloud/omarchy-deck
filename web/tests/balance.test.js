// The shared balancer (layout waves 2026-11-15): DeckUI.balanceColumns plans, DeckBalance in deck.js moves whole blocks into column
// boxes for any box with data-balance. A list, group or card never continues in another column; a block many screens tall is capped
// with Show more instead.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { measure } = require('./speed.js');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const start = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN');
const end = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(start, end) + '\nreturn DeckUI;')();
const glue = src.slice(end);
const read = (f) => fs.readFileSync(path.join(__dirname, '../static', f), 'utf8');
const cols = (hs, p, n) => { const c = new Array(n).fill(0); p.forEach((x, i) => { c[x] += hs[i]; }); return c; };
const ordered = (p) => p.every((c, i) => c <= Math.max(-1, ...p.slice(0, i)) + 1);

test('planner: every block whole, order kept, columns open in order, none empty, the tallest as short as whole blocks allow', () => {
  for (const [hs, n] of [[[720, 500, 270, 130, 330], 2], [[900, 560, 300, 90, 360], 3], [[400, 400, 400, 400, 400], 4], [[50, 900, 50, 50], 2]]) {
    const p = D.balanceColumns(hs, n);
    assert.equal(p.length, hs.length);
    assert.equal(p[0], 0, 'the first block opens the first column');
    assert.ok(ordered(p), 'columns open in order: ' + p);
    assert.equal(new Set(p).size, Math.min(n, hs.length), 'no empty column');
  }
  assert.deepEqual(D.balanceColumns([720, 500], 1), [0, 0], 'one column is the plain flow');
  assert.deepEqual(D.balanceColumns([300], 3), [0]);
  assert.deepEqual(D.balanceColumns([], 2), []);
  assert.equal(D.balanceColumns([null, 'x', -5], 2).length, 3, 'odd heights never throw');
});

test('planner: nine blocks (Markets and Launch at 932x430, measured) end within one short block of each other', () => {
  const markets = [211, 291, 134, 289, 535, 637, 786, 289, 289], launch = [620, 99, 475, 466, 447, 447, 428, 466, 372];
  for (const [hs, n] of [[markets, 2], [markets, 3], [launch, 2]]) {
    const p = D.balanceColumns(hs, n), c = cols(hs, p, n);
    assert.ok(ordered(p) && p[0] === 0, String(p));
    assert.ok(Math.max(...c) - Math.min(...c) <= 200, n + ' columns: ' + c);
  }
});

test('planner: past twelve blocks two columns take the best whole-block subset, three or more take reading order', () => {
  const hs = [470, 120, 420, 360, 360, 360, 360, 300, 300, 240, 240, 200, 200, 160];
  const two = D.balanceColumns(hs, 2), c2 = cols(hs, two, 2);
  assert.ok(ordered(two) && two[0] === 0, String(two));
  assert.ok(Math.max(...c2) - Math.min(...c2) <= 40, 'best subset: ' + c2);
  const three = D.balanceColumns(hs, 3), c3 = cols(hs, three, 3);
  assert.ok(three.every((x, i) => i === 0 || x >= three[i - 1]), 'contiguous, in reading order: ' + three);
  assert.ok(Math.max(...c3) <= hs.reduce((a, b) => a + b, 0) / 3 + Math.max(...hs), 'balanced within one block: ' + c3);
  // CPU per call against a calibration timed just before (tests/speed.js): the three plans read 0.4 units calm or throttled to a tenth
  // of a core. 5 units is 12 times that. Losing the pruning of the twelve-block search read 12 to 20 units in a scratch copy
  // (2026-11-15), and the exhaustive search run past twelve blocks never ends at 40: both fail.
  const plan = measure(() => {
    D.balanceColumns(new Array(40).fill(0).map((_, i) => 100 + (i * 37) % 300), 4);
    D.balanceColumns(new Array(40).fill(0).map((_, i) => 100 + (i * 37) % 300), 2);
    D.balanceColumns(new Array(12).fill(0).map((_, i) => 100 + (i * 53) % 400), 4);
  });
  assert.ok(plan.units < 5, 'large lists plan at once: ' + plan.units.toFixed(2) + ' units of ' + plan.unit.toFixed(2) + ' ms');
});

test('planner: a repaint with different row counts on Money > Markets moves a block across and stays balanced', () => {
  // Markets, Watchlist, Catalysts, Headlines, Movers at 932x430: Catalysts from 6 rows to 18 after Show more
  const before = [560, 980, 520, 520, 400], after = [560, 980, 1300, 520, 400];
  const a = D.balanceColumns(before, 2), b = D.balanceColumns(after, 2);
  assert.notDeepEqual(a, b, 'the split follows the new height');
  for (const [hs, p] of [[before, a], [after, b]]) {
    const c = cols(hs, p, 2), best = Math.max(...c);
    // no whole-block split does better than this one
    for (let m = 0; m < 1 << hs.length; m++) {
      const q = hs.map((_, i) => (m >> i) & 1);
      if (q[0] !== 0 || new Set(q).size < 2 || !ordered(q)) continue;
      assert.ok(Math.max(...cols(hs, q, 2)) >= best);
    }
  }
});

test('DeckBalance: one shared helper; it reruns on size and child changes, is off on the TV, and falls back to CSS columns', () => {
  assert.match(glue, /const DeckBalance=\(\(\)=>\{/);
  assert.match(glue, /new ResizeObserver\(/);
  assert.match(glue, /new MutationObserver\(/);
  assert.match(glue, /classList\.contains\('tv'\)\?1:count\(c\)/, 'one column on the TV');
  assert.match(glue, /try\{run\(c\)\}catch\(e\)\{try\{reset\(c\)\}catch\(x\)\{\}\}/, 'a failure leaves the plain CSS columns');
  const ui = read('ui.css');
  assert.match(ui, /\[data-balance\]\.bal\{columns:auto;display:grid;/, 'the grid exists only while .bal is set');
  assert.match(ui, /\.flow\{columns:var\(--col-w\) var\(--col-max\)/, '.flow is still CSS columns without the script');
});

test('a block reads the same height on the first run and on a rerun, so the plan holds on every page', () => {
  // The fault (Fleet, 2026-11-15): a rerun turns .bal off and measures the blocks inside their column boxes in plain CSS columns. There
  // they were not direct children, so a block that crossed a column break fragmented and read wrong (Product sites, 278 px, read as
  // 2,574) and lost its bottom padding; the plan stacked the page in one column (834: columns ended at 4,193 and 1,842 px).
  const ui = read('ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(ui, /\[data-balance\]>\*\{break-inside:avoid\}/, 'first run: a direct child never fragments, whatever the container');
  assert.match(ui, /\[data-balance\]>\.bal-col>\*\{break-inside:avoid;margin:0;padding-bottom:var\(--gap\)\}/, 'rerun: inside a column box a block never fragments and keeps its padding while .bal is off');
  assert.doesNotMatch(ui, /\[data-balance\]\.bal>\.bal-col>\*\{/, 'one rule for both states, not a .bal-only copy');
  const run = glue.slice(glue.indexOf(' function run(c){'), glue.indexOf(' function soon(c){'));
  assert.ok(run.indexOf('offsetHeight') > 0 && !run.slice(0, run.indexOf('offsetHeight')).includes('reset(c)'), 'run() never resets before measuring: that changes children every run and the observer loops');
});

test('opted-in pages: Today, Dev, Launch, Money > Markets and Fleet carry data-balance, and no list on them continues in another column', () => {
  assert.match(glue, /flow=box\('flow td'\);flow\.setAttribute\('data-balance',''\)/, 'Today');
  assert.match(src, /'<div class="flow" id="hdev" data-balance>'/, 'Dev');
  assert.match(read('agents.js'), /<div class="lmain" id="lnmain" data-balance>/, 'Launch');
  assert.match(read('invest.js'), /'<div class="flow" data-balance>'/, 'Money > Markets');
  assert.match(read('index.html'), /<div id="fleet" data-balance>/, 'Fleet');
  for (const f of ['ui.css', 'css/today.css', 'css/homeops.css', 'css/money.css', 'css/home.css']) {
    const css = read(f);
    assert.doesNotMatch(css, /break-inside:auto/, f + ': a block never continues in another column');
    assert.doesNotMatch(css, /box-decoration-break/, f);
  }
  assert.doesNotMatch(read('invest.js'), /iv-long/);
});
