// node --test tests/*.test.js  (2026-10-21 status fields: finance status counts. Shop moved to tests/shop_market.test.js)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.UTC(2026, 9, 21, 20);
const T = (s) => NOW / 1000 - s;
const vis = (h) => h.replace(/<span class="diag">[^]*?<\/span>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------- Money: finance.json ----------------
const fin = () => ({
  t: T(60), generated_at: T(60), refresh: 3600, stale: false, sample: false, errors: [],
  as_of: { balances: T(3 * 86400), inventory: T(2 * 3600) },
  status_counts: { never: 2, ok: 1 },
  explain: { never: 'Never means the app was not read yet. Each pass needs you at the phone.', last_checked: 'Last checked is the iPhone app list scan, not a balance read.' },
  inventory: { installed: 185, finance_related: 15, covered: 3, src: 'x', t: T(2 * 3600) },
  has_totals: false,
  apps: [
    { id: 'kraken', name: 'Kraken', kind: 'crypto', route: 'api', status: 'ok', last_ok: T(600), age: 600, has_values: false, reason: null },
    { id: 'chase', name: 'Chase', kind: 'bank', route: 'iphone_screen', status: 'never', last_ok: null, age: null, has_values: false, reason: 'Needs the iPhone unlocked and you at the screen for one pass' },
    { id: 'venmo', name: 'Venmo', kind: 'payments', route: 'iphone_screen', status: 'never', last_ok: null, age: null, has_values: false, reason: null }
  ]
});

test('money: the page carries no capture status; explain lines and per-app reasons live in the Data sheet', () => {
  const page = D.finPage(fin(), NOW, null);
  assert.doesNotMatch(vis(page), /Balances as of|app list scanned|1 ok|2 never|Never means|Last checked|Needs the iPhone|Updated/);
  const d = D.finData(fin(), NOW);
  assert.match(d.method.map((m) => m.join(': ')).join(' | '), /Last checked: Last checked is the iPhone app list scan, not a balance read\./);
  const never = d.setup.find((s) => /not captured yet/.test(s.name));
  assert.equal(never.name, '2 apps not captured yet');
  assert.match(never.line, /^Chase, Venmo\. Never means the app was not read yet\./);
  const inv = d.sources.find((s) => s.name === 'iPhone app list');
  assert.equal(inv.gives, '185 apps, 15 look financial, 3 captured');
  assert.equal(inv.asOf, T(2 * 3600));
  assert.deepEqual(d.sources.find((s) => s.name === 'Kraken'), { name: 'Kraken', gives: 'Read-only API', asOf: T(600), state: 'ok' });
  // an age is not a capture status (plan row L17): the row says how old its data is, with this test's fixed clock, and nothing else
  assert.match(page, /data-app="kraken"><span class="fl"><b>Kraken<\/b><small class="fin-age">Read 10\u00A0min\u00A0ago<\/small><\/span>/);
  assert.doesNotMatch(vis(page), /\bok\b|\bnever\b|\bfailed\b/i, 'no status word on the page model');
  // a source that names how it is read carries its data age into the Data sheet beside the route
  const f2 = fin(); Object.assign(f2.apps[0], { basis: 'live', data_as_of: T(600) });
  assert.equal(D.finData(f2, NOW).sources.find((s) => s.name === 'Kraken').gives, 'Read-only API \u00B7 Live, read 10\u00A0min\u00A0ago');
});

test('money: an ok capture older than twice the refresh is out of date on its row and in the Data sheet', () => {
  const h = fin(); h.apps[0].last_ok = T(3 * 86400);
  assert.match(D.finPage(h, NOW, null), /data-app="kraken"><span class="fl"><b>Kraken<\/b><small><span class="pill warn"><span class="sd warn"><\/span>Out of date<\/span><\/small>/);
  assert.equal(D.finData(h, NOW).sources.find((s) => s.name === 'Kraken').state, 'stale');
  assert.doesNotMatch(D.finPage(fin(), NOW, null), /pill/, 'a fresh capture shows no status');
});

test('money: an older finance file (no generated_at, as_of, counts, explain, reasons) still renders', () => {
  const f = fin(); ['generated_at', 'as_of', 'status_counts', 'explain'].forEach((k) => delete f[k]); f.apps.forEach((a) => delete a.reason);
  assert.match(vis(D.finPage(f, NOW, null)), /Kraken/);
  assert.equal(D.finStatus(f, NOW).age, 60);
  assert.match(D.finData(f, NOW).setup[0].line, /Each fills in after you approve a capture on your phone\./);
});

// the older panels' number words (Money): moved here from the retired Shop v9 tests
test('numbers: dash for null, zero stays zero, rounded zero has no sign', () => {
  assert.equal(D.money(null), '\u2014');
  assert.equal(D.money(0), '$0.00');
  assert.equal(D.money(1299), '$1,299.00');
  assert.equal(D.pct(null), '\u2014');
  assert.equal(D.pct(0), '0.0%');
  assert.equal(D.pct(0.0004), '0.0%');
  assert.equal(D.pct(-0.0004), '0.0%');
  assert.equal(D.pct(-0.021), '\u22122.1%');
  assert.equal(D.pct(0.5, 0), '+50%');
});

