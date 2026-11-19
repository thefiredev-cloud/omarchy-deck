// node --test tests/*.test.js  (Money > Markets chart points: an exact zero is a feed hiccup, never a point drawn at 0)
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

const DAY = 86400;

test('a zero daily close is no point: the 1M chart never dips to 0', () => {
  const r = { symbol: 'XYZ', group: 'us', price: 103, hist: [[1 * DAY, 100], [2 * DAY, 0], [3 * DAY, 102], [4 * DAY, 103]] };
  assert.deepEqual(D.pointsFor(r, '1m').map((p) => p[1]), [100, 102, 103]);
});

test('a zero intraday bar is no point on the 1D chart', () => {
  const r = { symbol: 'XYZ', group: 'us', price: 6, intra: { prev: 5, open: null, close: null, pts: [[1, 5], [2, 0], [3, 6]] } };
  assert.deepEqual(D.pointsFor(r, '1d').map((p) => p[1]), [5, 6]);
});

test('a negative close is a real price and stays a point (WTI settled below zero on 2020-04-20)', () => {
  const r = { symbol: 'CL=F', group: 'commodity', price: -37.63, hist: [[1 * DAY, 10], [2 * DAY, -37.63]] };
  assert.deepEqual(D.pointsFor(r, '1m').map((p) => p[1]), [10, -37.63]);
});
