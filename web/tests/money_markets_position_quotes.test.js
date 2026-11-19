// node --test tests/*.test.js  (Money > Markets, Portfolio rows: a position price with no markets feed to say whether the market is open is held to the
// open-session age limit, so an old price says its date instead of reading as fresh)
require('./setup-core.js');
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

const NOW = Date.UTC(2026, 10, 17, 18, 0, 0);
const S = NOW / 1000;
const portfolio = (t) => ({ basis: {}, totals: {}, positions: [{ symbol: 'AAPL', name: 'Apple', kind: 'equity', price: 250, pct: 0.5, t }] });
const markets = (state) => ({ session: { state }, board: [], watchlist: [], movers: {}, errors: [], catalysts: [] });
const aapl = (html) => vis(html.slice(html.indexOf('<b>AAPL</b>'), html.indexOf('</section>', html.indexOf('<b>AAPL</b>'))));

test('a position price two days old with the markets feed down says its date, never reads fresh', () => {
  const r = aapl(D.portfolio(portfolio(S - 2 * 86400), null, NOW, null, {}));
  assert.match(r, /As of Nov 15/);
});

test('a position price with the markets feed down and quoted minutes ago shows no age', () => {
  const r = aapl(D.portfolio(portfolio(S - 300), null, NOW, null, {}));
  assert.doesNotMatch(r, /As of/);
});

test('a position price two days old on a closed market keeps its last close with no age', () => {
  const r = aapl(D.portfolio(portfolio(S - 2 * 86400), null, NOW, markets('closed'), {}));
  assert.doesNotMatch(r, /As of/);
});

test('a position price forty minutes old during the open session says its date', () => {
  const r = aapl(D.portfolio(portfolio(S - 2400), null, NOW, markets('open'), {}));
  assert.match(r, /As of Nov 17/);
});
