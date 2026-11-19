// node --test tests/realestate_listing_quality.test.js
// Real estate > Residential listings (2026-11-16 housing feed quality): a listing price is known only when the row says USD,
// a repeat of one home shows once on its ZIP sheet, and the ZIP sheet's count of rows is the rows it shows.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const deck = fs.readFileSync(path.join(root, 'static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const src = fs.readFileSync(path.join(root, 'static/pages/realestate.js'), 'utf8');
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const load = () => new Function('localStorage', 'DeckUI', src + '\nreturn {DeckScope,DeckRE};')(store(), D);
const fx = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/realestate-page', p), 'utf8'));
const z92647 = fx('zip-92647.json');
const NOW = Date.UTC(2026, 10, 16, 8);

test('a home price with no currency is unknown, never dollars: the row says Price not listed', () => {
  const { DeckRE: R } = load();
  const row = R.homeRow({ addr: '9 Ocean Ave', city: 'Huntington Beach', price: 900000, beds: 3, source: 'redfin' }, NOW);
  assert.equal(row.title, 'Price not listed \u00b7 3 BR');
  assert.doesNotMatch(row.sub, /\/SF/);
});

test('a home price reported as USD shows its amount', () => {
  const { DeckRE: R } = load();
  const row = R.homeRow({ addr: '9 Ocean Ave', city: 'Huntington Beach', price: 900000, currency: 'USD', beds: 3, source: 'redfin' }, NOW);
  assert.match(row.title, /\$900K/);
});

test('a home size under 100 SF is an acreage: no size and no price per square foot on its row', () => {
  const { DeckRE: R } = load();
  const row = R.homeRow({ addr: '14 Fixture Cove Dr', city: 'Huntington Beach', price: 16900000, currency: 'USD', sqft: 0.78, type: 'Land', source: 'redfin' }, NOW);
  assert.match(row.title, /\$16\.9\d?M/);
  assert.doesNotMatch(row.sub, /SF/);
});

test('a ZIP sheet shows one row for a home two sources both list, and says it once', () => {
  const { DeckRE: R } = load();
  const homes = [
    { addr: '9 Ocean Ave', city: 'Huntington Beach', price: 900000, currency: 'USD', beds: 3, source: 'redfin', url: 'https://www.redfin.com/a' },
    { addr: '9 Ocean Avenue', city: 'Huntington Beach', price: 900000, currency: 'USD', beds: 3, source: 'zillow', url: 'https://www.zillow.com/b' },
    { addr: '4 Harbor Way', city: 'Huntington Beach', price: 1200000, currency: 'USD', beds: 4, source: 'redfin', url: 'https://www.redfin.com/c' },
  ];
  const rec = Object.assign({}, z92647, { listings: { status: 'ok', homes } });
  const z = R.zipModel(rec, { summary: fx('summary.json'), cat: new Map() });
  const body = R.zipBody(z, { find: '' }, NOW);
  const sec = body.slice(body.indexOf('data-sec="homes"'), body.indexOf('</section>', body.indexOf('data-sec="homes"')));
  assert.equal((sec.match(/class="frow"/g) || []).length, 2, 'two homes, not three rows');
  assert.equal((sec.match(/\$900K/g) || []).length, 1);
});

test('a ZIP sheet with more homes than it shows says how many it shows of the total', () => {
  const { DeckRE: R } = load();
  const homes = Array.from({ length: 14 }, (_, i) => ({ addr: `${100 + i} Ocean Ave`, city: 'Huntington Beach', price: 800000 + i * 10000, currency: 'USD', beds: 3, source: 'redfin', url: `https://www.redfin.com/h${i}` }));
  const rec = Object.assign({}, z92647, { listings: { status: 'ok', homes } });
  const z = R.zipModel(rec, { summary: fx('summary.json'), cat: new Map() });
  const body = R.zipBody(z, { find: '' }, NOW);
  const sec = body.slice(body.indexOf('data-sec="homes"'), body.indexOf('</section>', body.indexOf('data-sec="homes"')));
  assert.equal((sec.match(/class="frow"/g) || []).length, 12, 'twelve rows shown');
  assert.match(sec, /Showing 12 of 14/);
});

test('a ZIP sheet counts a repeat home once: 12 homes with one repeat show no count line', () => {
  const { DeckRE: R } = load();
  const homes = Array.from({ length: 12 }, (_, i) => ({ addr: `${100 + i} Ocean Ave`, city: 'Huntington Beach', price: 800000 + i * 10000, currency: 'USD', beds: 3, source: 'redfin', url: `https://www.redfin.com/h${i}` }));
  homes.push({ addr: '100 Ocean Avenue', city: 'Huntington Beach', price: 800000, currency: 'USD', beds: 3, source: 'zillow', url: 'https://www.zillow.com/h0' });
  const rec = Object.assign({}, z92647, { listings: { status: 'ok', homes } });
  const z = R.zipModel(rec, { summary: fx('summary.json'), cat: new Map() });
  const body = R.zipBody(z, { find: '' }, NOW);
  const sec = body.slice(body.indexOf('data-sec="homes"'), body.indexOf('</section>', body.indexOf('data-sec="homes"')));
  assert.equal((sec.match(/class="frow"/g) || []).length, 12);
  assert.doesNotMatch(sec, /Showing/);
});

// listed_at is a source's own posted time. Alexandria's publishedAt arrives as an ISO string; a collector may also write milliseconds.
test('a home listed with an ISO or millisecond posted time shows its days listed; an unreadable or future time shows none', () => {
  const { DeckRE: R } = load();
  const base = { addr: '9 Ocean Ave', city: 'Huntington Beach', price: 900000, currency: 'USD', beds: 3, source: 'redfin' };
  const days = (t) => R.homeRow(Object.assign({}, base, { listed_at: t }), NOW).sub;
  assert.match(days('2026-11-13T08:00:00Z'), /3 days listed/);
  assert.match(days(Date.UTC(2026, 10, 15, 8)), /1 day listed/, 'milliseconds');
  assert.match(days(Math.floor(Date.UTC(2026, 10, 13, 8) / 1000)), /3 days listed/, 'seconds still work');
  assert.doesNotMatch(days('2027-01-01T00:00:00Z'), /listed/, 'a future date is unknown');
  assert.doesNotMatch(days('last week'), /listed/);
  assert.doesNotMatch(days(''), /listed/);
});
