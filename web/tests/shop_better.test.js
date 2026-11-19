// node --test tests/*.test.js  (Shop > Market, round Better, lane DoShop 2026-11-15)
// The watch sheet names the best price (G5): a used or refurbished price said in words, a watch with no listing says why; a 1-day
// change when the feed carries `change_1d` (B3); no up mark on a change that rounds to zero (V6); and what the 2026-11-04 sweep built
// and lost (L07 Sells locally, L08 listing events with an Out of date mark, L09 the macro takeaway). The watch cards left the page on
// 2026-11-17 (Trending leads it now); their sheet stays, opened from Sells locally. Every field is drawn only when the feed sends it.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
const fx = require('./shop_fixture.cjs');
const T = fx().market.t, NOW = (T + 600) * 1000;
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const page = (f, o) => S.marketBody(Object.assign({ m: f.market, e: f.ecom, l: f.listings, now: NOW, cls: 'P', view: {} }, o));
const TR = require('./trends_fixture.cjs');
const watch = (f, slug) => f.market.watches.items.find((w) => w.slug === slug);

// the market feed after DoEcomData #345: `best` is new only with its title and link; `best_used` and `best_reason` otherwise
function better() {
  const f = fx();
  Object.assign(watch(f, 'rtx-4080'), { best: null, best_used: { price: 801.5, platform: 'Newegg', condition: 'refurbished', title: 'Sample RTX 4080 16GB card', url: 'https://www.newegg.com/p/sample-4080' }, best_reason: 'no new listing passed the price checks; the lowest is refurbished' });
  Object.assign(watch(f, 'pellet-grill'), { best: { price: 251.25, platform: 'Amazon', condition: 'new', title: 'Sample Wood Pellet Grill and Smoker with Foldable Legs, 456 square inches of grilling space, PID control, portable folding design', url: 'https://www.amazon.com/dp/SAMPLE1' }, best_used: null, best_reason: null, change_1d: 1.2 });
  Object.assign(watch(f, 'portable-water-purifier-bottle'), { best: null, best_used: null, best_reason: 'no listing passed the price checks' });
  return f;
}

test('G5: a used or refurbished best says so in words; a watch with no listing names the feed\'s reason', () => {
  const f = better();
  // the sheet says the used price under its own label and the reason as a note
  const s = S.watchSheetModel(watch(f, 'rtx-4080'), f.ecom.watch.find((x) => x.slug === 'rtx-4080'), f.ecom, f.listings);
  const sh = S.watchSheetHtml(s, null, NOW);
  assert.match(sh, /<dt>Best price, refurbished<\/dt><dd>\$801\.50<\/dd>|<dt>Best price, refurbished<\/dt><dd>\$802<\/dd>/);
  assert.match(sh, /Sample RTX 4080 16GB card<\/b><small>Newegg · refurbished<\/small>/);
  const sn = S.watchSheetHtml(S.watchSheetModel(watch(f, 'portable-water-purifier-bottle'), null, f.ecom, f.listings), null, NOW);
  assert.match(sn, /<p class="note sm">No listing passed the price checks\.<\/p>/);
});

test('Sells locally: each row opens its watch sheet', () => {
  const f = better(), h = page(f, { cls: 'D' }), sec = h.slice(h.indexOf('s-local'), h.indexOf('</section>', h.indexOf('s-local')));
  assert.match(sec, /<tr tabindex="0" data-open="watch" data-key="rtx-4080">/);
});

test('B3: a 1-day change shows beside the 7-day one in the sheet only when the feed carries change_1d', () => {
  const f = better();
  const s = S.watchSheetHtml(S.watchSheetModel(watch(f, 'pellet-grill'), null, f.ecom, f.listings), null, NOW);
  assert.match(s, /<dt>1 day<\/dt><dd><span class="delta up">\+1\.2%<\/span><\/dd><\/div><div><dt>7 days<\/dt>/);
  assert.doesNotMatch(S.watchSheetHtml(S.watchSheetModel(watch(f, 'smart-home-hub'), null, f.ecom, f.listings), null, NOW), /<dt>1 day/);
});

test('V6: a change that prints as zero carries the flat mark, never an up or down mark', () => {
  const f = fx();
  f.market.categories.find((c) => c.key === 'computers').value = 0.03;
  watch(f, 'smart-home-hub').change_7d = -0.04;
  const h = page(f, { cls: 'D' });
  const cc = h.slice(h.indexOf('data-key="computers"'), h.indexOf('</div>', h.indexOf('data-key="computers"')));
  assert.match(cc, /<span class="delta flat">0\.0%<\/span>/);
  assert.doesNotMatch(h, /class="card wcard"/, 'no watch cards on the page');
  assert.match(h, /<span class="delta up">\+/, 'a real rise keeps its up mark');
});

test('L07: Sells locally says what each watched item asks locally against new, after the movers', () => {
  const f = better();
  f.ecom.resale.find((r) => r.slug === 'rtx-4080').retail_median = 1700;
  f.ecom.resale.find((r) => r.slug === 'rtx-4080').vs_retail = -0.2941;
  assert.match(page(f, { cls: 'D' }), /71%<small>new \$1,700<\/small>/);
  for (const cls of ['P', 'T', 'D', 'XL']) {
    const h = page(f, { cls });
    assert.ok(h.indexOf('s-move') < h.indexOf('s-local') && h.indexOf('s-local') < h.indexOf('s-plat'), cls + ': after the movers');
  }
  // L: under the compact strip beside Trending, so the first row's two halves end together
  assert.match(page(f, { cls: 'L' }), /<section class="sect c-6 s-trending"[^]*?<\/section><div class="c-6 sstack shop-side"><div class="shop-strip">[^]*<section class="sect s-local">/);
  const h = page(f, { cls: 'D' }), sec = h.slice(h.indexOf('s-local'), h.indexOf('</section>', h.indexOf('s-local')));
  assert.match(vis(sec), /^s-local"> Sells locally Asking prices near Dana Point, CA, against the same item new\./);
  assert.match(sec, /<th scope="row" data-l="Item"><span class="place"><b>RTX 4080<\/b><small>Yours · 11 listings · \d+ min ago<\/small><\/span><\/th><td class="n" data-l="Asks locally">\$1,200<\/td><td class="n" data-l="Of new">71%<small>new \$1,700<\/small><\/td>/);
  // no platform names on the page: they live in the watch sheet
  assert.doesNotMatch(sec, /OfferUp|Craigslist|Facebook/);
  // a stale row says Out of date with its mark; an older /api/ecom without resale draws no section and no card line
  f.ecom.resale[0].stale = true;
  assert.match(page(f, { cls: 'D' }), /<small><span class="sd warn"><\/span>Yours · 11 listings · Out of date, \d+ min ago<\/small>/);
  const g = better();
  delete g.ecom.resale;
  assert.doesNotMatch(page(g, { cls: 'D' }), /s-local|wc-loc/);
});

// /api/ecom listing events (made up): two drops, one under median, one new low, one watch-level trend
function events(f, stale) {
  f.ecom.movers = [
    { slug: 'rtx-4080', kind: 'drop', chg7: -0.2, site: 'offerup', title: 'Sample 4080 drop', price: 800, ref: 1000, url: 'https://offerup.com/item/detail/s1', condition: 'used', t: T },
    { slug: 'pellet-grill', kind: 'drop', chg7: -0.1, site: 'walmart', title: 'Sample grill drop', price: 270, ref: 300, url: 'https://www.walmart.com/ip/s2', condition: 'new', t: T },
    { slug: 'rtx-4080', kind: 'under_median', chg7: -0.3, site: 'facebook-marketplace', title: 'Sample 4080 under', price: 840, ref: 1200, url: 'https://www.facebook.com/marketplace/item/s3/', condition: null, t: T },
    { slug: 'smart-home-hub', kind: 'new_low', chg7: -0.05, site: 'walmart', title: 'Sample hub low', price: 57, ref: 60, url: 'https://www.walmart.com/ip/s4', condition: 'new', t: T },
    { slug: 'rtx-4080', query: 'rtx 4080', kind: 'trend', chg7: -0.14, dir: 'down', t: T }];
  f.ecom.movers_info = { computed_at: T - 60, data_through: T - 120, stale: !!stale, window_days: 7, watches: 4, listings_checked: 120 };
  f.ecom.refresh = 3600;
  return f;
}

test('L08: listing events join Best sellers and movers as kinds, ahead of the store movers; the watch trend is not repeated', () => {
  const f = events(better()), h = page(f), sec = h.slice(h.indexOf('s-move'), h.indexOf('</section>', h.indexOf('s-move')));
  const rows = [...sec.matchAll(/<(a|button)[^>]* class="frow prow[^>]*>([^]*?)<\/(a|button)>/g)].map((m) => vis(m[2]));
  assert.match(rows[0], /^Sample 4080 drop Price drop · OfferUp · used · Computers \$800 −20\.0% from \$1,000$/);
  assert.match(rows[1], /^Sample grill drop Price drop · Walmart · Outdoors \$270 −10\.0% from \$300$/);
  assert.match(rows[2], /^Sample 4080 under Under median · Facebook Marketplace · Computers \$840 −30\.0% vs median \$1,200$/);
  assert.match(rows[3], /^Sample hub low New low · Walmart · Home \$57\.00 −5\.0% vs last low \$60\.00$/);
  assert.ok(rows.length > 4, 'the store movers follow');
  assert.doesNotMatch(sec, /Median moved|Sample 4080 trend/);
  // each event is the listing itself, opened in a new tab
  assert.match(sec, /<a class="frow prow pev" data-key="[^"]*" href="https:\/\/offerup\.com\/item\/detail\/s1" target="_blank" rel="noopener noreferrer">/);
  // the kind chips and the category chips filter them like any mover
  assert.deepEqual(S.eventList(f.ecom, f.market, 'all', 'new_low', NOW).map((r) => r.title), ['Sample hub low']);
  assert.deepEqual(S.eventList(f.ecom, f.market, 'outdoors', 'all', NOW).map((r) => r.title), ['Sample grill drop']);
  assert.deepEqual(S.eventList(f.ecom, f.market, 'all', 'bestseller', NOW), []);
  assert.match(h, /data-mover="new_low"/);
});

test('L08: events from prices that stopped coming in say Out of date with the warn mark; no computed-at line on the page', () => {
  const f = events(better(), true), sec = (h) => h.slice(h.indexOf('s-move'), h.indexOf('</section>', h.indexOf('s-move')));
  const h = sec(page(f));
  assert.equal((h.match(/class="frow prow pev stl"/g) || []).length, 4);
  assert.match(h, /<small><span class="sd warn"><\/span>Out of date · Price drop · OfferUp/);
  // fresh flag but prices older than twice the refresh: stale too
  const g = events(better(), false);
  g.ecom.movers_info.data_through = T - 3 * 3600;
  assert.match(sec(page(g)), /Out of date · Price drop/);
  const ok = sec(page(events(better(), false)));
  assert.doesNotMatch(ok + page(events(better(), false)), /Out of date|Computed /);
  // the Data sheet carries when they were computed and from prices through when
  const src = S.dataModel(f.market, '', [], null, f.ecom, NOW).sources.find((s) => s.name === 'Listing moves');
  assert.match(src.gives, /^Computed \w{3} \d+ \d+:\d\d [ap]m from prices through \w{3} \d+ \d+:\d\d [ap]m · 120 listings checked$/);
  assert.equal(src.state, 'stale');
  // an older /api/ecom without movers_info draws no events at all (its movers were watch medians)
  const old = events(better());
  delete old.ecom.movers_info;
  assert.deepEqual(S.eventList(old.ecom, old.market, 'all', 'all', NOW), []);
});

test('L09: one plain takeaway sentence sits above the compact strip, from the online sales series; never two', () => {
  const f = better();
  f.ecom.macro = [
    { key: 'electronics_stores', takeaway: 'Electronics store sales are up 8.4% on a year ago (Aug 2026). Nov runs 13% above the yearly average: buyers are out, a good month to list.' },
    { key: 'nonstore_retail', takeaway: 'Online sales are up 8.6% on a year ago (Aug 2026). Nov runs 16% above the yearly average: buyers are out, a good month to list.' }];
  assert.equal(S.takeaway(f.ecom), 'November runs 16% above the yearly average: buyers are out, a good month to list.');
  for (const cls of ['P', 'L', 'T', 'D', 'XL']) {
    const h = page(f, { cls }), at = h.indexOf('<p class="shop-take">');
    assert.ok(at > 0 && at < h.indexOf('<div class="strip"', at), cls + ': above the strip');
    assert.equal((h.match(/class="shop-take"/g) || []).length, 1, cls + ': once');
  }
  delete f.ecom.macro;
  assert.doesNotMatch(page(f), /shop-take/);
});

test('M3: on a phone Trending comes before the economy; the strip is compact under it', () => {
  const f = better(), h = page(f, { cls: 'P', tr: TR.trends() });
  assert.ok(h.indexOf('Trending') < h.indexOf('shop-strip'));
  assert.ok(h.indexOf('shop-strip') < h.indexOf('Best sellers and movers'));
});

test('links: a feed URL that is not http(s) never becomes a link; the title stays as plain text', () => {
  const f = events(better());
  Object.assign(watch(f, 'pellet-grill').best, { url: 'javascript:alert(1)' });
  f.ecom.movers[0].url = 'javascript:alert(2)';
  // a trending row whose link is not http(s) prints its title as plain text
  const tr = TR.trends();
  tr.products[0].url = 'javascript:alert(3)';
  assert.doesNotMatch(page(f, { tr }), /javascript:/);
  const h = page(f);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /<div class="frow prow pev" data-key="[^"]*"><span class="fl"><b class="ptitle-t">Sample 4080 drop<\/b>/);
  // the exported row renderer is safe on its own, whatever model it is handed
  assert.doesNotMatch(S.trendRow({ key: 'x', title: 'X', url: 'javascript:x' }), /javascript:|<a /);
});
