// node --test tests/*.test.js  (Money > Accounts, the Total strip on every size: DoMarkets 2026-11-15, #372 step 1; no DOM, no network)
// The kit shots of #372's first commit showed the Total and four kind tiles as 3 + 2 with a hole on the owner's 2470 px window and the
// laptop, an orphan Tax tile on the phone, "$10,000.00" touching its tile's edge, "No data" with no reason, and on the TV the kind tiles
// pushing the Crypto and Tax headings onto the board with no row under them. Pinned here: the kind tiles are wide-only (dx), the strip
// figure is the short money form, a missing figure says why, and css/money.css fills every row of the strip.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
assert.ok(a >= 0 && b > a);
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const css = fs.readFileSync(path.join(__dirname, '../static/css/money.css'), 'utf8');
const T = 1794790000, NOW = (T + 60) * 1000;
const app = (id, kind, o) => Object.assign({ id, name: id, kind, route: 'api', status: 'ok', last_ok: T, has_values: true }, o);
const feed = () => ({ t: T, refresh: 300, apps: [app('sf', 'bank'), app('ibkr', 'brokerage'), app('kraken', 'crypto'), app('tax', 'tax')], has_totals: true });
const rev = (totals) => ({ apps: { sf: { balance_usd: 1234567.89 }, ibkr: { balance_usd: 10000 }, kraken: { balance_usd: 10000 }, tax: { balance_usd: 500 } }, totals, exp: NOW + 30000, err: '', busy: false });
const stripOf = (h) => (h.match(/<section class="sect span-all fin-tot" aria-label="Total">(<div class="strip"[^]*?)<div class="ivctl">/) || [])[1] || '';
const tiles = (h) => [...stripOf(h).matchAll(/<div class="tile( dx)?"><span class="h">([^<]+)<\/span><b class="v">([^<]+)<\/b>(?:<span class="t">([^<]+)<\/span>)?/g)]
  .map((m) => ({ dx: !!m[1], label: m[2], value: m[3], sub: m[4] || '' }));

test('masked: the Total, Assets and Owed are the cells a phone, a tablet and the TV show; the kind tiles are wide-only (dx)', () => {
  const h = D.finPage(feed(), NOW, null);
  assert.match(stripOf(h), /^<div class="strip" data-n="7" data-nb="3" role="group" aria-label="Total">/);
  assert.deepEqual(tiles(h).map((t) => [t.label, t.dx, t.value]), [['Total, net across your apps', false, '$\u2022\u2022\u2022'], ['Assets', false, '$\u2022\u2022\u2022'], ['Owed', false, '$\u2022\u2022\u2022'],
    ['Bank', true, '$\u2022\u2022\u2022'], ['Brokerage', true, '$\u2022\u2022\u2022'], ['Crypto', true, '$\u2022\u2022\u2022'], ['Tax', true, '$\u2022\u2022\u2022']]);
});

test('shown: strip figures use the short money form; a kind the total does not count says so, never a bare "No data"', () => {
  const h = D.finPage(feed(), NOW, rev({ net_usd: 1254567.89, by_kind: { bank: 1234567.89, brokerage: 10000, crypto: 10000 } }));
  const t = tiles(h);
  assert.deepEqual(t.map((x) => x.value), ['$1.25M', 'No data', 'No data', '$1.23M', '$10K', '$10K', 'No data']);
  assert.ok(t.every((x) => x.value.length <= 8), 'a strip figure fits its tile: ' + t.map((x) => x.value).join(' '));
  assert.equal(t[6].sub, 'Not in the total');
  // the rows keep the cents
  assert.match(h, /<b>\$1,234,567\.89<\/b>/);
});

test('shown with no totals in the values view: the Total, the two sides and each kind read No data with the reason', () => {
  const t = tiles(D.finPage(feed(), NOW, rev(null)));
  const none = ['No data', 'No total in the file'], split = ['No data', 'Not split out in the file'];
  assert.deepEqual(t.map((x) => [x.value, x.sub]), [none, split, split, none, none, none, none]);
  assert.ok(t.every((x) => !/\$0\b|0\.00/.test(x.value)), 'a missing figure is never zero');
});

test('css: one column for the Total alone; from a laptop up every row of the strip is full; one row from 1600 px', () => {
  assert.match(css, /#pg-money \.fin-tot \.strip\[data-nb="1"\]\{--cols:1\}/);
  const laptop = css.slice(css.indexOf('@media (min-width:1100px) and (min-height:500px){\n  html:not(.tv) #pg-money .fin-tot'));
  const wide = css.slice(css.indexOf('@media (min-width:1600px) and (min-height:500px){\n  html:not(.tv) #pg-money .fin-tot'));
  assert.ok(laptop.length > 0 && wide.length > 0);
  // 5 tiles: three columns with the Total across two cells (2+1, then 3); 7: four with the Total across two (2+2, then 4)
  assert.match(laptop, /\.fin-tot \.strip:is\(\[data-n="5"\],\[data-n="6"\]\)\{--cols:3\}/);
  assert.match(laptop, /\.fin-tot \.strip:is\(\[data-n="7"\],\[data-n="8"\]\)\{--cols:4\}/);
  assert.match(laptop, /\.fin-tot \.strip:is\(\[data-n="5"\],\[data-n="7"\],\[data-n="9"\],\[data-n="11"\]\)>\.tile:first-child\{grid-column:span 2\}/);
  for (const n of [5, 6, 7, 8]) assert.match(wide, new RegExp('\\.fin-tot \\.strip\\[data-n="' + n + '"\\]\\{--cols:' + n + '\\}'));
  assert.match(wide, /\.fin-tot \.strip:is\(\[data-n="5"\],\[data-n="7"\]\)>\.tile:first-child\{grid-column:auto\}/);
  // the TV keeps its own strip: these rules never reach html.tv
  for (const line of css.split('\n').filter((l) => /\.fin-tot \.strip\[data-n=|\.fin-tot \.strip:is/.test(l))) assert.match(line, /html:not\(\.tv\)/, line);
});
