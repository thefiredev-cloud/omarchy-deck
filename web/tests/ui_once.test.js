'use strict';
// A page load that never settles must not wedge a page for the rest of the session (Main, 2026-11-14: a blank page with no error until
// a reload). DeckPages.load always settles; once() always clears its busy flag and paints the Not reporting bar; every deck.js fetch
// carries the one abort bound.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const DeckUI = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const REG = src.slice(src.indexOf('// ==== DECK PAGES REGISTRY BEGIN'), src.indexOf('// ==== DECK PAGES REGISTRY END ===='));
const freshPages = (extra) => vm.runInNewContext(REG + '\nDeckPages;', Object.assign({ console: { error() {} }, setTimeout, clearTimeout, Promise, Date }, extra || {}), { timeout: 2000 });
// the glue piece: bfetch, onceFail and once, exactly as they ship
const GLUE = src.slice(src.indexOf('const FETCH_MS='), src.indexOf('const v6Cluster='));
const never = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function glueDom() {
  const host = { bars: [], querySelector: () => null, insertAdjacentHTML(where, html) { assert.equal(where, 'afterbegin'); this.bars.push(html) } };
  return { host };
}
function glue(extra) {
  const { host } = glueDom();
  const document = { querySelector: (s) => (s === '#pg-housing' ? host : null), getElementById: (s) => (s === 'pager' ? host : null) };
  const V6 = { busy: {}, t: {} };
  const ctx = Object.assign({ console: { error() {} }, setTimeout, clearTimeout, Promise, Date, document, host, V6, DeckUI }, extra || {});
  ctx.DeckPages = freshPages({});
  vm.runInNewContext(GLUE + '\nthis.__g={bfetch,once,onceFail,FETCH_MS};', ctx, { timeout: 2000 });
  return Object.assign(ctx.__g, { V6, host, DeckPages: ctx.DeckPages });
}

test('DeckPages.load settles on resolve, on reject and on a load that never finishes', async () => {
  const P = freshPages();
  const ok = await P.load(() => 42);
  assert.deepStrictEqual([ok.ok, ok.value], [true, 42]);
  const bad = await P.load(() => { throw new Error('boom') });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.message, 'boom');
  // a fake clock: the bound is the timer the load arms, and the load gives up when that timer fires, not before (lane DoClock)
  const timers = [];
  const F = freshPages({ setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout() {} });
  let timedOut = 0, settled = false;
  const pending = F.load(never, { ms: 30, onTimeout: () => timedOut++ });
  pending.then(() => { settled = true; });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(timers.map((t) => t.ms), [30], 'it arms its own bound, not the default');
  assert.deepStrictEqual([settled, timedOut], [false, 0], 'nothing gives up before the bound');
  timers[0].fn();
  const hung = await pending;
  assert.deepStrictEqual([hung.ok, hung.timeout], [false, true]);
  assert.equal(timedOut, 1, 'the honest state is painted once');
  assert.equal(P.ONCE_MS, 75000, 'longer than the 60 s fetch bound');
  const again = await F.load(() => 'later', { ms: 30 });
  assert.deepStrictEqual([again.ok, again.value], [true, 'later'], 'a timed-out load leaves nothing wedged');
});

test('once: a fetch that never settles leaves the page retryable and shows Not reporting, not a blank surface', async () => {
  const G = glue();
  let ran = 0;
  const first = G.once('housing', () => { ran++; return never() }, { ms: 40 });
  assert.equal(G.V6.busy.housing, true, 'busy while it runs');
  assert.equal(await first, false, 'the load did not finish');
  assert.equal(G.V6.busy.housing, false, 'the busy flag is cleared after the timeout');
  assert.equal(G.host.bars.length, 1, 'one bar painted');
  assert.match(G.host.bars[0], /^<div class="stale-bar bad" role="status"><span class="sd bad"><\/span>Not reporting/);
  assert.match(G.host.bars[0], /<button type="button" class="btn btn-sm" data-retry="housing">Try again<\/button>/);
  assert.match(G.host.bars[0], /<\/div>$/, 'nothing is appended after the bar');
  // the next attempt runs: retry from the Try again button, or the next visit
  assert.equal(await G.once('housing', async () => { ran++; return 'painted' }, { ms: 40 }), true);
  assert.equal(ran, 2, 'a second attempt really runs');
  assert.equal(G.host.bars.length, 1, 'a successful retry adds no bar');
});

test('once: a load that throws clears busy and paints the same bar; a second caller is refused while one runs', async () => {
  const G = glue();
  assert.equal(await G.once('housing', () => { throw new Error('boom') }, { ms: 40 }), false);
  assert.equal(G.V6.busy.housing, false);
  assert.equal(G.host.bars.length, 1);
  let second = 0;
  const p = G.once('housing', async () => { second++; await sleep(30) });
  assert.equal(await G.once('housing', async () => { second++ }), false, 'busy: the second call returns without running');
  await p;
  assert.equal(second, 1);
});

test('once: the default bound is 75 s, past every fetch bound, and a fresh page starts unpainted rather than stuck', async () => {
  const G = glue();
  assert.equal(G.FETCH_MS, 60000);
  assert.equal(G.DeckPages.ONCE_MS, 75000);
  assert.equal(await G.once('area', async () => 'ok'), true, 'no options means the default bound, and a normal load returns true');
  assert.equal(G.V6.busy.area, false);
});

test('bfetch: every deck fetch gets the 60 s abort bound, and a caller with its own signal is left alone', async () => {
  const seen = [];
  const fetch = (url, opt) => {
    seen.push([url, !!opt.signal]);
    return new Promise((res, rej) => { if (opt.signal) opt.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  };
  const G = glue({ fetch, AbortController });
  await assert.rejects(() => G.bfetch('/api/x', {}, 30), /aborted/);
  assert.equal(seen[0][0], '/api/x');
  assert.equal(seen[0][1], true);
  const own = new AbortController();
  const p = G.bfetch('/api/y', { signal: own.signal }, 30);
  assert.equal(seen[1][1], true);
  own.abort();
  await assert.rejects(() => p);
});

test('deck.js: no fetch is left without a bound, and the unbounded ones now go through bfetch', () => {
  const glueSrc = src.slice(src.indexOf('const FETCH_MS='));
  const bare = (glueSrc.match(/[^f.\w]fetch\(/g) || []).length;
  assert.equal(bare, 3, 'only bfetch itself (2) and runPoll (its own 14 s signal) call fetch without the shared bound');
  assert.match(glueSrc, /function bfetch\(url,init,ms\)/);
  // Today's Almanac read left with design v3 (PgToday); Today reads through DeckPages.get, bounded at 15 s (tests/today_page.test.js).
  // The housing profile and ZIP reads left with the old Markets > Housing glue (SeeCode C9); Real estate reads through DeckPages.get.
  for (const p of ['saved-jobs', 'launch-item', 'run-send', 'cron-act', 'unit?name='])
    assert.match(glueSrc, new RegExp("bfetch\\([^\\n]*" + p.replace(/[/?]/g, (c) => '\\' + c)), p + ' goes through bfetch');
  assert.doesNotMatch(glueSrc, /const profGet=\(\)=>fetch\(/, 'the hung profile read is bounded');
  assert.match(src, /const FETCH_MS=60000;/, 'the bound is stated in the file');
});
