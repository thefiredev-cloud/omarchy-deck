// node --test tests/*.test.js  (Money > Markets, Trending tickers: a zero price is no quote, and a feed with no usable time says "Time unknown", never a fresh look)
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
const row = (patch) => Object.assign({ symbol: 'ZZZZ', price: 4.2, pct: -3.1, t: S - 60, volume_ratio: 12, reason: 'Most active' }, patch);
const feed = (rows, patch) => Object.assign({ t: S - 600, feeds: [], tickers: rows }, patch);
const rowOf = (html, label) => { const i = html.indexOf('<b>' + label); assert.ok(i >= 0, label); return html.slice(i, html.indexOf('</div>', i) + 6); };

test('a trending row with a price of exactly 0 reads "No quote" with no $0.00 and no orphan change', () => {
  const h = D.trendingTickers(feed([row({ price: 0 })]), NOW, null, {});
  const r = vis(rowOf(h, 'ZZZZ'));
  assert.match(r, /No quote/);
  assert.doesNotMatch(r, /\$0\.00/);
  assert.doesNotMatch(r, /3\.10%/);
});

test('a trending row with a real price still prints it with its change', () => {
  const r = vis(rowOf(D.trendingTickers(feed([row({})]), NOW, null, {}), 'ZZZZ'));
  assert.match(r, /\$4\.20/);
  assert.match(r, /\u22123\.10%/);
});
test('each stale trending quote names its own age, not only the feed age', () => {
  const h = D.trendingTickers(feed([row({ t: S - 9 * 86400 })]), NOW, null, {});
  assert.match(vis(rowOf(h, 'ZZZZ')), /As of /);
});

test('a trending quote without a usable timestamp says "Time unknown" on its own row', () => {
  for (const t of [undefined, S + 7200, 0]) {
    const h = D.trendingTickers(feed([row({ t })]), NOW, null, {});
    assert.match(vis(rowOf(h, 'ZZZZ')), /Time unknown/, 't=' + t);
  }
});

test('a trending feed with no time says "Time unknown" in its heading, never a blank or a fresh age', () => {
  const h = D.trendingTickers({ feeds: [], tickers: [row({})] }, NOW, null, {});
  assert.match(vis(h.slice(0, h.indexOf('</h2>'))), /Time unknown/);
});

test('a trending feed stamped in the future or at zero says "Time unknown", never "just now" or decades', () => {
  for (const t of [S + 7200, 0, -5]) {
    const h = D.trendingTickers(feed([row({})], { t }), NOW, null, {});
    const head = vis(h.slice(0, h.indexOf('</h2>')));
    assert.match(head, /Time unknown/, 't=' + t);
    assert.doesNotMatch(head, /just now|\d+ d ago/, 't=' + t);
  }
});

test('a trending feed a few seconds ahead of the clock (skew) is still just now', () => {
  const h = D.trendingTickers(feed([row({})], { t: S + 30 }), NOW, null, {});
  assert.match(vis(h.slice(0, h.indexOf('</h2>'))), /just now/);
});

test('a stale trending feed keeps its Out of date mark with its age', () => {
  const h = D.trendingTickers(feed([row({})], { stale: true, t: S - 7200 }), NOW, null, {});
  assert.match(vis(h.slice(0, h.indexOf('</h2>'))), /Out of date · 2 h ago/);
});
