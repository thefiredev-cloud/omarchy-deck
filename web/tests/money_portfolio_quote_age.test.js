// node --test tests/*.test.js  (Money > Markets: a held name's quote age). The portfolio rows used to print any price with its
// day change as if it were current; the markets board already said "As of Nov 7" or "Time unknown" for an old or undated quote.
// What it proves: a position whose own quote time is old, undated or in the future is marked on its row (no amount involved),
// a fresh one carries no mark, and the public feed never needs a revealed value to say so.
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

const WED = 1794430800; // Wed 2026-11-11 21:00 UTC (4 pm ET), a trading day after the close
const NOW = (WED + 600) * 1000;
const DAY = 86400;
const feed = (rows) => ({
  t: WED + 600, refresh: 300, as_of: { positions: WED - DAY, crypto: WED, prices: WED },
  basis: { equity_qty_as_of: WED - DAY, equity_qty_age_days: 1, equity_qty_source: 'IBKR Flex end-of-day report, read-only', crypto_qty_as_of: WED, crypto_live: true },
  totals: { day_pct: 0.5, positions: rows.length, priced: rows.length },
  positions: rows,
});
const eq = (symbol, t, extra) => Object.assign({ symbol, kind: 'equity', name: symbol + ' Corp', price: 10, chg: 0.1, pct: 1, t }, extra);
const rowOf = (h, sym) => (h.match(new RegExp('<div class="frow"><span class="fl"><b>' + sym + '</b>[^]*?</span></div>')) || [''])[0];
const closed = { session: { state: 'closed' } };
const open = { session: { state: 'open' } };

test('portfolio rows: a quote more than five days old says when it is from, a fresh one says nothing', () => {
  const h = D.portfolio(feed([eq('OLD', WED - 8 * DAY), eq('NEW', WED)]), null, NOW, closed);
  assert.match(vis(rowOf(h, 'OLD')), /OLD OLD Corp · As of Nov 3/);
  assert.doesNotMatch(vis(rowOf(h, 'NEW')), /As of|Time unknown/);
});

test('portfolio rows: an undated or future-dated quote reads as Time unknown, never as current', () => {
  const rows = [eq('NOT', undefined), eq('FUT', WED + 3600), eq('NUL', null)];
  const h = D.portfolio(feed(rows), null, NOW, closed);
  for (const s of ['NOT', 'FUT', 'NUL']) assert.match(vis(rowOf(h, s)), /Time unknown/, s);
});

test('portfolio rows: in an open session a quote older than 30 minutes is marked; crypto has that limit in any session', () => {
  const openNow = (WED - 4 * 3600 + 600) * 1000; // 12:10 pm ET: regular session
  const stale = WED - 4 * 3600 - 3600; // an hour before
  const h = D.portfolio(feed([eq('EQ', stale), eq('FRESH', WED - 4 * 3600 + 540), eq('BTC', stale, { kind: 'crypto' })]), null, openNow, open);
  assert.match(vis(rowOf(h, 'EQ')), /As of Nov 11/);
  assert.doesNotMatch(vis(rowOf(h, 'FRESH')), /As of|Time unknown/);
  assert.match(vis(rowOf(h, 'BTC')), /24 h change · As of Nov 11/);
  // outside the session the same hour-old equity quote is just the last close
  const c = D.portfolio(feed([eq('EQ', stale), eq('BTC', stale, { kind: 'crypto' })]), null, openNow, closed);
  assert.doesNotMatch(vis(rowOf(c, 'EQ')), /As of|Time unknown/);
  assert.match(vis(rowOf(c, 'BTC')), /As of Nov 11/);
});

test('portfolio rows: a name with no quote shows its unknown quote time', () => {
  const h = D.portfolio(feed([eq('GONE', WED - 9 * DAY, { price: null, pct: null, chg: null })]), null, NOW, closed);
  const r = vis(rowOf(h, 'GONE'));
  assert.match(r, /No quote/);
  assert.match(r, /Time unknown/);
});
