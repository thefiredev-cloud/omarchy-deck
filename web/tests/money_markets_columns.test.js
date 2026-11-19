// node --test tests/*.test.js  (Money > Markets layout audit 2026-11-15: L row 70; second pass LayoutD 22-23, LayoutL-2 N5-N6, LayoutT-2 N3-N4)
// What it proves: a day label never breaks inside itself, and no list on Markets continues in another column: a list split under the
// Portfolio lost its title and read as holdings. Every flow section is whole; the flow balances them (data-balance).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/invest.js'), 'utf8');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../static/css/money.css'), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const DeckUI = new Function(cut(deck, '// ==== DECK V6 UI HELPERS BEGIN', '// ==== DECK V6 UI HELPERS END ====') + '\nreturn DeckUI;')();
const D = new Function('DeckUI', cut(src, '// ==== DECK INVEST UI BEGIN', '// ==== DECK INVEST UI END ====') + '\nreturn DeckInvest;')(DeckUI);
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json');
const NOW = (rawM.t + 120) * 1000;

test('a day label is one unbreakable phrase: "Tue Nov 17" never splits from its day at a narrow column', () => {
  const later = new Date(NOW + 9 * 864e5).toISOString().slice(0, 10);
  const s = D.dayLabel(later, NOW);
  assert.match(s, /^[A-Z][a-z]{2}\u00A0[A-Z][a-z]{2}\u00A0\d{1,2}$/);
  assert.doesNotMatch(s, / /);
});

test('no list on Markets continues in another column: every flow section is whole, and no stylesheet lets one break', () => {
  const t = { markets: { t: rawM.t, items: [{ title: 'A', at: rawM.t - 60, topic: 'rates' }] } };
  const h = D.page(rawM, rawP, t, null, NOW, null, null);
  const flow = h.slice(h.indexOf('<div class="flow" data-balance>'));
  assert.ok(h.includes('<div class="flow" data-balance>'), 'the flow opts in to the shared balancer');
  const titles = [...flow.matchAll(/<section class="([^"]*)"><h2 class="secttl"><span>([^<]+)<\/span>/g)];
  for (const s of ['Catalysts', 'Headlines']) assert.ok(titles.some((x) => x[2] === s), s + ' drawn');
  // Trending tickers sit under the positions and the movers after them, above the flow (the place the watchlist had, 2026-11-17); from
  // a laptop up they sit under the chart and the movers under the positions
  for (const s of ['Trending tickers', 'Gainers', 'Losers']) assert.ok(!titles.some((x) => x[2] === s), s + ' is not in the flow');
  assert.match(h.slice(0, h.indexOf('<div class="flow" data-balance>')), /<span>Portfolio<\/span>[^]*<\/section><section class="sect iv-tr"><h2 class="secttl"><span>Trending tickers<\/span>[^]*<\/section><section class="sect"><h2 class="secttl"><span>Gainers<\/span>/);
  for (const [, cls, s] of titles) assert.equal(cls, 'sect', s + ' carries no class that could opt it into breaking');
  const ui = fs.readFileSync(path.join(__dirname, '../static/ui.css'), 'utf8');
  assert.match(ui, /\.flow>\*\{break-inside:avoid;/, 'the shared rule keeps every flow section whole');
  const rules = css.replace(/\/\*[^]*?\*\//g, '');
  assert.doesNotMatch(rules, /break-inside:auto|break-after:avoid|box-decoration-break|iv-long/);
  assert.doesNotMatch(rules, /\.flow>[^{]*\{[^}]*break-inside/);
});
