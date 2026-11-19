// node --test tests/deck_housing_listings.test.js
// Housing listings: a repeat of a priced home must not hide its price behind an unpriced first copy.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.UTC(2026, 10, 14, 18);
const T = (s) => NOW / 1000 - s;
const feed = (homes) => ({ t: T(30), src: 'x', stale: false, errors: [], market: {}, homes, commercial: [] });

test('a repeat with a price fills the kept unpriced row, so the budget filter still finds the home', () => {
  const unpriced = { addr: '9 Ocean Ave', city: 'Dana Point', price: null, source: 'redfin', url: 'https://www.redfin.com/a' };
  const priced = { addr: '9 Ocean Avenue', city: 'Dana Point', price: 900000, currency: 'USD', source: 'zillow', url: 'https://www.zillow.com/b' };
  const all = D.homes(feed([unpriced, priced]), NOW, { page: 'all' });
  assert.match(all, /\$900K/);
  assert.equal((all.match(/class="frow/g) || []).length, 1);
  const within = D.homes(feed([unpriced, priced]), NOW, { page: 'all', home: { within: true }, budget: 1000000 });
  assert.match(within, /\$900K/);
  assert.doesNotMatch(within, /No home matches these filters/);
});

test('repeats keep feed order and a priced first copy stays where it was', () => {
  const a = { addr: '1 Hill Rd', city: 'Dana Point', price: 700000, currency: 'USD', source: 'redfin' };
  const b = { addr: '2 Hill Rd', city: 'Dana Point', price: null, source: 'redfin' };
  const dup = { addr: '1 Hill Road', city: 'Dana Point', price: 650000, currency: 'USD', source: 'zillow' };
  const html = D.homes(feed([a, b, dup]), NOW, { page: 'all' });
  assert.equal((html.match(/class="frow/g) || []).length, 2);
  assert.ok(html.indexOf('$700K') < html.indexOf('2 Hill Rd'));
  assert.doesNotMatch(html, /\$650K/);
});

test('two homes at one street address with different bed or size counts are two listings, not a repeat', () => {
  const a = { addr: '12 Sunflower Way', city: 'Dana Point', price: 907250, currency: 'USD', beds: 2, sqft: 1568, source: 'zillow', url: 'https://www.zillow.com/community/sunflower-a' };
  const b = { addr: '12 Sunflower Way', city: 'Dana Point', price: 1005000, currency: 'USD', beds: 3, sqft: 1683, source: 'zillow', url: 'https://www.zillow.com/community/sunflower-b' };
  const html = D.homes(feed([a, b]), NOW, { page: 'all' });
  assert.equal((html.match(/class="frow/g) || []).length, 2);
  assert.match(html, /\$907K/);
  assert.match(html, /\$1\.00M/);
});
test('listings without currency keep price unknown and fail the budget filter', () => {
  const home = { addr: '3 Bay View', city: 'Dana Point', price: 900000, source: 'redfin' };
  const commercial = { addr: '4 Harbor Way', city: 'Dana Point', price: 1200000, type: 'Office', source: 'lee-associates' };
  const all = D.homes(Object.assign(feed([home]), { commercial: [commercial] }), NOW, { page: 'all' });
  assert.match(all, /-- \u00b7 3 Bay View/);
  assert.match(all, /-- \u00b7 Office \u00b7 Dana Point/);
  const within = D.homes(Object.assign(feed([home]), { commercial: [commercial] }), NOW,
    { page: 'all', home: { within: true }, budget: 2000000 });
  assert.match(within, /No home matches these filters/);
});
