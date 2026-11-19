// node --test tests/*.test.js  (Money > Markets: revealed amounts for a position that has no live quote). No DOM, no network.
// What it proves: after Show amounts a position with no usable price keeps no value, no dollar change and no dangling "qty x" line;
// the dollar totals say how many positions were priced, so a partial total never reads as the whole portfolio.
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
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const rawM = fx('markets.sample.json'), rawP = fx('portfolio.sample.json'), rawV = fx('portfolio-values.sample.json');
const NOW = (rawM.t + 120) * 1000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const vis = (h) => h.replace(/<span class="vh">[^<]*<\/span>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const row = (h, sym) => (h.match(new RegExp('<div class="frow"><span class="fl"><b>' + sym + '</b>[^]*?</span></div>')) || [''])[0];
const revealed = () => ({ vals: { totals: clone(rawV.totals), positions: clone(rawV.positions), stale: false }, exp: NOW + 30000, err: '', busy: false });

function unpricedAAA() {
  const p = clone(rawP);
  const a = p.positions.find((x) => x.symbol === 'AAA');
  a.price = null; a.chg = null; a.pct = null; a.t = null;
  p.totals.priced = p.totals.positions - 1;
  return p;
}

test('revealed: a position with no quote shows no value and no dollar change, and no dangling "x"', () => {
  const h = D.portfolio(unpricedAAA(), revealed(), NOW, rawM);
  const aaa = row(h, 'AAA');
  assert.ok(aaa, 'AAA row renders');
  assert.match(vis(aaa), /No quote/);
  assert.doesNotMatch(vis(aaa), /\u00D7|= \$|\$100,000/);
  assert.doesNotMatch(aaa, /iv-usd|\u2212\$1,000/, 'the stored day change belongs to a price the page does not have');
  assert.match(vis(aaa), /1,000 held/, 'the held quantity stays, named as a quantity');
});

test('revealed: a priced position keeps quantity x price = value and its dollar change', () => {
  const h = D.portfolio(unpricedAAA(), revealed(), NOW, rawM);
  assert.match(vis(row(h, 'BBB')), /2,001 \u00D7 \$50\.50 = \$101,025/);
  assert.match(row(h, 'BBB'), /iv-usd/);
});

test('revealed: the dollar change tile says how many positions were priced when some are not', () => {
  const partial = D.portfolio(unpricedAAA(), revealed(), NOW, rawM);
  assert.match(partial, /<span class="h">Day change, dollars<\/span><b class="v">[^<]*<\/b><span class="t">\d+ of \d+ priced<\/span>/);
  const whole = D.portfolio(clone(rawP), revealed(), NOW, rawM);
  assert.doesNotMatch(whole, /<span class="h">Day change, dollars<\/span><b class="v">[^<]*<\/b><span class="t">/);
});

test('revealed: a null net estimate (a held position has no price) prints no "Net about", a real one prints it', () => {
  const unknown = revealed();
  unknown.vals.totals.net_est_usd = null;
  assert.doesNotMatch(vis(D.portfolio(unpricedAAA(), unknown, NOW, rawM)), /Net about/);
  assert.match(vis(D.portfolio(clone(rawP), revealed(), NOW, rawM)), /Net about \$777,777/);
});

test('before Show amounts: an unpriced position still carries no quantity or dollar text', () => {
  const h = D.portfolio(unpricedAAA(), null, NOW, rawM);
  assert.doesNotMatch(vis(h), /1,000 held|\u00D7|\$100,000|424,242/);
});
