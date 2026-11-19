'use strict';
// v3 shared helpers in static/deck.js (DeckUI, plan/design/UiApi.md §3 and §6.3): formats, marks, tiles, table, charts, map, coast, states, filters, money, Data sheet.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const F = D.fmt;
const M = '\u2212';
// visible text of a fragment: tags out, entities back
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const count = (h, re) => (h.match(re) || []).length;

// ---------------- formats (blueprint 2.4) ----------------
test('money: B, M, K, exact under $10K, cents on request, true minus, masked, null never $0', () => {
  // the one money form (PlanDesign section 5, tests/fixtures/formats.json): M keeps two places and B one, trailing zeros kept
  const cases = [[1240000, '$1.24M'], [845000, '$845K'], [9450, '$9,450'], [340244e6, '$340.2B'], [1e9, '$1.0B'], [2e6, '$2.00M'], [1.2e6, '$1.20M'],
    [10000, '$10K'], [9999.4, '$9,999'], [9999.6, '$10K'], [999400, '$999K'], [999600, '$1.00M'], [999.96e6, '$1.0B'], [0, '$0'], [0.4, '$0'], [-1.2e6, M + '$1.20M'], [-9450, M + '$9,450']];
  for (const [v, want] of cases) assert.equal(F.money(v), want, String(v));
  assert.equal(F.money(10.98, { cents: true }), '$10.98');
  assert.equal(F.money(6.13, { cents: true }), '$6.13');
  assert.equal(F.money(1234.5, { cents: true }), '$1,234.50');
  assert.equal(F.money(12345, { cents: true }), '$12K', 'cents only under $10K');
  assert.equal(F.money(10.98), '$11');
  assert.equal(F.money(1240000, { masked: true }), '$\u2022\u2022\u2022');
  for (const v of [null, undefined, NaN, Infinity, '5', {}]) assert.equal(F.money(v), null, String(v));
});

test('rent, price per SF and lease rates', () => {
  assert.equal(F.rent(2450), '$2,450/mo');
  assert.equal(F.psf(412), '$412/SF');
  assert.equal(F.lease(18), '$18/SF/yr');
  assert.equal(F.rent(null), null);
  assert.equal(F.psf(null), null);
});

test('percent: rates to 2, shares to 1, changes signed with a true minus, points, zero has no sign', () => {
  assert.equal(F.rate(7.183), '7.18%');
  assert.equal(F.rate(0), '0.00%');
  assert.equal(F.rate(-0.5), M + '0.50%');
  assert.equal(F.share(17.14), '17.1%');
  assert.equal(F.chg(4.2), '+4.2%');
  assert.equal(F.chg(-1.3), M + '1.3%');
  assert.equal(F.chg(0), '0.0%');
  assert.equal(F.chg(-0.04), '0.0%', 'a change that rounds to zero carries no sign');
  assert.equal(F.chg(0.05), '+0.1%');
  assert.equal(F.pt(0.4), '+0.4 pt');
  assert.equal(F.pt(-0.4), M + '0.4 pt');
  assert.ok(!/-/.test(F.chg(-1.3) + F.pt(-2) + F.money(-5)), 'never a hyphen-minus');
  for (const f of ['rate', 'share', 'chg', 'pt']) assert.equal(F[f](null), null, f);
});

test('counts: exact under 10,000, then K, M, B with one decimal', () => {
  const cases = [[9450, '9,450'], [9999, '9,999'], [10000, '10.0K'], [12400, '12.4K'], [999940, '999.9K'], [999960, '1.0M'], [1200000, '1.2M'], [2.5e9, '2.5B'], [0, '0'], [-12400, M + '12.4K']];
  for (const [v, want] of cases) assert.equal(F.count(v), want, String(v));
  assert.equal(F.count(null), null);
});

test('dates, months, times and ages', () => {
  assert.equal(F.date('2026-11-14'), 'Nov 14');
  assert.equal(F.date('2026-01-01'), 'Jan 1', 'a calendar date never shifts a day by time zone');
  assert.equal(F.date('2026-11-14', { year: true }), 'Nov 14, 2026');
  assert.equal(F.month('2026-09'), 'Sep 2026');
  assert.equal(F.month('2026-09-30'), 'Sep 2026');
  assert.equal(F.time(new Date(2026, 10, 14, 16, 10).getTime() / 1000), '4:10 pm', 'epoch seconds');
  assert.equal(F.time(new Date(2026, 10, 14, 0, 5).getTime()), '12:05 am', 'epoch ms');
  assert.equal(F.time(new Date(2026, 10, 14, 12, 0)), '12:00 pm');
  const ages = [[0, '1 min'], [30, '1 min'], [300, '5 min'], [3540, '59 min'], [3570, '1 h'], [3 * 3600, '3 h'], [47 * 3600, '47 h'], [47.6 * 3600, '2 days'], [2 * 86400, '2 days'], [10 * 86400, '10 days']];
  for (const [s, want] of ages) assert.equal(F.age(s), want, String(s));
  for (const f of ['date', 'month', 'time', 'age']) assert.equal(F[f](null), null, f);
  assert.equal(F.age(-5), null);
  assert.equal(F.date('not a date'), null);
});

test('units: temperature, wave range, period, wind with compass', () => {
  assert.equal(F.temp(64.4), '64\u00B0F');
  assert.equal(F.temp(-3.6), M + '4\u00B0F');
  assert.equal(F.ft(4.9, 5.6), '5-6 ft');
  assert.equal(F.ft(5, 5.2), '5 ft');
  assert.equal(F.ft(3, null), '3 ft');
  assert.equal(F.period(14), '14 s');
  assert.equal(F.wind(8, 315), '8 kt NW');
  assert.equal(F.wind(8, 350), '8 kt N');
  assert.equal(F.wind(8, null), '8 kt');
  assert.equal(F.wind(null, 90), null);
  assert.equal(F.ft(null, null), null);
});

test('missing mark: a muted dot in tables, "No data" in sheets; the old fmt still answers', () => {
  assert.equal(F.na(), '<span class="na" aria-label="No data">\u00B7</span>');
  assert.equal(F.na('sheet'), 'No data');
  assert.equal(D.fmt(3.14159, 1, ' GB'), '3.1 GB', 'old fmt(n, dp, unit) callers keep working');
  assert.equal(D.fmt(null), '--');
});

// ---------------- confidence, freshness, marks ----------------
test('confidence: three levels at .75 and .5, aria words, nothing for a single source', () => {
  const c = (s, o) => /data-c="(\d)"/.exec(D.conf(s, o));
  assert.equal(c(0.75)[1], '3');
  assert.equal(c(0.74)[1], '2');
  assert.equal(c(0.5)[1], '2');
  assert.equal(c(0.49)[1], '1');
  assert.equal(c(0)[1], '1');
  assert.match(D.conf(0.8, { agree: 4, total: 4 }), /role="img" aria-label="High confidence: 4 of 4 sources agree"/);
  assert.match(D.conf(0.6, { agree: '2 of 3' }), /aria-label="Medium confidence: 2 of 3 sources agree"/);
  assert.equal(D.conf(0.9, { total: 1 }), '', 'single-source values carry no mark');
  assert.equal(D.conf(null), '');
  assert.equal(count(D.conf(0.2), /<i><\/i>/g), 3);
  assert.doesNotMatch(text(D.conf(0.9)), /\w/, 'never a word on the page');
});

test('freshness: age when fresh, Out of date over 2x refresh, parts not reporting, never-reported', () => {
  const fresh = D.fresh({ age: 3 * 86400, refresh: 7 * 86400 });
  assert.match(fresh, /^<button type="button" class="fresh" data-sheet="data" aria-label="Updated 3 days ago\. Open the Data sheet">3 days<\/button>$/);
  const stale = D.fresh({ age: 3 * 86400, refresh: 3600 });
  assert.match(stale, /class="fresh warn"/);
  assert.equal(text(stale), 'Out of date \u00B7 3 days');
  assert.match(stale, /<span class="sd warn"><\/span>/);
  assert.equal(text(D.fresh({ age: 7200, refresh: 3600 })), '2 h', 'exactly 2x is not yet stale');
  assert.equal(text(D.fresh({ age: 60, refresh: 3600, missing: 2 })), '2 parts not reporting');
  assert.equal(text(D.fresh({ age: 60, refresh: 3600, missing: 1 })), '1 part not reporting');
  assert.equal(text(D.fresh({ age: null })), 'Not reporting');
});

test('stale bar: one status line with one Try again', () => {
  const b = D.staleBar({ age: 3 * 86400, refresh: 3600, retry: 'realestate' });
  assert.equal(text(b), 'Out of date \u00B7 3 days Try again');
  assert.equal(count(b, /data-retry=/g), 1);
  assert.match(D.staleBar({ k: 'bad', retry: 'surf' }), /class="stale-bar bad"[^]*Not reporting[^]*data-retry="surf"/);
  assert.doesNotMatch(D.staleBar({ age: 9e5, refresh: 60, retry: 'x" onclick="y' }), /onclick/);
});

test('marks, pills, pips and cap-rate marks', () => {
  assert.equal(D.mark('warn'), '<span class="sd warn"></span>');
  assert.equal(D.mark('nope'), '<span class="sd off"></span>');
  assert.equal(D.pill('warn', 'Out of date'), '<span class="pill warn"><span class="sd warn"></span>Out of date</span>');
  assert.equal(D.pill('off', 'Needs a key'), '<span class="pill"><span class="sd off"></span>Needs a key</span>');
  assert.match(D.pips(4, 'Good'), /^<span class="pips" data-q="4"><span aria-hidden="true">(<i><\/i>){5}<\/span>Good<\/span>$/);
  assert.match(D.pips(9, 'Great'), /data-q="5"/);
  assert.match(D.capMark('listed'), /class="capm"[^]*Listed cap rate/);
  assert.match(D.capMark('est'), /class="capm est"[^]*Estimated cap rate/);
});

// ---------------- tiles and strip ----------------
test('tile: escaped text, confidence meter after the value and unit inside .v, no tile for a missing value', () => {
  const t = D.tile({ label: 'Home <value>', value: '$368K', unit: '/mo', sub: 'of listings', conf: D.conf(0.62, { agree: 2, total: 3 }) });
  assert.match(t, /^<div class="tile"><span class="h">Home &lt;value&gt;<\/span><b class="v">\$368K<span class="u">\/mo<\/span><span class="conf" data-c="2"[^>]*>(<i><\/i>){3}<\/span><\/b>/);
  assert.match(t, /<\/b><span class="t">of listings<\/span><\/div>$/);
  assert.equal(D.tile({ label: 'Vacancy', value: null }), '');
  assert.equal(D.tile({ label: 'Vacancy', value: '' }), '');
  assert.match(D.tile({ label: 'x', value: '1', cls: 'dx evil' }), /class="tile dx"/);
  assert.match(D.tile({ label: 'x', value: '1', open: 'zip', key: '92647' }), /^<button type="button" class="tile" data-open="zip" data-key="92647">/);
});

test('tile model:true marks a model-only value, keeps the value readable and escaped', () => {
  const t = D.tile({ label: 'Waves', value: '4-5 <ft>', model: true, conf: D.conf(0.4, { agree: 1, total: 3 }) });
  assert.match(t, /<b class="v"><span class="model" title="Model forecast, no buoy nearby">4-5 &lt;ft&gt;<span class="vh">, model forecast, no buoy nearby<\/span><\/span><span class="conf" data-c="1"/);
  assert.doesNotMatch(t, /role="img" aria-label="Model/, 'the value stays in the accessible name: no label that replaces it');
  assert.doesNotMatch(D.tile({ label: 'Waves', value: '5 ft' }), /class="model"/, 'measured values carry no mark');
  assert.equal(D.tile({ label: 'Waves', value: null, model: true }), '', 'a missing value still gets no tile');
});

test('strip: counts tiles (n) and non-D tiles (nb), drops missing tiles, labels the group', () => {
  const tiles = [D.tile({ label: 'a', value: '1' }), D.tile({ label: 'b', value: null }), D.tile({ label: 'c', value: '2', cls: 'dx' }), D.tile({ label: 'd', value: '3', cls: 'sm dx' })];
  const s = D.strip(tiles, { label: 'United States' });
  assert.match(s, /^<div class="strip" data-n="3" data-nb="1" role="group" aria-label="United States">/);
  assert.equal(D.strip([D.tile({ label: 'x', value: null })]), '');
  assert.match(D.strip('<button class="tile">a</button><a class="tile sm">b</a>'), /data-n="2" data-nb="2"/);
});

// ---------------- table with phone cards (blueprint 2.5) ----------------
const COLS = [{ key: 'zip', label: 'ZIP', place: true, sub: (r) => r.city }, { key: 'score', label: 'Score', num: true, sort: true },
  { key: 'rent', label: 'Rent', num: true, pri: 2, fmt: (v) => F.rent(v) }, { key: 'grade', label: 'Grade', pri: 3 }, { key: 'pop', label: 'Population', num: true, pri: 4, fmt: (v) => F.count(v) }];
const ROWS = [{ zip: '92647', city: 'Huntington <Beach>', score: 80, rent: 2450, grade: 'A', pop: 33000 }, { zip: '92624', city: 'Capo', score: null, rent: null, grade: null, pop: null },
  { zip: '92672', city: 'San Clemente', score: 91, rent: 3100, grade: 'B', pop: 64000 }];

test('table: frozen place column, data-l on every cell, data-pri on P2-P4 cells only, open rows focusable', () => {
  const h = D.table({ cols: COLS, rows: ROWS, key: (r) => r.zip, open: 'zip', sorted: { key: 'score', dir: 'descending' } });
  assert.match(h, /^<div class="htw"><table class="htbl">/);
  const cells = h.match(/<t[dh] [^>]*>/g).filter((c) => !/scope="col"/.test(c));
  assert.equal(cells.length, ROWS.length * COLS.length);
  for (const c of cells) assert.match(c, /data-l="[^"]+"/, 'phone card label on ' + c);
  const labels = h.match(/<tr [^>]*>[^]*?<\/tr>/)[0].match(/data-l="([^"]+)"/g).map((x) => x.slice(8, -1));
  assert.deepEqual(labels, ['ZIP', 'Score', 'Rent', 'Grade', 'Population']);
  assert.equal(count(h, /data-pri="2"/g), 1 + ROWS.length);
  assert.equal(count(h, /data-pri="3"/g), 1 + ROWS.length);
  assert.equal(count(h, /data-pri="4"/g), 1 + ROWS.length);
  assert.equal(count(h, /data-pri="1"/g), 0, 'P1 is unmarked');
  assert.match(h, /<th scope="row" data-l="ZIP"><span class="place"><b>92672<\/b><small>San Clemente<\/small><\/span><\/th>/);
  assert.equal(count(h, /<tr tabindex="0" data-open="zip" data-key="\d+">/g), 3);
  assert.match(h, /<th scope="col" class="n" aria-sort="descending"><button type="button" class="sort" data-sort="score">Score<\/button><\/th>/);
});

test('table: sorts high to low with missing last; missing cells get the dot; no raw < or > in cell text', () => {
  const h = D.table({ cols: COLS, rows: ROWS, key: (r) => r.zip, sorted: { key: 'score', dir: 'descending' } });
  assert.deepEqual(h.match(/data-key="(\d+)"/g), ['data-key="92672"', 'data-key="92647"', 'data-key="92624"']);
  const capo = h.match(/<tr[^>]*data-key="92624">[^]*?<\/tr>/)[0];
  assert.equal(count(capo, /class="na" aria-label="No data"/g), 4);
  assert.doesNotMatch(capo, />0</, 'a missing value is never 0');
  for (const cell of h.match(/<td[^>]*>[^]*?<\/td>|<th scope="row"[^>]*>[^]*?<\/th>/g)) {
    const inner = cell.replace(/^<t[dh][^>]*>|<\/t[dh]>$/g, '').replace(/<\/?(span|b|small)[^>]*>/g, '');
    assert.doesNotMatch(inner, /[<>]/, 'escaped cell text ' + cell);
  }
  assert.match(h, /Huntington &lt;Beach&gt;/);
  const asc = D.table({ cols: COLS, rows: ROWS, key: (r) => r.zip, sorted: { key: 'score', dir: 'ascending' } });
  assert.deepEqual(asc.match(/data-key="(\d+)"/g), ['data-key="92647"', 'data-key="92672"', 'data-key="92624"'], 'missing stays last both ways');
  assert.doesNotMatch(asc.match(/<tr[^>]*>/)[0], /tabindex/, 'rows without open are plain text rows');
});

test('table: 50 rows then one Show more; cell() markup is the page\'s and an empty cell becomes the dot', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ zip: String(10000 + i), score: i }));
  const h = D.table({ id: 'best', cols: COLS.slice(0, 2), rows, key: (r) => r.zip });
  assert.equal(count(h, /<tr data-key/g), 50);
  assert.match(h, /<div class="more-row"><button type="button" class="btn" data-more="best">Show 50 more<\/button><\/div>$/);
  assert.match(D.table({ cols: COLS.slice(0, 2), rows: rows.slice(0, 60), max: 50 }), />Show 10 more</);
  assert.doesNotMatch(D.table({ cols: COLS.slice(0, 2), rows: rows.slice(0, 50) }), /more-row/);
  const c = D.table({ cols: COLS.slice(0, 2), rows: ROWS, cell: (r, col) => (col.key === 'score' ? (r.score == null ? '' : '<b>' + r.score + '</b>' + D.conf(0.6)) : undefined) });
  assert.match(c, /<td class="n" data-l="Score"><b>80<\/b><span class="conf"/);
  assert.match(c, /<td class="n" data-l="Score"><span class="na"/);
});

// ---------------- charts ----------------
test('sparkline: one polyline per run, a gap for missing days, an end dot, nothing under two points', () => {
  const s = D.spark([1, 2, null, 4, 5, null, 7, 8], { w: 120, h: 24 });
  assert.match(s, /^<svg class="spark" viewBox="0 0 120 24"/);
  assert.equal(count(s, /<polyline class="ln"/g), 3);
  assert.equal(count(s, /class="dot"/g), 1);
  assert.match(D.spark([1, null, 3, null, 5], {}), /r="1.4"/, 'an isolated day is a small dot');
  assert.equal(D.spark([null, 4], {}), '');
  assert.equal(D.spark([], {}), '');
  assert.match(D.spark([1, 2], { label: 'Price, 30 days' }), /role="img" aria-label="Price, 30 days"/);
  assert.doesNotMatch(s + D.spark([1, 2], {}), /data:|blob:|style="(?!--)/);
});

test('line chart: nice axis holding the max, three ticks, two x labels, reference, now marker, gaps', () => {
  const series = [['Sep 2021', 1.29e6], ['Sep 2022', 1.5e6], ['Sep 2023', null], ['Sep 2024', 1.6e6], ['Sep 2026', 1.79e6]];
  const h = D.line({ series, ref: series.map(([l, v]) => [l, v && v * 0.9]), now: 4 });
  const ticks = h.match(/<span class="yt" style="--y:[\d.]+%">([^<]*)<\/span>/g).map((x) => text(x));
  assert.deepEqual(ticks, ['$1.80M', '$1.40M', '$1.00M'].reverse(), 'three ticks from the series and its reference ($1.16M to $1.79M)');
  const ax = D.axis(1.29e6, 1.79e6);
  assert.deepEqual([ax.lo, ax.hi], [1.2e6, 1.8e6], 'critique 25: the top tick is $1.8M, above the $1.79M peak');
  assert.match(D.line({ series: series.filter((p) => p[1] != null) }), />\$1.80M</);
  assert.equal(count(h, /<polyline class="ln"/g), 2, 'the null year breaks the line');
  assert.equal(count(h, /<polyline class="ref"/g), 2);
  assert.match(h, /<line class="now" x1="100.00"/);
  assert.match(h, /<span class="xt l">Sep 2021<\/span><span class="xt r">Sep 2026<\/span>/);
  assert.match(h, /^<div class="chart lc" style="--ar:2.6\/1" role="img" aria-label="Sep 2021 \$1.29M, Sep 2026 \$1.79M">/);
  assert.doesNotMatch(h, /style="(?!--)/, 'custom properties only');
  assert.equal(D.line({ series: [['a', 1]] }), '');
  assert.match(D.line({ series: [['a', 3], ['b', 4]], yfmt: (v) => F.rate(v), xlab: ['Mon', 'Sun'] }), /<span class="xt l">Mon<\/span>/);
  assert.equal(D.line({ src: 'x', t: Date.now() / 1000 - 60 }, Date.now()), 'Updated 1 min ago', 'line(feed, now) keeps the old status line');
});

test('axis: every value inside, at most 4 steps, ticks on nice numbers', () => {
  for (const [lo, hi] of [[0, 1], [1.29e6, 1.79e6], [3.1, 3.9], [-2, 5], [100, 100], [0.04, 0.051], [7, 7.0001], [12, 9876]]) {
    const a = D.axis(lo, hi);
    assert.ok(a.lo <= lo && a.hi >= hi, lo + '..' + hi + ' in ' + a.lo + '..' + a.hi);
    assert.equal(a.ticks.length, 3);
    assert.ok(a.hi > a.lo);
  }
  assert.deepEqual(D.axis(0, 1).ticks, [0, 0.5, 1]);
});

test('bars: sorted high to low, --v from the max, value at the end, missing shows the dot with no bar', () => {
  const h = D.bars([{ label: 'Low', value: 10 }, { label: 'High', value: 40, on: true, key: 'hi' }, { label: 'None', value: null }, { label: 'Mid', value: 20, text: '20 pts' }]);
  assert.deepEqual(h.match(/<span>([^<]+)<\/span>/g).map(text), ['High', 'Mid', 'Low', 'None']);
  assert.match(h, /<div class="hbar on" data-key="hi"><span>High<\/span><div><i style="--v:100%"><\/i><b>40<\/b>/);
  assert.match(h, /--v:50%[^]*20 pts/);
  assert.match(h, /<span>None<\/span><div><b><span class="na"/);
  assert.deepEqual(D.bars([{ label: 'b', value: 1 }, { label: 'a', value: 2 }], { sort: false }).match(/<span>(\w)<\/span>/g), ['<span>b</span>', '<span>a</span>']);
  assert.equal(D.bars([]), '');
});

test('range bar: band, median and current dot by custom properties; nothing without a span', () => {
  const h = D.range({ min: 100, p25: 150, med: 200, p75: 250, max: 300, cur: 275 });
  assert.match(h, /style="--lo:0%;--hi:100%;--q1:25%;--q3:75%;--md:50%;--cu:87.5%"/);
  assert.match(h, /<span class="band"><\/span><span class="med"><\/span><span class="cur"><\/span>/);
  assert.match(h, /<div class="range-l"><span>\$100<\/span><span>\$200<\/span><span>\$300<\/span><\/div>/);
  assert.equal(D.range({ min: 5, max: 5 }), '');
  assert.doesNotMatch(D.range({ min: 1, max: 9, cur: 3 }), /band|med/);
});

test('scatter: solid listed and hollow estimated points, dashed reference never in signal', () => {
  const h = D.scatter([{ x: 1e6, y: 6.5, key: 'a' }, { x: 3e6, y: 5.5, est: true }, { x: 2e6, y: 7, sel: true }], { x: { label: 'Price', fmt: F.money }, y: { label: 'Cap rate', fmt: (v) => F.rate(v) }, line: 6.8 });
  assert.equal(count(h, /class="pt"/g), 1);
  assert.equal(count(h, /class="pt est"/g), 1);
  assert.equal(count(h, /class="pt sel"/g), 1);
  assert.match(h, /<line class="ref"/);
  assert.doesNotMatch(h, /class="now"/, 'critique 13: the loan-rate line is not signal');
  assert.match(h, /aria-label="Cap rate by Price, 3 points"/);
  assert.match(h, /style="--x:0%;--y:/);
  assert.equal(D.scatter([]), '');
});

test('outlook bars: one column per day, height, shade, confidence dots', () => {
  const days = [{ label: 'Sat', h: 5, q: 4, text: '5 ft', conf: { score: 0.8 } }, { label: 'Sun', h: 2.5, q: 2, text: '2-3 ft' }, { label: 'Mon', h: null, q: 0 }];
  const h = D.obars(days);
  assert.match(h, /^<div class="obars" style="--days:3">/);
  assert.equal(count(h, /<div data-q=/g), 3);
  assert.match(h, /<div data-q="4"><b>5 ft<\/b><span class="conf" data-c="3"[^]*<i style="--h:100%"><\/i><span>Sat<\/span>/);
  assert.match(h, /--h:50%/);
  assert.match(h, /<div data-q="0"><b><span class="na"/);
});

// ---------------- state tile map (blueprint 2.7) ----------------
const GRID = `AK0 ME11 · WI5 VT10 NH11 · WA0 ID1 MT2 ND3 MN4 IL5 MI6 NY9 MA10 · OR0 NV1 WY2 SD3 IA4 IN5 OH6 PA7 NJ8 CT9 RI10 · CA0 UT1 CO2 NE3 MO4 KY5 WV6 VA7 MD8 DE9 · AZ1 NM2 KS3 AR4 TN5 NC6 SC7 DC8 · OK3 LA4 MS5 AL6 GA7 · HI0 TX3 FL8`;
const BLUEPRINT = {};
GRID.split(' · ').forEach((row, r) => row.split(' ').forEach((t) => { BLUEPRINT[t.slice(0, 2)] = [r, +t.slice(2)]; }));

test('state map: 51 tiles at the blueprint positions, unique, in reading order', () => {
  assert.equal(Object.keys(D.USPOS).length, 51);
  assert.deepEqual(D.USPOS, BLUEPRINT);
  const cells = new Set(Object.values(D.USPOS).map((p) => p.join(',')));
  assert.equal(cells.size, 51, 'unique positions');
  for (const [r, c] of Object.values(D.USPOS)) assert.ok(r >= 0 && r < 8 && c >= 0 && c < 12);
  const h = D.usmap([]);
  const order = h.match(/data-st="(\w\w)"/g).map((x) => x.slice(9, 11));
  assert.equal(order.length, 51);
  const sorted = order.slice().sort((a, b) => D.USPOS[a][0] - D.USPOS[b][0] || D.USPOS[a][1] - D.USPOS[b][1]);
  assert.deepEqual(order, sorted, 'DOM order follows the rows, so remote focus walks the map');
  const css = path.join(__dirname, '../static/ui.css');
  if (fs.existsSync(css)) {
    const rules = {};
    for (const m of fs.readFileSync(css, 'utf8').matchAll(/\.st\[data-st=(\w\w)\]\{grid-area:(\d+)\/(\d+)\}/g)) rules[m[1]] = [+m[2] - 1, +m[3] - 1];
    assert.deepEqual(rules, D.USPOS, 'ui.css grid areas match the helper');
  }
});

test('state map: five quantile bins, hatched no data, selected outline, aria words, legend edges', () => {
  const states = Object.keys(D.USPOS).filter((s) => s !== 'WY').map((st, i) => ({ st, value: i + 1, text: (i + 1).toFixed(2) + '%' }));
  states.push({ st: 'ZZ', value: 99 });
  const h = D.usmap(states, { metric: 'gross yield', selected: 'CA' });
  const qs = h.match(/data-q="(\w)"/g).slice(0, 51);
  assert.equal(qs.filter((q) => q === 'data-q="x"').length, 1, 'WY has no data');
  for (const k of ['1', '2', '3', '4', '5']) assert.ok(qs.filter((q) => q === 'data-q="' + k + '"').length >= 9, 'bin ' + k);
  assert.match(h, /data-st="WY" data-q="x" data-key="WY" aria-pressed="false" aria-label="Wyoming: no data"><b>WY<\/b><\/button>/);
  assert.match(h, /class="st on" data-st="CA"[^>]*aria-pressed="true" aria-label="California: gross yield [\d.]+%"/);
  assert.doesNotMatch(h, /ZZ/, 'unknown codes are dropped');
  assert.match(h, /<div class="legend"><span>Lower<\/span><span data-q="1"><i><\/i>[\d.]+-[\d.]+<\/span>[^]*<span>Higher<\/span><span data-q="x"><i><\/i>No data<\/span><\/div>$/);
  const fixed = D.usmap([{ st: 'CA', value: 4.15 }], { bins: [3, 4, 5, 6] });
  assert.match(fixed, /data-st="CA" data-q="3"[^>]*><b>CA<\/b><small>4.2<\/small>/, '4.15 sits at or above two of the edges 3, 4, 5, 6');
  const low = D.usmap([{ st: 'CA', value: 20 }, { st: 'TX', value: 80 }], { bins: [30, 40, 50, 60], better: 'lower' });
  assert.match(low, /data-st="CA" data-q="5"/, 'better:lower puts the fastest market in the brightest bin');
  assert.match(low, /data-st="TX" data-q="1"/);
  // each bin names the values in it; a bin with one value names that value (SeeViz V17: ranges, not lower bounds)
  assert.match(low, /<div class="legend"><span>Higher<\/span><span data-q="1"><i><\/i>80\.0<\/span>[^]*<span data-q="5"><i><\/i>20\.0<\/span><span>Lower<\/span>/);
});

// ---------------- coast strip ----------------
test('coast strip: 14 regions ordered south to north whatever the input order; model and none hatched; ends named', () => {
  const ids = D.COAST;
  assert.equal(ids.length, 14);
  assert.equal(ids[0], 'baja-sur');
  assert.equal(ids[13], 'oregon-north');
  const regions = ids.slice().reverse().map((id, i) => ({ id, name: id.replace(/-/g, ' '), q: i % 6, word: 'Fair', height: '3-4 ft', model: id === 'baja-norte', none: id === 'ventura' }));
  const h = D.coast(regions, { selected: 'orange-county' });
  assert.deepEqual(h.match(/data-key="([\w-]+)"/g).map((x) => x.slice(10, -1)), ids);
  assert.match(h, /^<div class="coast panel"><ol style="--n:14" aria-label="Coast, south to north">/);
  assert.match(h, /class="cs model" data-q="\d" data-key="baja-norte"[^>]*aria-label="baja norte: Fair, 3-4 ft, model only"/);
  assert.match(h, /class="cs none" data-q="0" data-key="ventura"[^>]*aria-label="ventura: no reading"><i><\/i><small>ventura<\/small>/);
  assert.match(h, /class="cs on"[^>]*data-key="orange-county" aria-pressed="true"/);
  assert.match(h, /<div class="coast-ends"><span>Cabo<\/span><span class="sel">orange county<\/span><span>Columbia River<\/span><\/div><\/div>$/);
  assert.equal(D.coast([]), '');
});

// ---------------- states ----------------
test('empty states: idle, stale, bad, setup and building; one retry; action markup; skeletons; missing names once', () => {
  for (const k of ['idle', 'stale', 'bad', 'setup', 'building']) assert.match(D.empty({ k, title: 'T' }), new RegExp('^<div class="es es-' + k + '" role="status"><svg class="es-i"'));
  assert.match(D.empty({ k: 'weird' }), /es-idle[^]*Nothing here yet/);
  const e = D.empty({ k: 'bad', title: 'Surf is <not> reporting', line: 'Try again soon', retry: 'surf' });
  assert.equal(count(e, /data-retry="surf"/g), 1);
  assert.match(e, /Surf is &lt;not&gt; reporting/);
  assert.match(D.empty({ k: 'setup', title: 'eBay prices', line: 'They need a free developer key', action: '<a class="btn" href="/x">How</a>' }), /<a class="btn" href="\/x">How<\/a><\/div>$/);
  assert.match(D.skeleton('tile', 4), /^<div class="strip" data-n="4" data-nb="4" role="group" aria-busy="true" aria-label="Loading">/);
  assert.equal(count(D.skeleton('row', 3), /class="frow"/g), 3);
  assert.equal(D.missing(['units', 'year built', 'occupancy']), '<p class="missing">Not reported: units, year built, occupancy.</p>');
  assert.equal(D.missing([]), '');
  assert.equal(D.missing([null, '']), '');
});

// ---------------- filters ----------------
test('filters: one button with the count, fields in a sheet, no chip row and no scope chip', () => {
  const h = D.filters({ id: 'res', lead: '<div class="seg keep">x</div>', count: 1, fields: '<label class="field">Grade<select></select></label>', show: 'Show 8,214 ZIPs' });
  assert.match(h, /^<div class="fbar" data-fbar="res"><div class="fbar-top"><button type="button" class="btn fbar-open" data-open-fbar="res" aria-haspopup="dialog" aria-label="Filters, 1 set">/);
  assert.match(h, /<span class="fbw">Filters<\/span> <span class="cnt">1<\/span><\/button><div class="seg keep">x<\/div><\/div><dialog/);
  assert.match(h, /<dialog class="sheet fbar-panel" id="fb-res" aria-label="Filters">[^]*<div class="fbar-fields"><label class="field">Grade/);
  assert.match(h, /<button type="button" class="btn" data-clear="\*">Clear<\/button><button type="button" class="btn btn-primary" data-close>Show 8,214 ZIPs<\/button>/);
  assert.doesNotMatch(h, /United States|pl-only|class="chips"|fchip/, 'critique 6, 11, 16: the count lives in the button, no chip row');
  const none = D.filters({ id: 'x', count: 0 });
  assert.doesNotMatch(none, /class="cnt"/);
  assert.match(none, /aria-haspopup="dialog" aria-label="Filters"><svg/, 'the spoken name holds where the L bar shows only the mark (L21)');
});

// ---------------- money ----------------
test('masked money never leaks a digit; revealed shows the format; the button says what it does', () => {
  for (const v of [0, 5, 1240000, 9450.55, -300, null, 340244e6]) {
    const h = D.amount(v);
    assert.equal(h, '$\u2022\u2022\u2022');
    assert.doesNotMatch(h, /\d/);
  }
  assert.doesNotMatch(D.tile({ label: 'Debt service', value: D.amount(28123) }), /\d/);
  assert.doesNotMatch(F.money(28123, { masked: true }), /\d/);
  assert.equal(D.amount(1240000, { revealed: true }), '$1.24M');
  assert.equal(D.amount(9.5, { revealed: true, cents: true }), '$9.50');
  assert.equal(D.amount(null, { revealed: true }), 'No data');
  assert.match(D.amountsBtn(false), /data-money="show">Show amounts</);
  assert.match(D.amountsBtn(true), /data-money="hide">Hide amounts</);
});

// ---------------- Data sheet (blueprint 2.1) ----------------
test('Data sheet: Sources, Blends, Method, Setup, Display in order; dates per 2.4; duplicates once; status words', () => {
  const h = D.dataSheet({
    sources: [{ name: 'Zillow Home Value Index', gives: '26,265 of 39,228 ZIPs', asOf: '2026-09', state: 'ok' }, { name: 'Zillow Home Value Index', gives: '26,265 of 39,228 ZIPs', asOf: '2026-09', state: 'ok' },
      { name: 'Realtor.com core metrics, ZIP', gives: 'ZIP rows', asOf: '2026-11-11', state: 'stale' }, { name: 'eBay', gives: 'Sold prices', state: 'needs_key' }, { name: 'X', asOf: new Date(2023, 6, 22, 12).getTime() / 1000, state: 'blocked' }],
    blends: [{ label: 'Home value, United States', value: '$368K', score: 0.62, agree: '2 of 3', parts: [{ name: 'Zillow', value: '$367,798', weight: '50%' }, { name: 'Redfin', value: null, weight: '25%' }], note: 'Asking prices' }],
    method: [['Gross rent yield', '25% \u00B7 higher is better']],
    setup: [{ name: 'eBay', line: 'eBay prices need a free developer key', state: 'needs_key' }],
  }, { now: new Date(2026, 10, 14).getTime() });
  assert.deepEqual(h.match(/<h3>(\w+)<\/h3>/g).map(text), ['Sources', 'Blends', 'Method', 'Setup', 'Display']);
  assert.equal(count(h, /Zillow Home Value Index/g), 1, 'critique 27: a source is listed once');
  assert.match(h, /<b>Sep 2026<\/b>/);
  assert.match(h, /<b>Nov 11<\/b>/);
  assert.match(h, /<b>Jul 22, 2023<\/b>/, 'another year says the year');
  assert.doesNotMatch(h, /\d{4}-\d{2}/, 'no ISO dates');
  for (const w of ['OK', 'Out of date', 'Needs a key', 'Blocked']) assert.match(h, new RegExp('</span>' + w + '</span>'), w);
  assert.match(h, /<div class="ds-blend"><header><b>Home value, United States<\/b><span>\$368K<span class="conf" data-c="2"[^>]*aria-label="Medium confidence: 2 of 3 sources agree"/);
  assert.match(h, /<div class="ds-part"><span>Redfin<\/span><b>No data<\/b><span>25%<\/span><\/div>/);
  assert.match(h, /<dl class="kv prose"><div><dt>Gross rent yield<\/dt>/);
  assert.match(h, /eBay prices need a free developer key/);
  assert.match(h, /data-display="tv"[^]*data-display="always-on"[^]*data-display="units" data-v="us" aria-pressed="true" class="on"/);
  const blank = D.dataSheet({});
  assert.match(blank, /No sources listed\.[^]*No blended numbers here\.[^]*Nothing to explain here\.[^]*Nothing needs setup\./);
});

test('card taps open sheets on the Work tab (the shell renames Life to work) as they did on Life', () => {
  const chain = [{ tag: 'SMALL', cls: '' }, { tag: 'SPAN', cls: 'fl' }, { tag: 'DIV', cls: 'frow' }];
  assert.equal(D.sheetPick('work', chain), 2);
  assert.equal(D.sheetPick('life', chain), 2, 'the old name still works until the shell lands');
  assert.equal(D.sheetPick('work', [{ tag: 'BUTTON', cls: 'b jchip on' }]), -1);
});

test('detail sheet options end with a Data button scoped to the item', () => {
  const o = D.detail({ title: '92647 Huntington Beach, CA', sub: 'Residential', body: '<p>x</p>', actions: '<button class="btn btn-primary">Find homes for sale</button>', wide: true, scope: 'zip:92647' });
  assert.equal(o.wide, true);
  assert.match(o.actions, /Find homes for sale<\/button><button type="button" class="btn" data-sheet="data" data-scope="zip:92647">Data<\/button>$/);
});

test('no helper emits data: or blob: URLs or inline style beyond custom properties', () => {
  const all = [D.tile({ label: 'a', value: '1', spark: D.spark([1, 2, 3], {}) }), D.line({ series: [['a', 1], ['b', 2]] }), D.bars([{ label: 'a', value: 1 }]), D.range({ min: 0, max: 2, cur: 1 }),
    D.scatter([{ x: 1, y: 1 }], { line: 1 }), D.obars([{ label: 'a', h: 1 }]), D.usmap([]), D.coast([{ id: 'san-diego', name: 'San Diego', q: 3 }]), D.filters({ id: 'a' }), D.dataSheet({})].join('');
  assert.doesNotMatch(all, /data:|blob:/);
  for (const m of all.matchAll(/style="([^"]*)"/g)) for (const decl of m[1].split(';')) assert.match(decl, /^--[a-z0-9]+:/, decl);
});
