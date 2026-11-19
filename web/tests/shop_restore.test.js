// node --test tests/*.test.js  (Shop: what the redesign dropped comes back, RestoreShop 2026-11-15)
// The public marketplace listings (GET /api/listings) in each watch sheet and as one Listings section on Market with Show more;
// the watch sheet's resale facts (flip, sold, asking, new and used) and near-duplicate groups from /api/ecom watch[].
// The listings fixture follows the route's own shape (listings[] with query, groups[] with items, groups_total).
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
const fx = require('./shop_fixture.cjs');
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const NOW_S = fx().market.t + 600, NOW = NOW_S * 1000;

const L = (src, n, q, o) => Object.assign({ source: src, title: 'RTX 4080 card ' + n, price: 700 + n, currency: 'USD', url: 'https://offerup.com/item/detail/' + n,
  posted_at: null, query: q || 'rtx 4080', first_seen: NOW_S - 7200, last_seen: NOW_S - 600, seen_this_run: true }, o);
// 14 rtx 4080 listings (two of them one item on two sites), 2 pellet grill, 1 for a search no watch has
function listings() {
  const xs = [];
  for (let i = 1; i <= 14; i++) xs.push(L(i % 2 ? 'offerup' : 'facebook-marketplace', i));
  xs[0].posted_at = NOW_S - 3 * 86400;
  xs[1].price = null; // a "wanted" post
  xs[2].url = 'javascript:alert(1)';
  xs[3].title = 'GPU <img src=x onerror=1>';
  xs[4].seen_this_run = false;
  xs.push(L('walmart', 20, 'pellet grill', { title: 'Pellet grill A' }), L('craigslist', 21, 'pellet grill', { title: 'Pellet grill B', currency: 'CAD' }));
  xs.push(L('ebay', 30, 'rtx 9090', { title: 'Orphan' }));
  const g = { title: 'RTX 4080 card 6', price: 706, url: xs[5].url, source: 'facebook-marketplace', count: 3, best_price: 706, max_price: 707,
    sites: ['facebook-marketplace', 'offerup'], items: [xs[5], xs[6]].map((x) => Object.assign({}, x)), items_omitted: 1 };
  return { t: NOW_S - 600, refresh: 3600, query: 'rtx 4080', listings: xs, groups: [g, Object.assign({}, xs[7], { count: 1, items: [xs[7]] })], groups_total: 16 };
}
const sheet = (l, slug, oldPatch) => {
  const f = fx(), w = f.market.watches.items.find((x) => x.slug === (slug || 'rtx-4080'));
  const old = Object.assign({}, f.ecom.watch.find((x) => x.slug === (slug || 'rtx-4080')), oldPatch);
  const s = S.watchSheetModel(w, old, f.ecom, l);
  return { s, h: S.watchSheetHtml(s, null, NOW) };
};
const page = (l, o) => { const f = fx(); return S.marketBody(Object.assign({ m: f.market, e: f.ecom, l, now: NOW, cls: 'D', view: {} }, o)); };
const sectOf = (h, cls) => { const i = h.indexOf('class="sect ' + cls + '"'); return i < 0 ? '' : h.slice(i, h.indexOf('</section>', h.indexOf('</h2>', i)) + 10); };

test('listings: every listing once; a group of two or more folds into one row; counts match the feed', () => {
  const l = listings(), rows = S.listingRows(l, fx().ecom);
  // 17 listings, two of them inside the group of three: 16 rows, the feed's own groups_total
  assert.equal(rows.length, l.groups_total);
  const g = rows.find((r) => r.count > 1);
  assert.equal(g.count, 3);
  assert.equal(g.items.length, 2);
  assert.equal(g.left, 1, 'a member the feed did not send is counted, not invented');
  assert.deepEqual(g.sites, ['Facebook Marketplace', 'OfferUp']);
  assert.equal(rows.filter((r) => r.title === 'RTX 4080 card 7').length, 0, 'a group member is not a row of its own as well');
  // the sites take turns, each in the feed's order, so the first rows are not one site's whole search
  assert.deepEqual(rows.slice(0, 4).map((r) => r.site), ['OfferUp', 'Facebook Marketplace', 'Walmart', 'eBay']);
  // the "wanted" post without a price goes last; another currency never prints as dollars
  assert.equal(rows[rows.length - 1].price, null);
  assert.equal(rows.find((r) => r.title === 'Pellet grill B').price, null);
});

test('Market: one Listings section, 6 rows then Show more, links safe in a new tab, markup escaped', () => {
  const h = page(listings()), sec = sectOf(h, 's-lst');
  assert.match(sec, /<span>Listings<\/span>/);
  assert.match(vis(sec), /18 listings, 16 after duplicates/, 'the group of three counts all three, the one the feed did not send too');
  const top = sec.replace(/<div class="flist lgi">[^]*?<\/div><\/details>/g, '</details>');
  assert.equal((top.match(/class="frow lrow-l"|class="lgrp"/g) || []).length, 6);
  assert.match(sec, /data-more="lst">Show 10 more</);
  const all = sectOf(page(listings(), { view: { lst: 18 } }), 's-lst');
  assert.doesNotMatch(all, /data-more="lst"/);
  assert.doesNotMatch(all, /javascript:|<img/);
  assert.match(all, /&lt;img src=x/);
  for (const a of all.match(/<a [^>]*>/g)) assert.match(a, /^<a class="frow lrow-l" data-key="[^"]*" href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer">$/);
  // each row says which watch it came from and where; a group says how many and the range, and opens to its members
  assert.match(vis(all), /RTX 4080 card 1 RTX 4080 · OfferUp · posted 3 days ago \$701/);
  assert.match(vis(all), /RTX 4080 · OfferUp · not in the latest search/);
  assert.match(all, /<details class="lgrp"><summary class="frow" data-key="[^"]*">[^]*3 listings · Facebook Marketplace, OfferUp[^]*<b>\$706<\/b><small>to \$707<\/small>[^]*And 1 more not shown\.[^]*<\/details>/);
  assert.match(vis(all), /No price/);
  assert.doesNotMatch(vis(all), /\$0\b|NaN|undefined|null/);
});

test('Market: the category chip narrows Listings to that category\'s watches; a failed read says so; TV adds nothing', () => {
  const out = sectOf(page(listings(), { view: { cat: 'outdoors' } }), 's-lst');
  assert.match(vis(out), /Pellet grill A/);
  assert.doesNotMatch(vis(out), /RTX 4080 card|Orphan/);
  assert.match(vis(sectOf(page(listings(), { view: { cat: 'home' } }), 's-lst')), /No marketplace listings in this category\./);
  for (const l of [null, { error: 'http 503' }]) assert.match(vis(sectOf(page(l), 's-lst')), /Listings are not reporting\./);
  assert.doesNotMatch(page(listings(), { tv: true, cls: 'TV' }), /s-lst|lrow-l/);
});

test('watch sheet: that watch\'s own listings only, eight then one Show more; a watch with none says so', () => {
  const { s, h } = sheet(listings());
  assert.equal(s.listings.length, 13);
  const sec = h.slice(h.indexOf('class="sh-sec s-lst"'), h.indexOf('</section>', h.indexOf('class="sh-sec s-lst"')));
  assert.match(vis(sec), />?\s*Marketplace listings 15 listings, 13 after duplicates/);
  assert.doesNotMatch(vis(sec), /Pellet grill|Orphan/);
  assert.match(sec, /<details class="lmore"><summary class="btn btn-quiet">Show 5 more<\/summary>/);
  const grill = sheet(listings(), 'pellet-grill').h;
  assert.match(vis(grill), /Marketplace listings 2 listings Pellet grill A/);
  assert.doesNotMatch(grill, /class="lmore"/);
  const none = sheet(listings(), 'smart-home-hub');
  assert.deepEqual(none.s.listings, []);
  assert.match(vis(none.h), /No marketplace listings for this watch right now\./);
  // the listings read failed: no section, named once in the missing line
  const down = sheet(null);
  assert.doesNotMatch(down.h, /s-lst/);
  assert.match(vis(down.h), /Not reported: [^.]*marketplace listings/);
});

test('watch sheet: resale facts; flip from asking prices after fees and shipping, sold is No data and never 0', () => {
  const { s, h } = sheet(listings(), 'rtx-4080', { median: 1000, best: { price: 800, site: 'newegg', url: 'https://www.newegg.com/x' }, groups: [{ title: 'Case', count: 2, best_price: 120, max_price: 130, items: [] }], shipping: { median_cost: 10 }, n: 24, sold: undefined, flip: undefined, asking: undefined });
  // 1000 - 800 - 13.25% fees - 10 shipping; a $120 "group" under 0.3 x the median is a part, not the product
  assert.equal(s.resale.flip.score, 57.5);
  assert.equal(s.resale.buy, 800);
  const sec = h.slice(h.indexOf('class="sh-sec s-resale"'));
  const by = Object.fromEntries([...sec.slice(0, sec.indexOf('</section>')).matchAll(/<dt>([^<]*)<\/dt><dd>([^]*?)<\/dd>/g)].map((m) => [m[1], vis(m[2])]));
  assert.deepEqual(by, { Flip: '$57.50', 'Lowest price': '$800', Asking: '24', Sold: 'No data', New: '0', 'Used or refurbished': '16' });
  assert.match(vis(sec), /It uses asking prices, so treat it as a rough guide\./);
  assert.ok(s.missing.includes('sold count'));
  // a sold source with 10 sales moves the flip onto sold prices; the feed's own flip wins over both
  const sold = sheet(listings(), 'rtx-4080', { median: 1000, best: { price: 800 }, groups: [], shipping: null, sold: { n: 12, median: 900 } }).s.resale;
  assert.deepEqual([sold.flip.basis, sold.flip.n, sold.sold, sold.flip.score], ['sold', 12, 12, -19.25]);
  assert.deepEqual(sheet(listings(), 'rtx-4080', { flip: { score: 42, basis: 'sold', n: 30 } }).s.resale.flip, { score: 42, basis: 'sold', n: 30 });
  // no median: no flip, said once
  const nf = sheet(listings(), 'rtx-4080', { median: null });
  assert.equal(nf.s.resale.flip, null);
  assert.ok(nf.s.missing.includes('flip'));
});

test('watch sheet: near-duplicate groups with their member links; the biggest of the total is said; unsafe links drop', () => {
  const groups = [
    { title: 'ASUS TUF RTX 4080', count: 3, best_price: 900, max_price: 1100, sites: ['newegg', 'amazon'], items: [
      { title: 'ASUS TUF RTX 4080', price: 900, url: 'https://www.newegg.com/a', site: 'newegg' },
      { title: 'ASUS TUF RTX 4080 OC', price: 1100, url: 'javascript:alert(1)', site: 'amazon' }] },
    { title: 'MSI RTX 4080', count: 1, best_price: 950, url: 'https://www.newegg.com/m', site: 'newegg', items: [] }];
  const { h } = sheet(listings(), 'rtx-4080', { groups, groups_total: 9 });
  const sec = h.slice(h.indexOf('class="sh-sec s-dup"'), h.indexOf('</section>', h.indexOf('class="sh-sec s-dup"')));
  assert.match(vis(sec), />?\s*Same item, several listings ASUS TUF RTX 4080 3 listings · Newegg, Amazon \$900 to \$1,100/);
  assert.match(sec, /href="https:\/\/www\.newegg\.com\/a" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(sec, /javascript:/);
  assert.match(vis(sec), /And 1 more not shown\./);
  assert.match(vis(sec), /MSI RTX 4080 Newegg \$950/);
  assert.match(vis(sec), /The 2 biggest of 9 groups\./);
  // a watch without groups has no section
  assert.doesNotMatch(sheet(listings(), 'rtx-4080', { groups: [] }).h, /s-dup/);
});

test('a hostile or empty listings feed never breaks the page or the sheet', () => {
  const bad = [{}, { listings: 'x', groups: 'y' }, { listings: [null, 3, { url: 5 }], groups: [null, { count: 'a', items: [null] }, { count: 9, items: 'z' }] }];
  for (const l of bad) {
    assert.doesNotThrow(() => S.listingRows(l, null));
    const h = page(l);
    assert.match(h, /class="sect s-lst"/);
    assert.doesNotMatch(vis(sectOf(h, 's-lst')), /NaN|undefined|\[object/);
    assert.doesNotThrow(() => sheet(l));
  }
  assert.match(vis(sectOf(page({ listings: [] }), 's-lst')), /No marketplace listings right now\./);
});
