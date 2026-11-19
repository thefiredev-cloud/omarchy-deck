// node --test tests/*.test.js  (Money > Markets movers: a mover row with an old, untimed or future-dated price says so; a failed list says it is not reporting)
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
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markets.sample.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const rowOf = (html, label) => { const i = html.indexOf('<b>' + label); assert.ok(i >= 0, label); return html.slice(i, html.indexOf('</div>', i) + 6); };
// a closed market a few minutes after the newest mover was priced
const NEWEST = Math.max(...raw.movers.gainers.concat(raw.movers.losers).map((r) => r.t));
const NOW = (NEWEST + 600) * 1000;
const S = NOW / 1000;
const feed = (patch) => { const m = clone(raw); Object.assign(m.movers.gainers[0], patch); return m; };

test('mover rows priced inside the closed-session window print no age', () => {
  assert.doesNotMatch(vis(D.movers(clone(raw), NOW)), /As of|Time unknown/);
});

test('a mover priced more than five days ago says "As of" on its own row; its neighbours stay clean', () => {
  const m = feed({ t: S - 9 * 86400 });
  const g = m.movers.gainers;
  const h = D.movers(m, NOW);
  assert.match(rowOf(h, g[0].symbol), /As of /);
  assert.doesNotMatch(rowOf(h, g[1].symbol), /As of|Time unknown/);
});

test('a mover with no quote time or a future one reads "Time unknown", never fresh', () => {
  const g0 = raw.movers.gainers[0].symbol;
  assert.match(rowOf(D.movers(feed({ t: null }), NOW), g0), /Time unknown/);
  assert.match(rowOf(D.movers(feed({ t: S + 7200 }), NOW), g0), /Time unknown/);
});

test('an open session holds a mover to the half-hour limit', () => {
  const m = feed({ t: S - 3 * 3600 });
  m.session.state = 'open';
  assert.match(rowOf(D.movers(m, NOW), m.movers.gainers[0].symbol), /As of /);
});

test('a mover with no price shows its unknown quote time and no change beside it', () => {
  const m = feed({ price: 0, t: null });
  const row = rowOf(D.movers(m, NOW), m.movers.gainers[0].symbol);
  assert.match(row, /No quote/);
  assert.match(vis(row), /Time unknown/);
  assert.doesNotMatch(vis(row), /As of|%/);
});

test('a failed gainers list reads "not reporting", not a missing section; the losers list still draws', () => {
  const m = clone(raw);
  m.movers.gainers = [];
  m.errors = [{ source: 'movers gainers', reason: 'timeout' }];
  const h = D.movers(m, NOW);
  assert.match(vis(h), /Gainers are not reporting/);
  assert.doesNotMatch(vis(h), /Losers are not reporting/);
  assert.match(h, /<span>Losers<\/span>/);
});

test('an empty gainers list with no error stays out of the page', () => {
  const m = clone(raw);
  m.movers.gainers = [];
  assert.doesNotMatch(vis(D.movers(m, NOW)), /Gainers/);
});

test('without a clock the movers draw as before (no age text, no throw)', () => {
  assert.doesNotMatch(vis(D.movers(feed({ t: S - 9 * 86400 }))), /As of|Time unknown/);
});

test('the page passes its clock to the movers', () => {
  const m = feed({ t: S - 9 * 86400 });
  const h = D.page(m, clone(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'portfolio.sample.json'), 'utf8'))), null, null, NOW, {}, null, { cls: 'P' });
  assert.match(vis(h.slice(h.indexOf('<span>Gainers</span>'))), /As of /);
});
