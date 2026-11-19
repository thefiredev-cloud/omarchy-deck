// node --test tests/*.test.js  (Money > Markets: the revealed portfolio detail, parity row 45). No DOM, no network.
// What it proves: equity against crypto and each position's day change in dollars come back after Show amounts, read from the values view
// only; none of it is in the markup before the tap or after the 30 s hide; the Data sheet never carries it.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = new Function('DeckUI', cut(src, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(DeckUI);
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json'), rawV = fx('portfolio-values.sample.json');
const NOW = (rawM.t + 120) * 1000;
const clone = (x, o) => Object.assign(JSON.parse(JSON.stringify(x)), o);
const P = () => clone(rawP, { age: 120, stale: false });
const vis = (h) => h.replace(/<span class="vh">[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// the new detail in the forms the page prints: the split (313,131 and 111,111) and the per-position dollars (-1,000, +1,000)
const DETAIL = ['313,131', '313131', '111,111', '111111', '\u2212$1,000', '+$1,000', 'Equity $', 'Crypto $'];
const leaks = (h) => DETAIL.filter((s) => h.includes(s));

function rig(get) {
  const timers = []; let now = NOW;
  const c = D.ctl({ get: (p) => { assert.equal(p, '/api/portfolio-values'); return get ? get(p) : Promise.resolve(clone(rawV)); },
    setT: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearT: () => {}, now: () => now, onChange() {} });
  return { c, timers, advance: (ms) => { now += ms; } };
}
const row = (h, sym) => (h.match(new RegExp('<div class="frow"><span class="fl"><b>' + sym + '</b>[^]*?</span></div>')) || [''])[0];

test('before Show amounts: no equity, no crypto, no dollar change per position; the percent rows stay', () => {
  const h = D.portfolio(P(), null, NOW);
  assert.deepEqual(leaks(h), []);
  assert.doesNotMatch(h, /iv-usd|Day change in dollars/);
  assert.match(vis(row(h, 'AAA')), /\u22120\.99%/);
  // a collector that put the split or a dollar change into the public feed is ignored
  const dirty = clone(rawP, { totals: Object.assign({}, rawP.totals, { equity_usd: 313131, crypto_usd: 111111 }), positions: rawP.positions.map((x) => Object.assign({}, x, { day_chg: -1000 })) });
  assert.deepEqual(leaks(D.portfolio(dirty, null, NOW)), []);
});

test('after Show amounts: equity against crypto on the Positions tile, each position\'s day change in dollars under its percent', async () => {
  const k = rig();
  await k.c.reveal();
  const h = D.portfolio(P(), k.c.view(), NOW);
  // off the TV board (tv-hide): the board keeps the revealed shape it fits in
  assert.match(h, /<span class="h">Positions<\/span><b class="v">\$424,242<\/b><span class="t tv-hide">Equity \$313,131 \u00B7 Crypto \$111,111<\/span>/);
  assert.match(row(h, 'AAA'), /<small class="iv-usd tv-hide"><span class="vh">Day change in dollars <\/span><span class="delta dn">\u2212\$1,000<\/span><\/small>/);
  assert.match(row(h, 'BBB'), /<span class="delta up">\+\$1,000<\/span>/);
  assert.match(row(h, 'XRP'), /<span class="delta flat">\$0<\/span>/, 'a zero change is flat, never an arrow');
  // the dollar line sits under the percent in the value column, never in the name line
  assert.match(row(h, 'AAA'), /<span class="fr"><b>\$100\.00<\/b><small><span class="delta dn">\u22120\.99%<\/span><\/small><small class="iv-usd tv-hide">/);
});

test('a values view without a part leaves it out: no "0", no "No data" in the split; a position with no dollar change gets no line', async () => {
  const noEq = rig(() => Promise.resolve(clone(rawV, { totals: Object.assign({}, rawV.totals, { equity_usd: null }) })));
  await noEq.c.reveal();
  const h = D.portfolio(P(), noEq.c.view(), NOW);
  assert.match(vis(h), /Positions \$424,242 Crypto \$111,111/);
  assert.doesNotMatch(h, /Equity \$/);
  const none = rig(() => Promise.resolve(clone(rawV, { totals: Object.assign({}, rawV.totals, { equity_usd: null, crypto_usd: 'x' }), positions: rawV.positions.map((x) => Object.assign({}, x, { day_chg: null })) })));
  await none.c.reveal();
  const n = D.portfolio(P(), none.c.view(), NOW);
  assert.match(n, /<span class="h">Positions<\/span><b class="v">\$424,242<\/b><\/div>/);
  assert.doesNotMatch(n, /iv-usd/);
});

test('the detail goes at 30 s and on Hide; an answer that lands after Hide never paints it', async () => {
  const k = rig();
  await k.c.reveal();
  assert.ok(leaks(D.portfolio(P(), k.c.view(), NOW)).length >= 4);
  assert.equal(k.timers[0].ms, 30000);
  k.timers[0].fn();
  assert.deepEqual(leaks(D.portfolio(P(), k.c.view(), NOW)), []);
  await k.c.reveal();
  k.c.hide();
  assert.deepEqual(leaks(D.portfolio(P(), k.c.view(), NOW)), []);
  let release; const slow = rig(() => new Promise((r) => { release = r; }));
  const p = slow.c.reveal(); slow.c.hide(); release(clone(rawV)); await p;
  assert.deepEqual(leaks(D.page(rawM, P(), null, slow.c.view(), NOW, null, null)), []);
});

test('the Data sheet never carries the split or a dollar change: it takes no revealed values at all', async () => {
  assert.equal(D.data.length, 5, 'data(m, p, t, now, tr): the controller is not an input');
  const k = rig(); await k.c.reveal();
  const words = JSON.stringify(D.data(rawM, P(), null, NOW));
  assert.deepEqual(leaks(words), []);
  assert.ok(!words.includes('424,242') && !words.includes('424242'));
});

test('glue in a stub DOM: Show amounts paints the detail into the page, the hide timer and a hidden page take it out', async () => {
  const el = { innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, querySelectorAll: () => [] };
  const docL = {}, reg = {}, fetched = [], timers = [];
  const ctx = {
    document: { hidden: false, addEventListener: (t, f) => { docL[t] = f; } }, addEventListener() {},
    bfetch: async (p, o) => { fetched.push([p, o]); return { ok: true, status: 200, json: async () => clone(rawV) }; },
    tvArm: () => false, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval() {}, Date: { now: () => NOW },
    DeckUI, DeckPages: { get: async (p) => ({ ok: true, data: p === 'markets' ? clone(rawM) : p === 'portfolio' ? P() : { markets: { items: [] } } }), mark() {}, register: (r, p) => { reg[r] = p; }, tv() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  reg['money/markets'].show({ el });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.match(el.innerHTML, /data-act="reveal"/);
  assert.deepEqual(leaks(el.innerHTML), []);
  el.listeners.click({ target: { closest: (s) => (s === 'button[data-act]' ? { disabled: false, dataset: { act: 'reveal' } } : null) } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.deepEqual(fetched.map((x) => x[0]), ['/api/portfolio-values']);
  assert.equal(fetched[0][1].cache, 'no-store');
  assert.ok(leaks(el.innerHTML).length >= 4, 'equity, crypto and the dollar changes are on the page');
  timers.find((t) => t.ms === 30000).fn();
  assert.deepEqual(leaks(el.innerHTML), []);
  el.listeners.click({ target: { closest: (s) => (s === 'button[data-act]' ? { disabled: false, dataset: { act: 'reveal' } } : null) } });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.ok(leaks(el.innerHTML).length >= 4);
  ctx.document.hidden = true; docL.visibilitychange();
  assert.deepEqual(leaks(el.innerHTML), []);
  assert.deepEqual(leaks(JSON.stringify(reg['money/markets'].data())), []);
});
