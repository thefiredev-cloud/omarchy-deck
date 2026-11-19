'use strict';
// Work > Jobs and Gigs never stay blank on a hung answer (PageLanes 13.6): every fetch is bounded (jget and bfetch abort at 60 s, the
// page then paints its Not reporting state), and the whole load is bounded by once(), which paints the Not reporting bar with one
// Try again into the page's own container. The real registry, glue and Work code run here, with the bounds shortened.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const DeckUI = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };
const REG = cut('// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
const GLUE = cut('const FETCH_MS=', 'const v6Cluster=');
const WORK = cut('// ---- Work > Jobs and Work > Gigs', '// ---- end Work ----');
const never = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('bounds as shipped: once() 75 s past the 60 s fetch bound, and the Work loads run through once() under their route names', () => {
  assert.match(REG, /const ONCE_MS=75000;/);
  assert.match(GLUE, /^const FETCH_MS=60000;/);
  assert.match(WORK, /const jobsLoadAll=\(\)=>once\('work-jobs',/);
  assert.match(WORK, /const gigsLoad=\(\)=>once\('work-gigs',async\(\)=>\{GIGV\.feed=await feedGet\('gigs'\);paintGigs\(\)\}\);/);
  assert.match(WORK, /const sjGet=p=>bfetch\(/, 'the saved list read is bounded too');
  assert.doesNotMatch(WORK, /[^b]fetch\(/, 'no unbounded fetch in the Work code');
});

// one Work page in a sandbox: its container, the bar the shell would show, and the feed reader the test controls
function page(route, feedGet) {
  const sub = route.split('/')[1];
  const el = { id: 'pg-work-' + sub, bars: [], html: '', set innerHTML(h) { this.html = h; this.bars = [] }, get innerHTML() { return this.html },
    querySelector: () => null, addEventListener() {}, insertAdjacentHTML(where, h) { assert.equal(where, 'afterbegin'); this.bars.push(h) } };
  const document = { getElementById: (id) => (id === el.id ? el : null), querySelector: (s) => (s === '#pg-work-' + sub ? el : null) };
  // a fetch that honours its abort signal and otherwise never answers
  const fetch = (u, o) => new Promise((_, no) => { if (o && o.signal) o.signal.addEventListener('abort', () => no(new Error('aborted'))); });
  const V6 = { busy: {}, t: {}, saved: {}, jobsBy: {}, person: 'tanner', job: { cat: 'all', sub: 'all', metro: 'all', sort: 'fit' }, jobsN: 12, savedView: false };
  const ctx = { console: { error() {} }, setTimeout, clearTimeout, Promise, Date, AbortController, document, DeckUI, V6, fetch, feedGet,
    localStorage: { getItem: () => null, setItem() {} }, buzz() {}, jobState: () => ({ cat: 'all', sub: 'all', metro: 'all', sort: 'fit' }),
    jobFilterKey: (p) => 'job-filter:' + p, jobPersonOk: () => true, renderFail: (t) => 'FAIL ' + t };
  vm.runInNewContext(REG.replace('const ONCE_MS=75000;', 'const ONCE_MS=60;') + '\nthis.DeckPages=DeckPages;', ctx, { timeout: 2000 });
  vm.runInNewContext(GLUE.replace('const FETCH_MS=60000;', 'const FETCH_MS=30;') + '\n' + WORK, ctx, { timeout: 2000 });
  ctx.DeckPages.dispatch(route, false);
  return { el, V6 };
}

test('Work > Jobs: a feed read that never settles ends in Not reporting with one Try again in #pg-work-jobs, not a blank card', async () => {
  const { el, V6 } = page('work/jobs', never);
  assert.match(el.html, /aria-busy="true"/, 'a skeleton while it reads');
  assert.equal(V6.busy['work-jobs'], true);
  await sleep(150);
  assert.equal(V6.busy['work-jobs'], false, 'the page is retryable');
  assert.equal(el.bars.length, 1);
  assert.match(el.bars[0], /^<div class="stale-bar bad" role="status"><span class="sd bad"><\/span>Not reporting<button type="button" class="btn btn-sm" data-retry="work-jobs">Try again<\/button><\/div>$/);
});

test('Work > Jobs: a feed read the 60 s bound aborts paints the page\'s own Not reporting state with Try again', async () => {
  const { el, V6 } = page('work/jobs', async () => null);
  await sleep(120);
  assert.equal(V6.busy['work-jobs'], false);
  assert.match(el.html, /Jobs are not reporting/);
  assert.match(el.html, /data-retry="jobs"/);
  assert.match(el.html, /data-person="tanner" aria-pressed="true"/, 'the picker stays so another list is one tap away');
});

test('Work > Gigs: a hung read ends in the Not reporting bar; an aborted read in the page\'s own Not reporting state (one word for one cause)', async () => {
  const hung = page('work/gigs', never);
  await sleep(150);
  assert.equal(hung.V6.busy['work-gigs'], false);
  assert.match(hung.el.bars[0] || '', /Not reporting<button type="button" class="btn btn-sm" data-retry="work-gigs">Try again/);
  const gone = page('work/gigs', async () => null);
  await sleep(60);
  assert.match(gone.el.html, /Gigs are not reporting/);
  assert.match(gone.el.html, /data-retry="gigs"/);
});
