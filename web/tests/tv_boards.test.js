'use strict';
// TV boards that answer from across a room (round Better, lane DoTv; PlanDesign M8, SeeGlanceWide W6 to W9, SeeReference
// R13, SeeAccess A16): one headline a board read from the page's own count, Fleet's counts first, Cluster's second row,
// House's readings, the top inset clear of the overscan, and the remote reaching <details> toggles.
// Loads the pure TV CORE block of static/tv.js and reads static/tv.css; no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'static/tv.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'static/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = src.match(/\/\/ ==== TV CORE BEGIN[^\n]*\n([\s\S]*?)\/\/ ==== TV CORE END ====/);
const TvCore = vm.runInNewContext(block[1] + '\nTvCore;', {});
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const rule = (re) => rules.find((r) => re.test(r.sel));

test('a headline says the count and the words that answer the board, singular at one', () => {
  const say = (k, n) => { const t = TvCore.leadText(k, n); return t && t.v + ' ' + t.w; };
  assert.equal(say('needs', 4), '4 need you');
  assert.equal(say('needs', 1), '1 needs you');
  assert.equal(say('needs', 0), '0 need you');
  assert.equal(say('failing', 3), '3 failing');
  assert.equal(say('returns', 0), '0 return windows open');
  assert.equal(say('returns', 1), '1 return window open');
  assert.equal(say('jobs', 1312), '1,312 jobs match');
  assert.equal(say('gigs', 25), '25 gigs');
  assert.equal(say('look', 23), '23 need a look');
});

test('no count, no headline: never a guessed zero, never a fraction or a word', () => {
  for (const n of [null, undefined, NaN, -1, 2.5, '4', Infinity]) assert.equal(TvCore.leadText('needs', n), null, String(n));
  assert.equal(TvCore.leadText('nope', 3), null, 'an unknown board kind has no headline');
});

test('the count is read from the page\'s own words', () => {
  assert.equal(TvCore.countIn('Show 3 more'), 3);
  assert.equal(TvCore.countIn('Showing 6 of 1,312', 'of'), 1312, 'the total, thousands separator included');
  assert.equal(TvCore.countIn('Showing 12 of 1,200 \u00B7 418 with no stated pay left out', 'of'), 1200, 'never the count a filter left out');
  assert.equal(TvCore.countIn('Showing all', 'of'), null, 'no total, no headline');
  assert.equal(TvCore.countIn('22 jobs need a look'), 22);
  assert.equal(TvCore.countIn('Nothing failing now'), null);
  assert.equal(TvCore.countIn(null), null);
});

test('every board the plan names has its headline, at the head of the section it sums up', () => {
  const leads = src.slice(src.indexOf('const LEADS = ['), src.indexOf('function placeLeads()'));
  for (const [at, kind] of [['#td-needs', 'needs'], ['#scsec', 'failing'], ['#missions', 'look'], ['.s-open', 'returns'], ['.jmain', 'jobs']]) {
    assert.match(leads, new RegExp("at: '" + at.replace(/[.#]/g, '\\$&') + "'[^\\n]*'" + kind + "'"), at + ' leads with ' + kind);
  }
  const place = src.slice(src.indexOf('function placeLeads()'), src.indexOf('const ROW2'));
  assert.match(place, /s\.closest\('\.board'\) \? TvCore\.leadText/, 'only on a board');
  assert.match(place, /if \(!t\) \{ if \(el\) el\.remove\(\); continue; \}/, 'a count that went away takes its headline with it');
  assert.match(place, /if \(el && el\.dataset\.lead === say\) continue;/, 'idempotent: the repaint observer never loops');
  assert.match(place, /s\.prepend\(el\)/, 'first in its section');
  assert.doesNotMatch(place, /innerHTML/, 'page words never become markup');
  // placed before the rows are cut, so the board fits with it
  assert.match(src, /function fitBoards\(\) \{\s*shortCoast\(\);[\s\S]{0,160}placeLeads\(\);\s*copyRow\(\);/);
  const lead = rule(/^html\.tv \.tv-lead$/), fig = rule(/^html\.tv \.tv-lead>b$/);
  assert.ok(lead && fig, 'the headline has its TV rules');
  assert.match(fig.body, /font-size:var\(--fs-display\)/, 'the figure at the display step (72 px at 1080p)');
  assert.match(css, /html\.tv \.board \.tv-lead\+\.secttl\{display:none\}/, 'it takes the place of the title it restates, on a board only');
  // Today's quotes take the shared strip step, as Money's do: the step-down still guards a long value
  assert.match(css, /html\.tv #td-mkt \.strip>\.tile\.sm \.v\{font-size:clamp\(var\(--fs-lead\),calc\(\(100cqi \/ var\(--cols,2\)/);
  assert.match(css, /\.tv-lead\{display:flex/);
});

test('Fleet leads with its four counts; Cluster gets a second row; House shows its readings', () => {
  assert.match(css, /html\.tv #fsum\.board>\.strip\{order:-1\}/);
  assert.match(src, /const ROW2 = \{ board: '#clboard', from: '#cl1 \.strip', labels: \['Speed', 'Context', 'Proxy'\] \}/);
  const copy = src.slice(src.indexOf('function copyRow()'), src.indexOf('function fitBoards()'));
  assert.match(copy, /row\.setAttribute\('aria-hidden', 'true'\)/, 'the copy is not read twice');
  assert.match(copy, /removeAttribute\('id'\)/, 'no duplicate ids');
  assert.match(copy, /querySelectorAll\(FOCUSABLE \+ ',\.diag'\)\) x\.remove\(\)/, 'no stop inside the copy');
  assert.match(copy, /if \(row && row\.dataset\.sig === sig\) return;/, 'idempotent');
  assert.match(css, /html\.tv #clboard>\.tv-row2\{--cols:3\}/);
  assert.match(css, /html\.tv body #hal>#hrd\{display:grid;--cols:2\}/, 'the readings strip shown on TV, two across');
  assert.doesNotMatch(css, /#hal>#(vit|car|ink)\{display/, 'the Watch, weather, car card and ink stay off the board, so it fits');
});

test('the top inset is 5% plus the focus ring and its lift, everywhere a TV screen starts (R13)', () => {
  const top = rule(/^html\.tv$/);
  assert.ok(top, 'the html.tv block in tv.css');
  assert.match(top.body, /--tv-top:calc\(5vh \+ var\(--focus-off\) \+ 4px \+ var\(--hit\) \* \.02\)/);
  assert.match(rule(/^html\.tv #top$/).body, /padding:var\(--tv-top\) 5vw/, 'the tab row');
  assert.match(css, /--tv-board-top:calc\(var\(--tv-top\) \+/, 'the board height rule');
  assert.match(rule(/^html\.tv dialog\.sheet$/).body, /padding:var\(--tv-top\) 5vw 4vh/, 'sheets');
  assert.match(rule(/^html\.tv #sheetp$/).body, /padding:var\(--tv-top\) 5vw 4vh/, 'the legacy sheet');
  assert.doesNotMatch(css, /padding:4vh 5vw/, 'no screen starts at 4%');
});

test('the remote reaches a <details> toggle (Gigs "Draft pitch", Jobs "5 more categories")', () => {
  assert.match(src, /const FOCUSABLE = '[^']*\bsummary,/);
});

test('past the last stop Down scrolls only until the focused stop reaches the top inset, never off screen (A18)', () => {
  const mv = src.slice(src.indexOf('  function move(dir) {'), src.indexOf('  // a legacy sheet with no close button'));
  assert.doesNotMatch(mv, /if \(dir === 'down'\) scrollBy\(0, innerHeight \* 0\.6\);/, 'no blind 60% scroll');
  assert.match(mv, /const room = cur\.getBoundingClientRect\(\)\.top - \(parseFloat\(getComputedStyle\(cur\)\.scrollMarginTop\) \|\| 0\);/);
  assert.match(mv, /if \(room > 1\) scrollBy\(0, Math\.min\(innerHeight \* 0\.6, room\)\);/);
});

test('a heading whose rows were all cut leaves the board with them (Accounts "Not captured yet")', () => {
  const fit = src.slice(src.indexOf('  function fitBoards() {'), src.indexOf('  function refresh() {'));
  assert.match(fit, /if \(!rows\.length \|\| rows\.some\(\(r\) => !r\.hasAttribute\('data-tv-cut'\)\)\) continue;/);
  assert.match(fit, /h\.matches\('\.secttl,h2,h3,h4'\); h = h\.previousElementSibling\) h\.setAttribute\('data-tv-cut', ''\)/);
  assert.ok(fit.indexOf('cut(b.querySelectorAll(LISTS))') < fit.indexOf('rows.some('), 'after the rows are cut');
});

test('Today counts each member of a grouped Needs you row ("3 App Reviews to answer" is 3, not 1)', () => {
  const leads = src.slice(src.indexOf('const LEADS = ['), src.indexOf('function placeLeads()'));
  assert.match(leads, /reduce\(\(a, r\) => a \+ \(r\.querySelectorAll\('\.td-chips>\*'\)\.length \|\| 1\), 0\)/);
});
