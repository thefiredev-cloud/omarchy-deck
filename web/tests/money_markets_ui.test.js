// node --test tests/*.test.js  (Money > Markets, deck v3: invest.js renders markets, portfolio and market news; no DOM, no network)
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
const M = (o) => clone(rawM, Object.assign({ src: '~/.meshvault/status/deck/markets.json', age: 120, stale: false }, o));
const P = (o) => clone(rawP, Object.assign({ src: '~/.meshvault/status/deck/portfolio.json', age: 120, stale: false }, o));
const T = () => ({ markets: { t: rawM.t - 60, items: [
  { title: 'Fed holds <rates>', source: 'Reuters', at: rawM.t - 600, topic: 'rates', url: 'https://example.com/a?x=1&y=2' },
  { title: 'Quote', source: 'MarketWatch', at: rawM.t - 60, url: 'javascript:alert(1)' }] } });
const vis = (h) => h.replace(/<span class="diag">[^]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const count = (s, re) => (s.match(re) || []).length;
const PROBES = ['424242', '424,242', '313131', '6363', '6,363', '919191', '919,191', '565656', '777777', '101025', '101,025', '100000', '100,000', '3341.5'];
// source names and quote ages the old rows printed; none may reach the page
const SOURCE_WORDS = /Yahoo|yahoo|Kraken|kraken|Cboe|Reuters|MarketWatch|federalreserve|screeners|min ago|h ago|time unknown|15 min delayed|\bstale\b/;

function rig(get) {
  const timers = []; let now = NOW, changes = 0;
  const c = D.ctl({ get: (p) => { assert.equal(p, '/api/portfolio-values'); return get ? get(p) : Promise.resolve(clone(rawV)); },
    setT: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearT: () => {}, now: () => now, onChange: () => { changes++; } });
  return { c, timers, advance: (ms) => { now += ms; }, changes: () => changes };
}

test('quote model: label, price and change only; no field can carry a source or an age', () => {
  const spy = M().board.find((r) => r.id === 'spy');
  const q = D.quote(spy);
  assert.deepEqual(Object.keys(q).sort(), ['chg', 'chgTxt', 'group', 'id', 'label', 'price', 'unit']);
  // a word unit joins the tile label so a long unit never pushes the figure out of its cell (critique 5)
  const oil = D.board(M());
  assert.match(oil, /<span class="h">Crude oil, per barrel<\/span><b class="v">\$90\.01<\/b>/);
  assert.match(oil, /<b class="v">15\.52<span class="u">pts<\/span><\/b>/);
  assert.match(oil, /<span class="delta flat">0\.00%<\/span>/, 'a change that rounds to zero is flat');
  assert.deepEqual([q.label, q.price, q.chgTxt], ['S&P 500', '$774.83', '+0.67%']);
  const y = D.quote(M().board.find((r) => r.id === 'us10y'));
  assert.equal(y.price, '5.311%');
  assert.match(y.chgTxt, /^\+3\.4 bp$/);
  assert.equal(D.quote(Object.assign({}, spy, { pct: -1.234 })).chgTxt, '\u22121.23%');
  assert.equal(D.quote(Object.assign({}, spy, { pct: 0.001 })).chgTxt, '0.00%', 'a change that rounds to zero has no sign');
});

test('board rows print no symbol line, source name or quote age; a stale feed does not say stale on any row', () => {
  for (const f of [M(), M({ stale: true }), M({ session: { state: 'open' } })]) {
    const h = D.board(f);
    assert.doesNotMatch(vis(h), SOURCE_WORDS);
    assert.doesNotMatch(vis(h), /SPY \u00B7|QQQ \u00B7/);
  }
  const h = D.board(M());
  assert.match(h, /<div class="strip" data-n="8" data-nb="8" role="group" aria-label="Markets">/);
  // review 1: the price cell holds the figure alone; a unit word opens the left second line, so nothing spills out of the right column
  for (const m of h.matchAll(/<span class="fr"><b>([^<]*)<\/b>/g)) assert.match(m[1], /^\$?[\d,.]+%?$/, 'price cell: ' + m[1]);
  assert.match(h, /<b>USD\/JPY<\/b><small>Yen per dollar<\/small><\/span><span class="fr"><b>[\d.]+<\/b>/);
  // review 7: the TV board is the Markets strip and the Portfolio; the rest of the page is one Down press below
  const pg = D.page(M(), P(), T(), null, NOW, null, null);
  assert.match(pg, /^<div class="board iv-board"><section class="sect span-all iv-mk"><h2 class="secttl"><span>Markets<\/span>[^]*?<div class="iv-side"><section class="sect"><h2 class="secttl"><span>Portfolio<\/span>[^]*?<\/div><\/div><div class="flow" data-balance>/);
  assert.equal(count(pg, /class="board[ "]/g), 1);
  assert.match(vis(h), /US market closed/);
  for (const g of ['Futures', 'Dollar and currencies', 'Oil and gold', 'Crypto, 24 h']) assert.ok(h.includes('<span>' + g + '</span>'), g);
  assert.match(h, /<span class="delta up">\+0\.67%<\/span>/);
});

test('a markets feed that never answers ends in Not reporting with one Try again, not a blank page or a skeleton (60 s bound)', async () => {
  const el = { innerHTML: '', addEventListener() {}, querySelectorAll: () => [] };
  const asked = [];
  // DeckPages.get resolves ok:false with error 'timed out' once its 60 s bound fires; the stub answers that way at once
  const ctx = { document: { hidden: false, addEventListener() {} }, addEventListener() {}, setTimeout: () => 1, clearTimeout() {}, setInterval() {}, Date,
    DeckUI, DeckInvest: D, bfetch: () => new Promise(() => {}), tvArm: () => false,
    DeckPages: { get: (p, o) => { asked.push([p, o && o.timeout]); return Promise.resolve({ ok: false, status: 0, error: 'timed out' }); },
      register: (r, page) => { ctx.page = page; }, mark() {}, tv() {} } };
  vm.createContext(ctx);
  vm.runInContext(src.slice(src.indexOf('// ==== DECK INVEST UI END ====')), ctx);
  ctx.page.show({ el });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked.map((a) => a[1]), [60000, 60000, 60000, 60000]);
  assert.deepEqual(asked.map((a) => a[0]), ['markets', 'portfolio', 'today', 'trends']);
  assert.match(el.innerHTML, /Markets are not reporting/);
  assert.equal(count(el.innerHTML, /data-retry=/g), 1);
  assert.doesNotMatch(el.innerHTML, /data-skel|aria-busy/);
  assert.match(src, /const valGet=p=>bfetch\(/, 'the values fetch is bounded by bfetch too');
});

test('a zero or missing price is no quote: never $0.00, never an orphan change', () => {
  const f = M();
  f.board.find((r) => r.id === 'spy').price = 0;
  f.board.find((r) => r.id === 'qqq').price = null;
  const h = D.board(f);
  assert.doesNotMatch(h, /\$0\.00/);
  assert.equal(count(h, /No quote/g), 2);
  assert.equal(D.quote(f.board.find((r) => r.id === 'spy')).chgTxt, '');
});
test('missing and errored quotes show an unknown quote time, never a fresh-looking blank', () => {
  const missing = M();
  const row = missing.board.find(r => r.id === 'spy');
  row.price = null;
  row.t = null;
  assert.equal(D.quoteNote(row, NOW, false), 'Time unknown');
  const html = D.board(missing, null, null, { now: NOW });
  assert.match(html, /No quote/);
  assert.match(html, /Time unknown/);

  const errored = M({ errors: [{ source: 'quote WATCH', reason: 'source unavailable' }] });
  const watch = errored.watchlist[0];
  watch.price = null;
  watch.t = null;
  assert.equal(D.quoteNote(watch, NOW, false), 'Time unknown');
});

test('page status: stale once for the page, from the feed flag or from old lead quotes while the market is open', () => {
  const fresh = D.status(M(), P(), T(), NOW);
  assert.deepEqual([fresh.age, fresh.refresh, fresh.missing, fresh.stale], [120, 300, 0, false]);
  const flagged = D.status(M({ stale: true }), P(), T(), NOW);
  assert.equal(flagged.stale, true);
  assert.ok(flagged.age > 2 * flagged.refresh, 'the freshness mark turns into Out of date');
  const open = D.status(M({ session: { state: 'open' } }), P(), T(), NOW + 3 * 3600 * 1000);
  assert.equal(open.stale, true);
  const closedFeed = M();
  closedFeed.board.filter(r => r.group === 'crypto').forEach(r => { r.t = (NOW + 3 * 3600 * 1000) / 1000 - 30; });
  const closed = D.status(closedFeed, P(), T(), NOW + 3 * 3600 * 1000);
  assert.equal(closed.stale, false, 'a closed market keeps its last close without going stale');
  assert.equal(D.status(null, P(), { error: 'http 403' }, NOW).missing, 2);
  const page = D.page(M({ stale: true }), P(), T(), null, NOW, null, null);
  assert.doesNotMatch(vis(page), /\bstale\b|Out of date/, 'no per-row or per-section stale words');
});
test('stale, missing and errored quotes cannot leave Markets marked fresh', () => {
  const old = M();
  old.board.find(r => r.id === 'spy').t = NOW / 1000 - 6 * 86400;
  assert.equal(D.status(old, P(), T(), NOW).stale, true, 'a closed market quote older than five days is stale');
  assert.equal(D.data(old, P(), T(), NOW).sources[0].state, 'stale');

  const missing = M();
  missing.board.find(r => r.id === 'dxy').price = null;
  assert.equal(D.status(missing, P(), T(), NOW).stale, true, 'a missing non-lead quote is stale');
  assert.equal(D.data(missing, P(), T(), NOW).sources[0].state, 'stale');

  const errored = M({ errors: [{ source: 'quote WATCH', reason: 'source unavailable' }] });
  assert.equal(D.status(errored, P(), T(), NOW).stale, true, 'a failed watchlist quote is stale');
  assert.equal(D.data(errored, P(), T(), NOW).sources[0].state, 'stale');
});
test('stale mover quotes make the Markets source out of date', () => {
  const m = M();
  m.movers.gainers[0].t = NOW / 1000 - 6 * 86400;
  assert.equal(D.status(m, P(), T(), NOW).stale, true);
  assert.equal(D.data(m, P(), T(), NOW).sources[0].state, 'stale');
});
test('missing mover quotes make the Markets source out of date', () => {
  const m = M();
  m.movers.losers[0].price = null;
  m.movers.losers[0].t = null;
  assert.equal(D.status(m, P(), T(), NOW).stale, true);
  assert.equal(D.data(m, P(), T(), NOW).sources[0].state, 'stale');
});

test('failed mover lists make the Markets source out of date', () => {
  const m = M({ errors: [{ source: 'movers gainers', reason: 'timeout' }] });
  assert.equal(D.status(m, P(), T(), NOW).stale, true);
  assert.equal(D.data(m, P(), T(), NOW).sources[0].state, 'stale');
});

test('crypto trades around the clock: a closed equity session never excuses an old crypto quote', () => {
  const old = M({ session: { state: 'closed' } });
  const btc = old.board.find(r => r.group === 'crypto');
  assert.ok(btc, 'fixture carries a crypto row');
  btc.t = NOW / 1000 - 3 * 3600;
  assert.equal(D.status(old, P(), T(), NOW).stale, true, 'three hour old crypto is stale while stocks are closed');
  assert.equal(D.data(old, P(), T(), NOW).sources[0].state, 'stale');
  assert.match(D.quoteNote(btc, NOW, false), /^As of /);
  const spy = old.board.find(r => r.id === 'spy');
  spy.t = NOW / 1000 - 3 * 3600;
  assert.equal(D.quoteNote(spy, NOW, false), '', 'an equity close from hours ago is still current while closed');
  btc.t = NOW / 1000 - 60;
  assert.equal(D.status(old, P(), T(), NOW).stale, false);
});

test('a markets feed with no quote board cannot leave Markets marked fresh', () => {
  const absent = M();
  delete absent.board;
  assert.equal(D.status(absent, P(), T(), NOW).stale, true, 'a feed without a board is stale');
  assert.equal(D.data(absent, P(), T(), NOW).sources[0].state, 'stale');
  const empty = M({ board: [] });
  assert.equal(D.status(empty, P(), T(), NOW).stale, true, 'an empty board is stale, not "No quotes yet" under a fresh mark');
  assert.equal(D.data(empty, P(), T(), NOW).sources[0].state, 'stale');
});


test('future quote clocks mark the page out of date without restoring per-row source text', () => {
  for (const state of ['open', 'closed']) {
    const m = M({ session: { state } });
    m.board.find(r => r.id === 'spy').t = NOW / 1000 + 3600;
    const status = D.status(m, P(), T(), NOW);
    assert.equal(status.stale, true);
    assert.ok(status.age > 2 * status.refresh);
    assert.doesNotMatch(vis(D.board(m)), SOURCE_WORDS);
    const quote = D.data(m, P(), T(), NOW).sources[0];
    assert.equal(quote.state, 'stale');
    assert.ok(quote.asOf <= NOW / 1000);
  }
  const m = M();
  m.board.forEach(r => { r.t = NOW / 1000 + 1; });
  assert.equal(D.data(m, P(), T(), NOW).sources[0].asOf, '');
});

test('a feed stamped in the future is out of date, never "just updated"', () => {
  const stamped = (o) => M(Object.assign({ t: undefined, generated_at: undefined }, o));
  for (const field of ['generated_at', 't']) {
    const m = stamped({ [field]: NOW / 1000 + 86400 });
    const status = D.status(m, null, null, NOW);
    assert.equal(status.stale, true, field);
    assert.ok(status.age > 2 * status.refresh, field + ': the mark shows it as old, not as age 0');
  }
  const skew = D.status(stamped({ generated_at: NOW / 1000 + 5 }), null, null, NOW);
  assert.equal(skew.stale, false, 'a few seconds of clock skew is not a stale feed');
  assert.equal(skew.age, 0);
});

test('a quote time of zero or below is an unknown time, never a 1969 date', () => {
  const spy = M().board.find((r) => r.id === 'spy');
  for (const t of [0, -5]) {
    const r = Object.assign({}, spy, { t });
    assert.equal(D.quoteNote(r, NOW, false), 'Time unknown', 't=' + t);
    assert.equal(D.quoteNote(r, NOW, true), 'Time unknown', 't=' + t);
    const m = M(); m.board.find((x) => x.id === 'spy').t = t;
    assert.equal(D.status(m, P(), T(), NOW).stale, true);
  }
  const m = M(); m.board.forEach((r) => { r.t = 0; });
  assert.equal(D.data(m, P(), T(), NOW).sources[0].asOf, '', 'no valid quote time: the Data sheet gives no as-of date');
});

test('the Data sheet dates the quotes by the stock board, never by a crypto quote that is always fresh', () => {
  const m = M({ session: { state: 'closed' } });
  const eq = m.board.filter((r) => r.group !== 'crypto'), cr = m.board.filter((r) => r.group === 'crypto');
  const friday = NOW / 1000 - 3 * 86400;
  eq.forEach((r) => { r.t = friday; });
  cr.forEach((r) => { r.t = NOW / 1000 - 30; });
  const q = D.data(m, P(), T(), NOW).sources[0];
  assert.equal(q.asOf, friday, 'closed market: the as-of date is the last session, not the crypto minute');
  assert.equal(q.state, 'ok', 'a long weekend alone is not a stale board');
  eq.forEach((r) => { r.t = null; });
  assert.equal(D.data(m, P(), T(), NOW).sources[0].asOf, '', 'no timed stock quote: no as-of date, even with crypto fresh');
});

test('portfolio before Show amounts: masked tiles, no amount digit, one Show amounts button, percent stays visible', () => {
  const h = D.portfolio(P(), null, NOW);
  for (const probe of PROBES) assert.ok(!h.includes(probe), probe + ' leaked before Show amounts');
  assert.equal(count(h, /\$\u2022\u2022\u2022/g), 3);
  assert.equal(count(h, /data-act="reveal"/g), 1);
  assert.match(vis(h), /Day change \u22121\.50%/);
  assert.match(vis(h), /AAA Alpha Corp \$100\.00 \u22120\.99%/);
  // a collector that put amounts into the public feed is ignored
  const dirty = P({ totals: Object.assign({}, rawP.totals, { positions_usd: 424242 }), positions: rawP.positions.map((x) => Object.assign({}, x, { qty: 1000, value: 100000 })) });
  const d = D.portfolio(dirty, null, NOW);
  for (const probe of PROBES) assert.ok(!d.includes(probe), probe + ' read from the public feed');
});

test('Show amounts: amounts come only from the values view, count down, and vanish when the timer fires', async () => {
  const k = rig();
  await k.c.reveal();
  const h = D.portfolio(P(), k.c.view(), NOW);
  assert.match(h, /\u2212\$6,363/);
  assert.match(h, /\$424,242/);
  assert.match(h, /\u2212\$919,191/);
  assert.match(h, /Excess liquidity \$565,656/);
  assert.match(h, /1,000 \u00D7 \$100\.00 = \$100,000/);
  assert.match(h, /Hides in 30 s/);
  assert.match(h, /data-act="hide"/);
  assert.equal(k.timers.length, 1);
  assert.equal(k.timers[0].ms, D.HIDE_MS);
  k.timers[0].fn();
  const after = D.portfolio(P(), k.c.view(), NOW);
  for (const probe of PROBES) assert.ok(!after.includes(probe), probe + ' still there after expiry');
  assert.equal(k.c.view().vals, null);
});

test('Show amounts: Hide, the sweep and a request in flight when hidden all drop the amounts; a failing route shows words, never an amount', async () => {
  const k = rig();
  await k.c.reveal();
  k.c.hide();
  assert.equal(k.c.view().vals, null);
  await k.c.reveal();
  k.advance(D.HIDE_MS + 1);
  assert.equal(k.c.sweep(), true);
  assert.equal(k.c.view().vals, null);
  let release;
  const slow = rig(() => new Promise((res) => { release = res; }));
  const p = slow.c.reveal();
  assert.equal(slow.c.view().busy, true);
  slow.c.hide();
  release(clone(rawV));
  await p;
  assert.equal(slow.c.view().vals, null, 'an answer that lands after Hide is dropped unread');
  const bad = rig(() => Promise.resolve({ error: 'http 403' }));
  await bad.c.reveal();
  const h = D.portfolio(P(), bad.c.view(), NOW);
  assert.match(vis(h), /Amounts are not available\. Try again\./);
  for (const probe of PROBES) assert.ok(!h.includes(probe), probe);
  const old = rig(() => Promise.resolve(clone(rawV, { stale: true })));
  await old.c.reveal();
  assert.match(vis(D.portfolio(P(), old.c.view(), NOW)), /Amounts out of date/);
});

test('holdings date is a status only when old or unknown, and follows the clock, not the stored day count', () => {
  const old = D.portfolio(P(), null, NOW);
  assert.match(vis(old), /Holdings as of [A-Z][a-z]{2} \d+/);
  const recent = P();
  recent.basis.equity_qty_as_of = rawM.t - 3600;
  assert.doesNotMatch(vis(D.portfolio(recent, null, NOW)), /Holdings as of/);
  const future = P();
  future.basis.equity_qty_as_of = rawM.t + 3 * 86400;
  assert.match(vis(D.portfolio(future, null, NOW)), /Holdings date unknown/);
  assert.equal(D.holdings(P(), NOW + 3 * 86400 * 1000).days, D.holdings(P(), NOW).days + 3);
  const live = P({ as_of: { positions: rawM.t - 2 * 86400 } });
  assert.equal(D.holdings(live, NOW).days, 2, 'the as_of.positions stamp wins over the basis');
  assert.match(vis(old), /Margin in use/);
});

test('holdings: a snapshot a day or more old reads stale on the Data sheet, as crypto does', () => {
  const holdings = (p) => D.data(M(), p, T(), NOW).sources.find((s) => /^Holdings/.test(s.name));
  assert.equal(holdings(P()).state, 'stale');
  const fresh = P({ basis: Object.assign({}, rawP.basis, { equity_qty_as_of: rawM.t - 3600 }) });
  assert.equal(holdings(fresh).state, 'ok');
});

test('holdings: with no date stamp the stored day count is never shown as the current age', () => {
  const p = P();
  delete p.basis.equity_qty_as_of;
  for (const stored of [0, 7]) {
    p.basis.equity_qty_age_days = stored;
    assert.equal(D.holdings(p, NOW).days, null, 'stored ' + stored);
    assert.match(vis(D.portfolio(p, null, NOW)), /Holdings date unknown/, 'stored ' + stored);
  }
});

test('crypto quantities date amounts independently of current equity holdings', async () => {
  const k = rig();
  await k.c.reveal();
  for (const stamp of [NOW / 1000 - 2 * 86400, null, NOW / 1000 + 3600]) {
    const p = P({ as_of: { positions: NOW / 1000 } });
    p.basis.equity_qty_as_of = NOW / 1000;
    p.basis.crypto_qty_as_of = stamp;
    const shown = D.portfolio(p, k.c.view(), NOW);
    assert.match(vis(shown), /Amounts out of date/);
    assert.doesNotMatch(vis(D.portfolio(p, null, NOW)), /Amounts out of date/);
    const crypto = D.data(M(), p, T(), NOW).sources.find(s => s.name === 'Crypto balances');
    assert.ok(crypto);
    assert.equal(crypto.state, 'stale');
    assert.equal(crypto.gives, 'Balance not live');
    assert.equal(crypto.asOf, stamp != null && stamp <= NOW / 1000 ? stamp : '');
  }
  const fresh = P({ as_of: { positions: NOW / 1000 } });
  fresh.basis.crypto_qty_as_of = NOW / 1000;
  assert.doesNotMatch(vis(D.portfolio(fresh, k.c.view(), NOW)), /Amounts out of date/);
  assert.equal(D.data(M(), fresh, T(), NOW).sources.find(s => s.name === 'Crypto balances').gives, 'Live balance');
  fresh.stale = true;
  assert.equal(D.data(M(), fresh, T(), NOW).sources.find(s => s.name === 'Crypto balances').gives, 'Balance not live');
  fresh.stale = false;
  fresh.positions = fresh.positions.filter(x => x.kind !== 'crypto');
  fresh.basis.crypto_qty_as_of = null;
  assert.doesNotMatch(vis(D.portfolio(fresh, k.c.view(), NOW)), /Amounts out of date/);
});

test('catalysts: today and later, opens at 6 and steps by 12, High is the only impact word, html escaped, links http(s) only', () => {
  const f = M();
  f.catalysts = Array.from({ length: 20 }, (_, i) => ({ date: '2026-10-' + String(10 + (i % 9)).padStart(2, '0'), title: 'Event ' + i + ' <b>', impact: i % 2 ? 'H' : 'L', kind: 'macro', source: 'bls.gov', url: i ? 'https://bls.gov/x' : 'javascript:alert(1)' }))
    .concat([{ date: '2026-09-01', title: 'Old event', kind: 'macro' }]);
  const h = D.catalysts(f, NOW, null);
  assert.equal(count(h, /class="frow"/g), 6);
  assert.match(h, /data-ivmore="up">Show 12 more</);
  assert.doesNotMatch(h, /Old event|Event \d+ <b>|javascript:|>Low<|>Medium<|bls\.gov<|BLS/);
  assert.match(h, /&lt;b&gt;/);
  assert.match(h, /<span class="pill">High<\/span>/);
  const more = D.catalysts(f, NOW, { up: 18 });
  assert.equal(count(more, /class="frow"/g), 18);
  assert.match(more, /Show 2 more[^]*Show fewer/);
});

test('headlines: market news and recent filings in one list, newest first, no source names, escaped, safe links only', () => {
  const f = M();
  f.catalysts = [{ date: '2026-10-05', title: 'ACME 8-K', kind: 'filing', source: 'sec.gov', url: 'https://sec.gov/a' }];
  const h = D.headlines(T(), f, NOW, null);
  const titles = [...h.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['Quote', 'Fed holds &lt;rates&gt;', 'ACME 8-K']);
  assert.doesNotMatch(vis(h), /Reuters|MarketWatch|sec\.gov|SEC/);
  assert.match(h, /href="https:\/\/example\.com\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(vis(h), /Rates/);
  assert.match(vis(h), /Filing/);
});

test('page: one broken feed never takes the others down; a dead board leads with one status and one Try again', () => {
  const ok = D.page(M(), P(), T(), null, NOW, null, null);
  for (const s of ['Markets', 'Portfolio', 'Trending tickers', 'Catalysts', 'Headlines', 'Gainers', 'Losers']) assert.ok(ok.includes('<span>' + s + '</span>'), s);
  assert.equal(count(ok, /data-retry/g), 0);
  assert.doesNotMatch(vis(ok), SOURCE_WORDS);
  const noBoard = D.page({ error: 'file missing' }, P(), T(), null, NOW, null, null);
  assert.equal(count(noBoard, /data-retry=/g), 1);
  assert.match(noBoard, /class="stale-bar"/);
  assert.match(vis(noBoard), /Portfolio .*AAA/);
  const noPort = D.page(M(), { error: 'http 403' }, null, null, NOW, null, null);
  assert.match(vis(noPort), /Portfolio is not reporting/);
  assert.match(vis(noPort), /Markets US market closed/);
  const loading = D.page(null, null, null, null, NOW, null, { m: 'loading', p: 'slow', t: 'loading' });
  assert.equal(count(loading, /data-skel="1"/g), 4);
  assert.match(loading, /Taking longer than usual/);
  assert.equal(count(loading, /data-retry/g), 0, 'still loading is not a failure');
});

test('Data sheet: the source names, read times, delay note and movers basis the rows dropped', () => {
  const d = D.data(M(), P(), T(), NOW);
  const names = d.sources.map((s) => s.name).join(' | ');
  assert.match(names, /Market quotes \(Yahoo Finance/);
  assert.match(names, /Holdings \(owner screenshot snapshot\)/, 'the quantities name their source (L05)');
  assert.match(names, /Market news \(Reuters, MarketWatch\)/);
  assert.ok(d.sources.every((s) => ['ok', 'stale', 'needs_key', 'blocked', 'never'].includes(s.state)));
  assert.ok(d.sources.every((s) => s.asOf === '' || Number.isInteger(s.asOf)), 'read times are epoch seconds the Data sheet prints as dates, never ISO text');
  assert.equal(d.sources[0].asOf, rawM.board.filter((r) => r.group !== 'crypto').reduce((a, r) => Math.max(a, r.t || 0), 0), 'dated by the stock board, as the feed\'s as_of.quotes is');
  const method = d.method.map((r) => r.join(': ')).join(' | ');
  assert.match(method, /about 15 min delayed/);
  assert.match(method, /Yahoo day screeners/);
  const down = D.data(null, { error: 'x' }, null, NOW);
  assert.deepEqual(down.sources.map((s) => s.state), ['never', 'never', 'never']);
});

test('Data sheet shows the future-clock reason as escaped setup text', () => {
  const reason = 'quote timestamp is in the future';
  const hostile = reason + ' <img src=x onerror="alert(1)"> & bad clock';
  const m = M({ errors: [
    { source: 'quote SPY', reason },
    { source: '<script>BAD</script>', reason: hostile },
    { source: 'quote QQQ', reason: '' }
  ] });
  const data = D.data(m, P(), T(), NOW);
  assert.equal(data.setup[0].line, reason, 'the model keeps the actual clock failure');
  const sheet = DeckUI.dataSheet(data, { now: NOW });
  assert.match(sheet, /<small>quote timestamp is in the future<\/small>/);
  assert.ok(sheet.includes(D.esc(hostile)), 'reason text is escaped exactly once by the shared sheet');
  assert.ok(sheet.includes('&lt;script&gt;BAD&lt;/script&gt;'));
  assert.doesNotMatch(sheet, /<img\b|<script\b/);
  assert.equal(data.setup[2].line, 'Not reporting in the last read.', 'a missing reason keeps the fallback');
});

test('wiring: registers money/markets, never wraps deckPage, no logs, values never cached; the one stored thing is the chart pick', () => {
  assert.match(src, /DeckPages\.register\('money\/markets',\{/);
  assert.doesNotMatch(src, /deckPage\s*=|DeckPages\.hook\(/);
  assert.doesNotMatch(src, /sessionStorage|console\.|document\.cookie/);
  // localStorage holds only the chart's symbol and range under one key; nothing else on this page is stored
  assert.deepEqual([...src.matchAll(/localStorage\.(\w+)\(([^,)]*)/g)].map((x) => x[1] + ' ' + x[2]), ['getItem PICK_KEY', 'setItem PICK_KEY']);
  assert.match(src, /localStorage\.setItem\(PICK_KEY,JSON\.stringify\(\{sel:IV\.view\.sel,rng:IV\.view\.rng\}\)\)/);
  assert.doesNotMatch(src, /portfolio-values\?|\?t=/);
  // positions come as custom properties only (the chart's marks); every look comes from ui.css and css/money.css
  assert.doesNotMatch(src, /createElement\('style'\)|style="(?!--)|\.style\.(?!setProperty\('--)/, 'no injected styles');
  const sw = fs.readFileSync(path.join(__dirname, '../static/sw.js'), 'utf8');
  assert.match(sw, /u\.pathname==='\/api\/portfolio-values'/);
});
