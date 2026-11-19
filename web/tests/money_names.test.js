// node --test tests/*.test.js  (Money > Markets: company names read whole, layout audit T 49 follow-up 2026-11-15)
// The collector now sends the long name (47 characters for "State Street Health Care Select Sector SPDR ETF"); the page used to cut
// every name at 40 with no mark. Trending tickers, Gainers, Losers and Portfolio rows now show it whole; only a name past 120 characters is cut,
// at a word, with an ellipsis.
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
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json');
const NOW = (rawM.t + 120) * 1000;
const LONG = 'State Street Health Care Select Sector SPDR ETF';
const HUGE = ('Very Long Holding Company Name ').repeat(6).trim();

test('a long company name reads whole in Trending tickers, Gainers, Losers and Portfolio; a pathological one ends at a word with an ellipsis', () => {
  const m = JSON.parse(JSON.stringify(rawM));
  const tr = { t: rawM.t, feeds: [], tickers: [{ symbol: 'XLV', name: LONG, price: 150, pct: 0.5, t: rawM.t - 60 }, { symbol: 'ZZZ', name: HUGE, price: 1, pct: 0, t: rawM.t - 60 }] };
  m.movers = { gainers: [{ symbol: 'KEP', name: 'Korea Electric Power Corporation', price: 10, pct: 2 }], losers: [{ symbol: 'SPY', name: 'State Street SPDR S&P 500 ETF Trust', price: 600, pct: -1 }] };
  const w = D.trendingTickers(tr, NOW, m, {}), mv = D.movers(m);
  assert.ok(w.includes('<small>' + LONG + '</small>'), 'whole name, nothing after it');
  assert.ok(mv.includes('<small>Korea Electric Power Corporation</small>'));
  assert.ok(mv.includes('<small>State Street SPDR S&amp;P 500 ETF Trust</small>'));
  const huge = (w.match(/<b>ZZZ<\/b><small>([^<]+)<\/small>/) || [])[1];
  assert.ok(huge && huge.endsWith('\u2026') && huge.length <= 121, huge);
  assert.ok(HUGE.startsWith(huge.slice(0, -1)) && HUGE.charAt(huge.length - 1) === ' ', 'cut at a word');
  const p = JSON.parse(JSON.stringify(rawP)); p.positions[0].name = LONG;
  assert.ok(D.portfolio(p, null, NOW).includes(LONG));
});

test('a long headline reads whole (LayoutP row 31: a 176-character title was cut at 140 mid-word); past 300 it ends at a word', () => {
  const title = 'Team doctors say the captain will miss the next six weeks after surgery on Tuesday, and the club will hold his roster spot open for his return and seek Western Conference help now';
  assert.ok(title.length > 170 && title.length <= 300);
  const t = { markets: { t: rawM.t, items: [{ title, at: rawM.t - 60, topic: 'sports' }, { title: ('word ').repeat(90).trim(), at: rawM.t - 120 }] } };
  const items = D.headlineItems(t, null, NOW);
  assert.equal(items[0].title, title);
  assert.ok(D.headlines(t, null, NOW, null).includes('<b>' + title + '</b>'));
  assert.ok(items[1].title.endsWith('word\u2026') && items[1].title.length <= 300, items[1].title.slice(-20));
});
