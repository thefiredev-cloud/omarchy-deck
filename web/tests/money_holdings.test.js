// node --test tests/*.test.js  (Money > Markets: positions use the broker's own quantities, with their source and age named; plan row
// L05 of perceive/SeeLostSweep.md; DoMarkets 2026-11-15, #372 step 4). The served portfolio basis carries equity_qty_source (the
// collector's own words, rust/src/sources.rs prepare_portfolio) and never equity_qty_label, so the Data sheet named no source at all.
// An end-of-day report is a business day behind by nature: the Friday close read on a Sunday is current, not a warning.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = new Function('DeckUI', cut(src, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(DeckUI);
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const CLOSE = 1794603600; // Fri 2026-11-13 21:00 UTC, the 4 pm ET close
const EOD = 'IBKR Flex end-of-day report, read-only (Client Portal stays off, owner 2026-09-28)';
// what GET /api/portfolio serves (no amounts): the kit's shape
const feed = (src, at) => ({ t: CLOSE + 2 * 86400, refresh: 300, as_of: { positions: at, crypto: CLOSE + 2 * 86400, prices: CLOSE + 2 * 86400 },
  basis: { equity_qty_as_of: at, equity_qty_age_days: 2, equity_qty_source: src, crypto_qty_as_of: CLOSE + 2 * 86400, crypto_live: true, crypto_qty_source: 'Kraken balance via mesh-brokers-snapshot, read-only', price_note: 'Equity prices are delayed public quotes.' },
  totals: { day_pct: -1.5, positions: 2, priced: 2 }, positions: [{ symbol: 'NVDA', kind: 'equity', name: 'NVIDIA Corporation', price: 162.85, pct: -2.01 }] });
const act = (h) => (h.match(/<h2 class="secttl"><span>Portfolio<\/span><span class="act">([^]*?)<\/span><\/h2>/) || [])[1] || '';

test('L05: an end-of-day report names its close, and is a status only when it is more than a weekend behind', () => {
  const sun = (CLOSE + 2 * 86400 + 3600) * 1000; // Sunday
  const h = act(D.portfolio(feed(EOD, CLOSE), null, sun));
  assert.equal(vis(h), 'Holdings from the Nov 13 close');
  assert.doesNotMatch(h, /sd warn/, 'the Friday close on a Sunday is the newest there is');
  const wed = (CLOSE + 5 * 86400) * 1000; // the next Wednesday, and still the Friday report
  const old = act(D.portfolio(feed(EOD, CLOSE), null, wed));
  assert.match(old, /<span class="sd warn"><\/span>Holdings from the Nov 13 close/);
  // a snapshot that is not an end-of-day report keeps the old rule: a day or more old is a status
  assert.match(act(D.portfolio(feed('owner screenshot snapshot', CLOSE), null, sun)), /<span class="sd warn"><\/span>Holdings as of Nov 13/);
});

test('L05: the Data sheet names where the quantities come from and when, and keeps the collector\'s words', () => {
  const d = D.data(null, feed(EOD, CLOSE), null, (CLOSE + 2 * 86400) * 1000);
  const s = d.sources.find((x) => /^Holdings/.test(x.name));
  assert.equal(s.name, 'Holdings (IBKR Flex end-of-day report)');
  assert.equal(s.asOf, CLOSE);
  assert.ok(d.method.some(([k, v]) => k === 'Quantities' && v === EOD));
  assert.ok(d.method.some(([k, v]) => k === 'Crypto balances' && /^Kraken balance/.test(v)));
  // no source on the page itself (RULES 4): only the date
  assert.doesNotMatch(vis(D.portfolio(feed(EOD, CLOSE), null, (CLOSE + 2 * 86400) * 1000)), /IBKR|Flex|Kraken|snapshot/);
});

test('a small revealed quantity keeps its digits, never reads as 0 ×: 0.00001234 BTC shows 0.0000123', () => {
  const p = { ...feed(EOD, CLOSE), positions: [{ symbol: 'BTC', kind: 'crypto', name: 'Bitcoin', price: 100000, chg: 1000, pct: 1, t: CLOSE + 2 * 86400 }] };
  const rev = { vals: { totals: null, stale: false, positions: [{ symbol: 'BTC', kind: 'crypto', qty: 0.00001234, value: 1.23, day_chg: 0.01 }] }, exp: 0, err: '', busy: false };
  const h = vis(D.portfolio(p, rev, (CLOSE + 2 * 86400 + 60) * 1000));
  assert.match(h, /0\.0000123 × \$100,000/);
  assert.doesNotMatch(h, /(^| )0 × /);
});

test('a holdings stamp of zero or below is unknown, never "Holdings as of Dec 31" (1969) or a 1969 Data sheet date', () => {
  const now = (CLOSE + 2 * 86400) * 1000;
  for (const z of [0, -5]) {
    const p = feed('owner screenshot snapshot', z);
    p.basis.crypto_qty_as_of = z;
    p.positions.push({ symbol: 'BTC', kind: 'crypto', price: 1, pct: 1, t: CLOSE + 2 * 86400 });
    assert.deepEqual(D.holdings(p, now), { at: null, days: null }, 'stamp ' + z);
    assert.equal(vis(act(D.portfolio(p, null, now))), 'Holdings date unknown');
    const d = D.data(null, p, null, now);
    assert.equal(d.sources.find((x) => /^Holdings/.test(x.name)).asOf, '');
    const c = d.sources.find((x) => x.name === 'Crypto balances');
    assert.equal(c.asOf, '');
    assert.equal(c.state, 'stale');
  }
  // a zero positions stamp falls back to the basis stamp, as a missing one does
  const q = feed('owner screenshot snapshot', CLOSE);
  q.as_of.positions = 0;
  assert.equal(D.holdings(q, now).at, CLOSE);
});
