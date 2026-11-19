// node --test tests/home_v3_mark.test.js
// Home > House, Fleet and Cluster each set the page's one freshness mark (design v3): app.js ha() and fleet() and deck.js
// v6Cluster() hand {age, refresh, missing} to homeMark(sub, ...), which draws DeckUI.fresh into the Home header through
// DeckPages.mark, only for the sub on screen. Runs the real registry and helpers in a sandbox with a fake header; no DOM.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const deck = read('static/deck.js'), app = read('static/app.js');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const helpers = cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====');
const registry = cut(deck, '// ==== DECK PAGES REGISTRY BEGIN', '// ==== DECK PAGES REGISTRY END ====');
// homeMark is page glue after the registry: from its comment to the line before v6Cluster
const glue = cut(deck, "// Home's one freshness mark per page", 'const v6Cluster=');

// the Home header: .phead holding .pact, which records what the mark helper writes into it
function home() {
  const pact = { html: '', fresh: null,
    querySelector(s) { return s === '.fresh' && this.fresh ? this.fresh : null; },
    insertAdjacentHTML(_, h) { const self = this; this.html = h + this.html; this.fresh = { set outerHTML(v) { self.html = v; } }; } };
  const head = { querySelector: (s) => (s === '.pact' ? pact : null) };
  const on = {};
  const document = { documentElement: { dataset: {}, classList: { contains: () => false } },
    addEventListener: (t, fn) => { (on[t] ||= []).push(fn); },
    getElementById: (id) => (id === 'pg-home' ? { querySelector: (s) => (s === '.phead' ? head : null) } : null) };
  const ctx = vm.createContext({ document, console: { error() {} }, setTimeout, clearTimeout, Promise, Date });
  vm.runInContext(helpers + '\n' + registry + '\n' + glue + '\nthis.DeckUI=DeckUI;this.DeckPages=DeckPages;this.homeMark=homeMark;', ctx, { timeout: 1000 });
  const route = (tab, sub) => (on['deck:route'] || []).forEach((fn) => fn({ detail: { tab, sub } }));
  return { ctx, pact, route };
}

test('fleet: the shell still dispatches the old leaf "fleet"; the mark still lands in the Home header (review F3a)', () => {
  const { ctx, pact } = home();
  ctx.DeckPages.dispatch('fleet', false);
  ctx.homeMark('fleet', { age: 120, refresh: 300, missing: 0 });
  assert.match(pact.html, /class="fresh"/);
  assert.match(pact.html, /2 min/);
});

test('a load that finished before the route settled is drawn when the shell shows that sub (deck:route)', () => {
  const { ctx, pact, route } = home();
  ctx.DeckPages.dispatch('home/house', false);
  ctx.homeMark('fleet', { age: 600, refresh: 300, missing: 1 });
  assert.equal(pact.html, '', 'not drawn while House is on screen');
  route('home', 'fleet');
  assert.match(pact.html, /1 part not reporting/);
  route('home', 'cluster');
  assert.match(pact.html, /1 part not reporting/, 'a sub with no mark yet leaves the header as it is');
});

for (const sub of ['house', 'fleet', 'cluster']) {
  test(`${sub}: the mark lands in the Home header while ${sub} is on screen, and only then`, () => {
    const { ctx, pact } = home();
    ctx.DeckPages.dispatch('home/' + sub, false);
    ctx.homeMark(sub, { age: 180, refresh: 300, missing: 0 });
    assert.match(pact.html, /class="fresh"/, 'a fresh mark');
    assert.match(pact.html, /3 min/);
    assert.doesNotMatch(pact.html, /Out of date|not reporting/);
    // another sub on screen: the mark is not redrawn by this page
    const other = sub === 'house' ? 'fleet' : 'house';
    ctx.DeckPages.dispatch('home/' + other, false);
    const before = pact.html;
    ctx.homeMark(sub, { age: 9999, refresh: 300, missing: 2 });
    assert.equal(pact.html, before);
  });
}

test('a stale feed or a missing part turns the one mark into a status, replacing the earlier mark', () => {
  const { ctx, pact } = home();
  ctx.DeckPages.dispatch('home/fleet', false);
  ctx.homeMark('fleet', { age: 60, refresh: 300, missing: 0 });
  ctx.homeMark('fleet', { age: 60, refresh: 300, missing: 2 });
  assert.equal((pact.html.match(/class="fresh/g) || []).length, 1, 'one mark per page');
  assert.match(pact.html, /fresh warn/);
  assert.match(pact.html, /2 parts not reporting/);
  ctx.homeMark('fleet', { age: 3600, refresh: 300, missing: 0 });
  assert.match(pact.html, /Out of date/);
  // the old leaf names route to the same subs: House is the Home tab's default
  ctx.DeckPages.dispatch('home', false);
  ctx.homeMark('house', { age: 30, refresh: 60, missing: 0 });
  assert.doesNotMatch(pact.html, /Out of date/);
});

test('each page hands its own age to homeMark: House from Home Assistant, Fleet from the fleet check, Cluster from its feed', () => {
  const ha = cut(app, 'async function ha(){', '$(\'#bedpp\')');
  assert.match(ha, /homeMark\('house',\{age:upd\.length\?/);
  assert.match(ha, /homeMark\('house',\{age:null,refresh:60,missing:1\}\)/, 'Home Assistant not reporting is a status, not an age');
  const fl = cut(app, 'async function fleet(){', 'let fleetLast=');
  assert.match(fl, /homeMark\('fleet',\{age:isFinite\(stamp\)/);
  assert.match(fl, /homeMark\('fleet',\{age:null,refresh:300,missing:1\}\)/);
  assert.match(deck, /homeMark\('cluster',\{age:DeckPages\.ageOf\(f,now\)/);
});
