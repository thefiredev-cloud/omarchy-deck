// node --test tests/*.test.js  (Shop > Market layout wave, 2026-11-15: the audit by eye at phone landscape and tablet; round Better M3)
// Trending answers the page and leads it (2026-11-17, in the place the watches had): on P and T the full row with the compact strip
// under it, on L beside the compact strip, on D and XL the strip first and then Trending, movers and categories as one 4/4/4 row.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
const css = fs.readFileSync(path.join(__dirname, '../static/css/shop.css'), 'utf8');
const fx = require('./shop_fixture.cjs');
const NOW = (fx().market.t + 600) * 1000;
const TR = require('./trends_fixture.cjs');
const page = (cls, o) => { const f = fx(); return S.marketBody(Object.assign({ m: f.market, e: f.ecom, l: f.listings, tr: TR.trends(), now: NOW, cls, view: {} }, o)); };
const sectClass = (h, s) => (new RegExp('class="sect ([^"]*\\b' + s + ')"').exec(h) || [])[1];

test('off TV: Trending leads; P and T full row, L beside the compact strip, D and XL a 4/4/4 row of Trending, movers, categories', () => {
  for (const cls of ['P', 'T']) {
    const h = page(cls);
    assert.equal(sectClass(h, 's-trending'), 'c-12 s-trending', cls);
    assert.ok(h.indexOf('s-trending') < h.indexOf('shop-strip'), cls + ': Trending before the strip');
    assert.match(h, /<div class="g12 shop-two"><section class="sect c-6 s-move"[^]*<section class="sect c-6 s-cat"/, cls);
  }
  const l = page('L');
  assert.match(l, /<div class="g12 shop-top"><section class="sect c-6 s-trending"[^]*?<\/section><div class="c-6 sstack shop-side"><div class="shop-strip">/);
  assert.match(l, /<div class="g12 shop-two"><section class="sect c-6 s-move"[^]*<section class="sect c-6 s-cat"/);
  for (const cls of ['D', 'XL']) {
    const h = page(cls);
    assert.ok(h.indexOf('shop-strip') < h.indexOf('s-trending'), cls + ': the strip opens the desk');
    assert.match(h, /<div class="g12 shop-top"><section class="sect c-4 s-trending"[^]*<section class="sect c-4 s-move"[^]*<section class="sect c-4 s-cat"/, cls);
    assert.doesNotMatch(h, /shop-two/, cls);
    const mv = h.slice(h.indexOf('s-move'), h.indexOf('</section>', h.indexOf('s-move')));
    assert.equal((mv.match(/class="frow prow/g) || []).length, 4, cls + ': movers open at four beside Trending');
    assert.match(mv, /data-more="product"/, cls);
  }
  for (const cls of ['P', 'L', 'T', 'D', 'XL']) {
    const h = page(cls);
    assert.ok(h.indexOf('s-trending') < h.indexOf('s-move') && h.indexOf('s-move') < h.indexOf('s-cat'), cls);
    assert.doesNotMatch(h, /class="card wcard"|Your watches/, cls + ': no watch cards');
  }
});

test('P and L are phones: platforms are compact rows with Show more; T and D keep the table; TV keeps its board', () => {
  for (const cls of ['P', 'L']) {
    const sec = page(cls).split('s-plat')[1].split('</section>')[0];
    assert.match(sec, /class="flist prank"/, cls);
    assert.doesNotMatch(sec, /<table/, cls);
  }
  for (const cls of ['T', 'D']) assert.match(page(cls).split('s-plat')[1].split('</section>')[0], /<table/, cls);
  // off TV the table opens at 24 rows beside the lists; Show more reaches the rest
  const all = S.platformRows(fx().market, 'all', 30).length, rowsOf = (h) => (h.split('s-plat')[1].split('</section>')[0].match(/<tr tabindex/g) || []).length;
  assert.equal(rowsOf(page('D')), Math.min(24, all));
  assert.equal(rowsOf(page('XL')), Math.min(20, all), 'XL lists are wider and shorter, so the table opens at 20');
  assert.equal(rowsOf(page('XL', { view: { plat: 30 } })), all);
  if (all > 24) assert.match(page('D').split('s-plat')[1].split('</section>')[0], /data-more="plat"/);
  assert.equal(rowsOf(page('D', { view: { plat: 30 } })), all);
  const tv = page('TV', { tv: true });
  assert.match(tv, /^<div class="board">[^]*class="sect c-6 s-trending"[^]*class="sect c-6 s-move"/);
  assert.equal(rowsOf(tv), all, 'the TV draws every platform, as before');
  assert.doesNotMatch(tv, /shop-two|s-lst/);
});

test('L: Listings comes first in the stack so the two flowed columns pair Platforms and Listings beside Amazon and Deals', () => {
  const order = (h) => ['s-az', 's-deal', 's-lst'].map((k) => [k, h.indexOf('class="sect ' + k + '"')]).filter((x) => x[1] > 0).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  assert.deepEqual(order(page('L')).filter((k) => k !== 's-az'), ['s-lst', 's-deal']);
  for (const cls of ['P', 'T', 'D']) assert.deepEqual(order(page(cls)).filter((k) => k !== 's-az'), ['s-deal', 's-lst'], cls);
});

test('the stylesheet: L flows the platforms and lists in two columns, T gives the lists the full row, odd cards fill their row', () => {
  assert.match(css, /@media \(min-width:600px\) and \(max-height:499px\)\{[^}]*\.shop-mid\{display:block;columns:2[^]*\.shop-mid>\.sstack\{display:contents\}[^]*break-inside:avoid/);
  assert.match(css, /\(min-height:500px\)\{#pg-shop \.g12\.shop-mid>\.sstack\{grid-column:span 12\}\}/);
  assert.match(css, /html:not\(\.tv\) \.ccards\{display:flex;flex-wrap:wrap\}/);
  assert.match(css, /\.s-move \.mchips\{[^}]*flex-wrap:wrap/);
});

test('strip: a tile line breaks only between its parts, never inside a date or a change; units ride in the label', () => {
  const h = page('XL');
  const strip = h.slice(h.indexOf('shop-strip'), h.indexOf('shop-top'));
  const subs = [...strip.matchAll(/<span class="t">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.ok(subs.length >= 6);
  for (const s of subs) for (const part of s.split(' · ')) assert.doesNotMatch(part, / /, 'a plain space inside "' + part + '"');
  assert.ok(subs.some((s) => /Q2\u00a02026/.test(s)), 'the quarter and its year stay together');
  // the compact strip: a unit joins its label, so no figure drops its unit onto its own line in a narrow cell
  assert.match(strip, /<span class="h">Shipping, per 40 ft box<\/span><b class="v">\$[\d,]+<\/b>/);
  assert.doesNotMatch(strip, /class="u"/);
  // the TV board keeps its unit beside its figure
  assert.match(page('TV', { tv: true }), /<span class="h">Shipping<\/span><b class="v">\$[\d,]+<span class="u">per 40 ft box<\/span>/);
  // three a row on a phone, six on T, the eight in one row on D and XL, at the title step; never on the TV
  assert.match(css, /html:not\(\.tv\) #pg-shop \.shop-strip \.strip\{--cols:3\}/);
  assert.match(css, /\(min-width:1100px\) and \(min-height:500px\)\{html:not\(\.tv\) #pg-shop \.shop-strip \.strip\[data-n="8"\]\{--cols:8\}\}/);
  assert.match(css, /html:not\(\.tv\) #pg-shop \.shop-strip \.strip>\.tile \.v\{font-size:var\(--fs-title\)\}/);
  assert.match(css, /#pg-shop \.shop-strip \.tile \.v \.u\{white-space:nowrap\}/);
});

test('an Amazon title the route cut at 140 characters ends at a word with an ellipsis; a shorter one stays whole', () => {
  const long = 'Pit Boss 700 Carbon Series Wood Pellet Grill & Smoker with LCD Digital Controller, 718-Sq. in. Cooking Space, 180°F to 500°F Temperature Ran';
  assert.equal(Array.from(long).length, 140);
  const a = { t: 1, watch: [], deals: [{ title: long, price: 383, url: 'https://www.amazon.com/dp/X', query: 'pellet grill' }, { title: 'Traeger Pro 22', price: 389, url: 'https://www.amazon.com/dp/Y', query: 'pellet grill' }] };
  const [cut, whole] = S.amazonDeals(a, NOW);
  assert.equal(cut.title, 'Pit Boss 700 Carbon Series Wood Pellet Grill & Smoker with LCD Digital Controller, 718-Sq. in. Cooking Space, 180°F to 500°F Temperature\u2026');
  assert.equal(whole.title, 'Traeger Pro 22');
});

test('phones (P and L): deal and mover rows put the price under the title; category dates stay whole', () => {
  assert.match(css, /@media \(max-width:599px\),\(min-width:600px\) and \(max-height:499px\)\{[^}]*#pg-shop \.drow,#pg-shop \.prow\{flex-wrap:wrap/);
  assert.match(css, /#pg-shop \.drow \.fr,#pg-shop \.prow \.fr\{order:3;flex:1 1 100%/);
  const h = page('P');
  const whens = [...h.matchAll(/class="card ccard"[^]*?<span class="note sm">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.ok(whens.length > 0);
  for (const w of whens) for (const part of w.split(' · ')) assert.doesNotMatch(part, / /, part);
});

test('market feed down: the failed state leads and the answering sections follow, with a section gap under it', () => {
  const f = fx();
  for (const cls of ['P', 'L', 'D']) {
    const h = S.marketBody({ m: null, e: f.ecom, l: f.listings, tr: TR.trends(), now: NOW, cls, view: {} });
    assert.match(h, /^<div class="es es-bad" role="status">[^]*?Market prices are not reporting\.[^]*?data-retry="shop">Try again<\/button><\/div><div class="g12 shop-top">/, cls);
    assert.match(h, /<section class="sect s-deal"/, cls + ': Deals and resale stays under the failed state');
  }
  assert.match(css, /#pg-shop \.sub>\.es:not\(:last-child\)\{margin-bottom:var\(--gap\)\}/);
});
