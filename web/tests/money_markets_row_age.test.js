// node --test tests/*.test.js  (Money > Markets: an old, untimed or future-dated quote says so on its own tile or row; a fresh one prints no age)
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
const NOW = (raw.t + 120) * 1000;
const S = NOW / 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// the markets feed with one board row changed
const feed = (boardId, boardPatch) => {
  const m = clone(raw);
  Object.assign(m.board.find((r) => r.id === boardId), boardPatch);
  return m;
};
const rowOf = (html, label) => { const i = html.indexOf('<b>' + label); assert.ok(i >= 0, label); return html.slice(i, html.indexOf('</div>', i) + 6); };

test('a fresh feed prints no age on any tile or board row', () => {
  const m = clone(raw);
  const o = { now: NOW };
  assert.doesNotMatch(vis(D.board(m, 'lead', null, o)), /As of|Time unknown/);
  assert.doesNotMatch(vis(D.board(m, 'groups', null, o)), /As of|Time unknown/);
});

test('a lead tile whose quote is older than its session allows says "As of" with the date, beside its change', () => {
  const old = S - 9 * 86400;
  const m = feed('spy', { t: old });
  const h = D.board(m, 'lead', null, { now: NOW });
  assert.match(h, /<span class="sd warn"><\/span> As of /);
  assert.match(vis(h), /S&P 500 \$774\.83 \+0\.67% As of /);
});

test('a lead tile with no quote time reads "Time unknown", never fresh', () => {
  const h = D.board(feed('spy', { t: null }), 'lead', null, { now: NOW });
  assert.match(vis(h), /Time unknown/);
});

test('a future-dated quote reads "Time unknown" on its tile', () => {
  const m = feed('qqq', { t: S + 7200 });
  assert.match(vis(D.board(m, 'lead', null, { now: NOW })), /Time unknown/);
});

test('a stale group row (crypto holds the open-session limit all day) says "As of"; a closed-session equity close stays clean', () => {
  const eth = raw.board.find((r) => r.id === 'eth');
  assert.ok(eth, 'fixture has ETH in the groups');
  const m = feed('eth', { t: S - 3 * 3600 });
  assert.match(rowOf(D.board(m, 'groups', null, { now: NOW }), eth.label), /As of /);
  assert.doesNotMatch(vis(D.board(clone(raw), 'groups', null, { now: NOW })), /As of/);
});

test('a row with no price shows its unknown quote time', () => {
  const m = feed('spy', { price: null, chg: null, pct: null, t: null });
  const h = D.board(m, 'lead', null, { now: NOW });
  assert.match(h, /<span class="na">No quote<\/span>/);
  assert.match(vis(h), /Time unknown/);
});

test('without a clock the board draws as before (no age text, no throw)', () => {
  const m = feed('spy', { t: S - 9 * 86400 });
  assert.doesNotMatch(vis(D.board(m, 'lead')), /As of|Time unknown/);
});

test('with no session in the markets feed the open-session age limit still applies: a 2 h old lead tile says "As of"', () => {
  const m = feed('spy', { t: S - 7200 });
  delete m.session;
  assert.match(vis(D.board(m, 'lead', null, { now: NOW })), /S&P 500 \$774\.83 \+0\.67% As of /);
});

test('with no session in the markets feed a 2 h old quote makes the page status stale', () => {
  const m = feed('spy', { t: S - 7200 });
  delete m.session;
  assert.equal(D.status(m, null, null, NOW).stale, true);
});
