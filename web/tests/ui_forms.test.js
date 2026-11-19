'use strict';
// node --test tests/ui_forms.test.js  (PlanDesign section 5 and M1, M2, M4, M7; PlanEng items 5, 19, 21; SeeViz V15, V17, V18; SeeAccess A1,
// A8; SeeSafari M3; SeeCode C10. One form per value and one control per role; no DOM, no network)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8');
const deck = read('deck.js'), css = read('ui.css');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const C = DeckCore, M = '\u2212';

test('delta: sign, true minus and a shape mark; flat once the printed value rounds to zero; pct, pt and bp', () => {
  assert.deepEqual(C.delta(-0.004, { d: 2 }), { text: '0.00%', dir: 'flat', html: '<span class="delta flat">0.00%</span>' });
  assert.deepEqual(C.delta(-1.2, { d: 2 }), { text: M + '1.20%', dir: 'down', html: '<span class="delta dn">' + M + '1.20%</span>' });
  assert.equal(C.delta(5.1, { kind: 'bp' }).text, '+5.1 bp');
  assert.equal(C.delta(0.8, { kind: 'pt' }).text, '+0.8 pt');
  assert.equal(C.delta(2.26).html, '<span class="delta up">+2.3%</span>');
  assert.deepEqual(C.delta(null), { text: null, dir: '', html: '' });
  assert.equal(D.delta, C.delta);
});

test('tile: one change line under the figure with its span word and the spark beside it; the figure is unchanged', () => {
  const plain = D.tile({ label: 'S&P 500', value: '5,870' });
  const t = D.tile({ label: 'S&P 500', value: '5,870', chg: { v: -0.36, d: 2 }, span: 'today', spark: '<svg class="spark"></svg>' });
  assert.equal(t.slice(0, t.indexOf('</b>') + 4), plain.slice(0, plain.indexOf('</b>') + 4), 'the figure keeps its markup and size');
  assert.match(t, /<span class="t chg"><span class="delta dn">\u22120\.36%<\/span><span class="sp">today<\/span><svg class="spark"><\/svg><\/span><\/div>$/);
  assert.match(D.tile({ label: 'x', value: '1', chg: 1.2 }), /<span class="t chg"><span class="delta up">\+1\.2%<\/span><\/span>/);
  assert.equal(D.tile({ label: 'x', value: '1', spark: '<svg></svg>' }), '<div class="tile"><span class="h">x</span><b class="v">1</b><svg></svg></div>', 'no change: as before');
  assert.match(css, /\.tile \.t\.chg\{[^}]*font-size:var\(--fs-lead\)/);
});

test('spark: a base hairline, a shared domain, percent from the first value, the change\'s span, and first and last in its name', () => {
  assert.equal(D.spark([1, 2, 3]), D.spark([1, 2, 3], {}), 'no options: as before');
  assert.doesNotMatch(D.spark([1, 2, 3]), /class="base"|data-span/);
  const s = D.spark([100, 102, 99, 104], { base: 100, span: 'today', label: 'SPY', fmt: (v) => '$' + v });
  assert.match(s, /<line class="base" x1="0" x2="120" y1="[\d.]+" y2="[\d.]+"\/>/);
  assert.match(s, /data-span="today"/);
  assert.match(s, /role="img" aria-label="SPY, \$100 to \$104"/);
  // one domain across a set: the same value sits at the same height in two sparks
  const a = D.spark([10, 20], { domain: [0, 40] }), b = D.spark([20, 30], { domain: [0, 40] });
  assert.equal(/cy="([\d.]+)" r="2.2"/.exec(a)[1], /points="0.0,([\d.]+)/.exec(b)[1]);
  // percent from the first value: two series with the same moves draw the same path
  assert.equal(D.spark([100, 110, 105], { pct: true }), D.spark([1000, 1100, 1050], { pct: true }));
});

test('line chart: no area fill above a zero floor (V15), tick labels in a gutter, and the name carries the label with first and last (A8)', () => {
  const series = [['Sep 2021', 250000], ['Sep 2026', 350000]];
  const h = D.line({ series, label: 'Home value' });
  assert.doesNotMatch(h, /class="ar"/, 'axis from $240K: no fill down to the floor');
  assert.match(h, /^<div class="chart lc"[^>]*aria-label="Home value: Sep 2021 \$250K, Sep 2026 \$350K">/);
  assert.match(D.line({ series: [['a', 0], ['b', 5]] }), /class="ar"/, 'an axis from zero keeps its fill');
  assert.match(css, /\.chart\.lc svg\{left:var\(--gut\);width:auto\}/);
});

test('bullet: a bar from zero to the value and one tick for the comparison, both named', () => {
  const h = D.bullet({ v: 6.1, ref: 7, label: 'Gross yield', refLabel: '30-yr rate', fmt: (x) => x.toFixed(1) + '%', max: 10 });
  assert.match(h, /^<div class="range bullet" style="--v:61%;--md:70%" role="img" aria-label="Gross yield 6\.1%, 30-yr rate 7\.0%"><span class="fill"><\/span><span class="med"><\/span><\/div>/);
  assert.match(h, /<div class="range-l"><span>6\.1%<\/span><span>30-yr rate 7\.0%<\/span><\/div>$/);
  assert.equal(D.bullet({ v: null }), '');
  assert.doesNotMatch(D.bullet({ v: 3 }), /class="med"/, 'no comparison, no tick');
});

test('group: same key and urgency become one row with each member its own link; a Now row never groups with a Soon row', () => {
  const rows = [
    { key: 'review', sev: 'now', name: 'Homelab Dictate', url: 'https://appstoreconnect.apple.com/a', mark: 'wait' },
    { key: 'review', sev: 'now', name: 'JudgeFinder.io', url: 'https://appstoreconnect.apple.com/b', mark: 'off' },
    { key: 'review', sev: 'soon', name: 'Shellboard', url: 'https://appstoreconnect.apple.com/c' },
    { key: 'review', sev: 'now', name: 'Shellboard', url: 'javascript:alert(1)', mark: 'off' },
    { key: '', sev: 'now', name: 'Gmail relink' },
  ];
  const g = D.group(rows, { key: (r) => r.key });
  assert.equal(g.length, 3);
  assert.equal(g[0].count, 3);
  assert.equal(g[0].mark, 'wait', 'the most urgent mark of its members');
  assert.deepEqual(g[1], { row: rows[2] }, 'a group of one stays a row');
  assert.deepEqual(g[2], { row: rows[4] });
  const h = D.groupRow(g[0], { title: '3 App Reviews to answer' });
  assert.match(h, /^<div class="frow grp" data-key="review"><span class="lead-mark sd wait" aria-hidden="true"><\/span><span class="fl"><b>3 App Reviews to answer<\/b>/);
  assert.equal((h.match(/<a class="gname" href="https:\/\/appstoreconnect\.apple\.com\/[ab]" target="_blank" rel="noopener noreferrer">/g) || []).length, 2);
  assert.match(h, /<span class="gname">Shellboard<\/span>/, 'an unsafe link is a plain name');
  assert.doesNotMatch(h, /javascript:/);
});

test('more: one row, "Show 12 more" and a quiet "Show fewer" on one data-more key; focus goes to the first new row (A1)', () => {
  assert.equal(C.more({ key: 'jobs', shown: 12, total: 40, step: 12 }), '<div class="more-row" data-more-row="jobs"><button type="button" class="btn" data-more="jobs">Show 12 more</button></div>');
  assert.equal(C.more({ key: 'jobs', shown: 36, total: 40, step: 12 }), '<div class="more-row" data-more-row="jobs"><button type="button" class="btn" data-more="jobs">Show 4 more</button><button type="button" class="btn btn-quiet" data-less="1" data-more="jobs">Show fewer</button></div>');
  assert.equal(C.more({ key: 'jobs', shown: 40, total: 40, step: 12 }), '<div class="more-row" data-more-row="jobs"><button type="button" class="btn btn-quiet" data-less="1" data-more="jobs">Show fewer</button></div>');
  assert.equal(C.more({ key: 'jobs', shown: 5, total: 5 }), '');
  assert.equal(C.more({ key: '"><img', shown: 1, total: 9 }), '', 'a key is a name, never markup');
  assert.equal(C.more({ key: 'x', shown: 0, total: 2500, step: 1200 }), '<div class="more-row" data-more-row="x"><button type="button" class="btn" data-more="x">Show 1,200 more</button></div>');
  assert.equal(C.moreFocus(['a', 'b'], ['a', 'b', 'c', 'd']), 'c');
  assert.equal(C.moreFocus(['a', 'b'], ['a', 'b']), null);
  // the shell's one handler: capture before the page repaints, focus without a scroll, never off where the reader went
  assert.match(deck, /closest\('\.more-row\[data-more-row\]>\[data-more\]'\)/);
  assert.match(deck, /DeckCore\.moreFocus\(before,keysIn\(sec\)\)/);
  assert.match(deck, /focus\(\{preventScroll:true\}\)/);
  assert.match(deck, /setTimeout\(schedule,0\)\},true\);/);
});

test('linkRow: visible words first, then the meta and the host; safeUrl, a new tab with no opener and no referrer; no link for a bad url', () => {
  assert.equal(C.linkRow({ url: 'https://www.zillow.com/homedetails/1', label: '100 Fixture Dr', meta: '3 BR', fig: '$1.85M', key: 'z1' }),
    '<a class="frow lrow" href="https://www.zillow.com/homedetails/1" target="_blank" rel="noopener noreferrer" data-key="z1"><span class="fl"><b>100 Fixture Dr</b><small>3 BR \u00B7 zillow.com</small></span><span class="fr"><b>$1.85M</b></span><span class="lk" aria-hidden="true">\u2197</span></a>');
  for (const url of ['javascript:alert(1)', 'https://a.test/"><img src=x>', 'data:text/html,x', null])
    assert.match(C.linkRow({ url, label: 'Row' }), /^<div class="frow lrow"><span class="fl"><b>Row<\/b><\/span><\/div>$/, String(url));
  assert.equal(C.linkRow({ url: 'https://example.com/a' }).includes('<b>example.com</b>'), true, 'no label: the host names it');
  assert.equal(C.linkRow({}), '');
});

test('status: one word set for ops and feeds; unknown is "Not reported", never Down; a rollup says it once', () => {
  assert.deepEqual(C.status('up'), { mark: 'ok', word: 'Up' });
  assert.deepEqual(C.status('down'), { mark: 'bad', word: 'Down' });
  assert.deepEqual(C.status('weird'), { mark: 'off', word: 'Not reported' });
  assert.deepEqual(C.status('not reporting'), { mark: 'bad', word: 'Not reporting' });
  assert.deepEqual(C.status('needs-key'), { mark: 'off', word: 'Needs a key' });
  assert.equal(C.rollup(['unknown', 'unknown', null, 'x', '', 'asleep']), '0 of 6 up \u00B7 5 not reported \u00B7 1 asleep');
  assert.equal(C.rollup(['up', 'up', 'down', 'degraded']), '2 of 4 up \u00B7 1 down \u00B7 1 degraded');
  assert.equal(C.label('AK', 'Alaska, score 49'), 'AK, Alaska, score 49');
});

test('state map legend: each bin a range of the values in it (V17); swatches near a cell; numbers line up (V18)', () => {
  const states = ['CA', 'TX', 'NY', 'FL', 'WA', 'OR', 'NV', 'AZ', 'UT', 'CO'].map((st, i) => ({ st, value: 44 + i }));
  const h = D.usmap(states, { bins: [46, 48, 50, 52], fmt: (v) => String(v) });
  assert.match(h, /<span data-q="1"><i><\/i>44-45<\/span><span data-q="2"><i><\/i>46-47<\/span>[^]*<span data-q="5"><i><\/i>52-53<\/span>/);
  const money = D.usmap([{ st: 'CA', value: 350000 }, { st: 'TX', value: 420000 }], { bins: [300000, 400000, 500000, 600000], fmt: (v) => '$' + v / 1000 + 'K' });
  assert.match(money, /<span data-q="2"><i><\/i>\$350K<\/span><span data-q="3"><i><\/i>\$420K<\/span>/);
  assert.match(D.usmap([{ st: 'CA', value: 1 }, { st: 'TX', value: 2 }], { bins: [10, 20, 30, 40], fmt: (v) => '$' + v }), /<span data-q="2"><i><\/i>\$10 to \$20<\/span>/, 'money ranges read "to"');
  assert.match(css, /\.usmap\+\.legend i\{width:1\.75em;height:1\.25em/);
  assert.match(css, /\.chart \.yt,\.chart \.xt,\.legend,\.rank-n,\.chips small,\.scf small\{font-variant-numeric:tabular-nums\}/);
});

test('hover tints only where a pointer hovers: a tapped Show more or row never stays tinted on a phone (SeeSafari M3)', () => {
  const outside = css.replace(/@media \(hover:hover\)\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const sel of ['.btn:hover', 'button.b:hover', '.btn-quiet:hover', '.btn-primary:hover', '.flist>button.frow:hover', '.flist>a.frow:hover', 'button.rank-row:hover', '.htbl tbody tr:hover', 'button.tile:hover', 'button.card:hover'])
    assert.ok(!outside.includes(sel), sel + ' outside @media (hover:hover)');
  assert.match(css, /\.flist>\.frow:focus-visible\{background:var\(--c-panel-2\)/, 'keyboard focus keeps its tint everywhere');
});

test('the two link renderers the sweep excused pass every url through safeUrl where they draw it (C10)', () => {
  const h = D.tdNeedsHtml({ items: [{ sev: 'high', text: 'Answer', url: 'javascript:alert(1)' }, { sev: 'high', text: 'Ok', url: 'https://a.test/x' }] }, []);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /<a href="https:\/\/a\.test\/x" target="_blank" rel="noopener noreferrer"/);
  const S = new Function('DeckUI', read('pages/shop.js') + '\nreturn DeckShop;')(D);
  const r = S.lstRowHtml({ count: 1, title: 'Piano', price: 300, site: 'eBay', url: 'javascript:alert(1)' }, Date.now(), false);
  assert.match(r, /^<div class="frow lrow-l" data-key="[^"]*">/);
  assert.doesNotMatch(r, /href=|javascript:/);
});

test('W4-2: on a window 1900 px and wider a list flows into columns of rows, so a value sits beside its name', () => {
  const m = /@media \(min-width:1900px\) and \(min-height:500px\)\{([^]*?)\n\}/.exec(css);
  assert.ok(m, 'one XL rule');
  assert.match(m[1], /html:not\(\.tv\) \.flist\{display:block;column-width:28rem;column-gap:var\(--s-7\)\}/);
  assert.match(m[1], /html:not\(\.tv\) \.flist>\*\{break-inside:avoid\}/, 'a row never splits across columns');
  assert.match(m[1], /\.flist>\.more-row[^{]*\{column-span:all\}/, 'Show more spans the list');
  assert.doesNotMatch(css.replace(m[0], ''), /\.flist\{[^}]*column-width/, 'no column rule below 1900 px: laptop and phones keep one column');
});
