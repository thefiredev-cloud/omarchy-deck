// node --test tests/*.test.js  (Money > Accounts: assets, liabilities and net apart, and how old each account's data is; DoMarkets
// 2026-11-15, #372 step 4, plan rows L16 and L17 of perceive/SeeLostSweep.md). The server gives the fields since #347: per app basis,
// data_as_of, data_newest, sense, note and the public not_counted ids on GET /api/finance; the money block (assets, liabilities, net,
// groups) only on GET /api/finance-values. Amounts stay masked until Show amounts; a missing total is No data with its reason, never zero.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const a = src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), b = src.indexOf('// ==== DECK V6 UI HELPERS END ====');
const D = new Function(src.slice(a, b) + '\nreturn DeckUI;')();
const css = fs.readFileSync(path.join(__dirname, '../static/css/money.css'), 'utf8');
const T = 1794790000, NOW = T * 1000, H = 3600, DAY = 86400;
const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// what GET /api/finance serves for the five captured sources of the owner's real feed (kit stand-in shape, round fake times)
const feed = (o) => Object.assign({ t: T, refresh: 300, errors: [], not_counted: [], has_totals: true, apps: [
  { id: 'kraken', name: 'Kraken', kind: 'crypto', route: 'api', status: 'ok', last_ok: T - 120, basis: 'live', cadence_s: 300, data_as_of: T - 120, data_newest: T - 120, sense: 'asset', has_values: true },
  { id: 'ibkr', name: 'IBKR', kind: 'brokerage', route: 'api', status: 'ok', last_ok: T - 2 * H, basis: 'eod', cadence_s: 10800, data_as_of: T - 2 * DAY, data_newest: T - 2 * DAY, sense: 'asset', has_values: true },
  { id: 'simplefin', name: 'Bank cash (SimpleFIN)', kind: 'bank', route: 'api', status: 'ok', last_ok: T - H, basis: 'daily', cadence_s: 10800, data_as_of: T - 2 * DAY, data_newest: T - 16 * H, sense: 'asset', has_values: true },
  { id: 'simplefin-debts', name: 'Cards and loans (SimpleFIN)', kind: 'bank', route: 'api', status: 'ok', last_ok: T - H, basis: 'daily', cadence_s: 10800, data_as_of: T - 2 * DAY, data_newest: T - 2 * DAY, sense: 'liability', note: 'SimpleFIN says: one card needs a new login.', has_values: true },
  { id: 'tax', name: 'Tax 2026', kind: 'tax', route: 'api', status: 'ok', last_ok: T - 17 * DAY, basis: '', cadence_s: 2592000, data_as_of: null, data_newest: null, sense: 'asset', has_values: true },
  { id: 'empower', name: 'Empower', kind: 'brokerage', route: 'iphone_screen', status: 'never', last_ok: null, basis: '', sense: 'asset', has_values: false },
] }, o || {});
const MONEY = { assets_usd: 412300.5, liabilities_usd: 23400.25, net_usd: 388900.25, groups: [
  { id: 'cash', label: 'Cash (bank)', class: 'asset', usd: 12300.5, n: 5 }, { id: 'brokerage', label: 'Investments (IBKR)', class: 'asset', usd: 380000, n: 0 },
  { id: 'crypto', label: 'Crypto (Kraken)', class: 'asset', usd: 20000, n: 0 }, { id: 'cards', label: 'Credit cards', class: 'liability', usd: 3400.25, n: 3 },
  { id: 'loans', label: 'Loans', class: 'liability', usd: 20000, n: 1 }] };
const VALUES = { kraken: { balance_usd: 20000 }, ibkr: { balance_usd: 380000 }, simplefin: { balance_usd: 12300.5 }, 'simplefin-debts': { balance_usd: 23400.25 }, tax: { balance_usd: 500 } };
const rev = (o) => Object.assign({ apps: JSON.parse(JSON.stringify(VALUES)), totals: { net_usd: 388900.25, by_kind: { bank: 12300.5, brokerage: 380000, crypto: 20000 } }, money: JSON.parse(JSON.stringify(MONEY)), exp: NOW + 30000, err: '', busy: false }, o || {});
// every amount above in the forms the page prints (long, short, bare digits)
const AMOUNTS = [412300.5, 23400.25, 388900.25, 12300.5, 380000, 20000, 3400.25, 500];
const leaks = (h) => AMOUNTS.filter((n) => h.includes(D.money(n)) || h.includes(DeckCore.fmt.money(n)) || h.includes(String(Math.round(n))) || h.includes(Math.round(n).toLocaleString('en-US')));
const tiles = (h) => [...(h.match(/<section class="sect span-all fin-tot" aria-label="Total">(<div class="strip"[^]*?)<div class="ivctl">/) || ['', ''])[1]
  .matchAll(/<div class="tile( dx)?"><span class="h">([^<]+)<\/span><b class="v">([^<]+)<\/b>(?:<span class="t">([^<]+)<\/span>)?/g)].map((m) => ({ dx: !!m[1], label: m[2], value: m[3], sub: m[4] || '' }));
const row = (h, id) => (h.match(new RegExp('<button type="button" class="frow" data-open="app" data-app="' + id + '">[^]*?</button>')) || [''])[0];

test('L16 masked: the Total, Assets and Owed lead the strip on every size, each masked; the kind tiles follow from a laptop up', () => {
  const h = D.finPage(feed(), NOW, null);
  assert.deepEqual(tiles(h).map((t) => [t.label, t.dx, t.value]), [
    ['Total, net across your apps', false, '$\u2022\u2022\u2022'], ['Assets', false, '$\u2022\u2022\u2022'], ['Owed', false, '$\u2022\u2022\u2022'],
    ['Bank', true, '$\u2022\u2022\u2022'], ['Brokerage', true, '$\u2022\u2022\u2022'], ['Crypto', true, '$\u2022\u2022\u2022'], ['Tax', true, '$\u2022\u2022\u2022']]);
  assert.match(h, /<div class="strip" data-n="7" data-nb="3" role="group" aria-label="Total">/);
  assert.deepEqual(leaks(h), []);
  assert.doesNotMatch(h, /\d{3},\d{3}|\$\d/, 'no digit of an amount before Show amounts');
});

test('L16 shown: assets, what is owed and net from the values view, each group under its side; owed is never a negative', () => {
  const h = D.finPage(feed(), NOW, rev());
  const t = tiles(h);
  assert.deepEqual(t.slice(0, 3).map((x) => [x.label, x.value]), [['Total, net across your apps', '$389K'], ['Assets', '$412K'], ['Owed', '$23K']]);
  assert.equal(t[1].sub, 'Cash $12K \u00B7 Investments $380K \u00B7 Crypto $20K', 'groups without the source hint in brackets');
  assert.equal(t[2].sub, 'Credit cards $3,400 \u00B7 Loans $20K');
  assert.doesNotMatch(vis(h), /\u2212\$23|-\$23|\(IBKR\)|\(Kraken\)|\(bank\)/);
  // a card or loan account reads Owed, masked and shown, and its balance is never a negative cash figure
  assert.match(row(D.finPage(feed(), NOW, null), 'simplefin-debts'), /<span class="fr"><b>Owed \$\u2022\u2022\u2022<\/b><\/span>/);
  assert.match(row(h, 'simplefin-debts'), /<span class="fr"><b>Owed \$23,400\.25<\/b><\/span>/);
  const neg = rev(); neg.apps['simplefin-debts'].balance_usd = -23400.25;
  assert.match(row(D.finPage(feed(), NOW, neg), 'simplefin-debts'), /<b>Owed \$23,400\.25<\/b>/, 'a writer that stores debt as negative still reads Owed');
  assert.doesNotMatch(row(h, 'simplefin'), /Owed/);
});

test('L16 missing: no money block or a null side is No data with its reason, never $0; the net falls back to the totals', () => {
  const none = tiles(D.finPage(feed(), NOW, rev({ money: null })));
  assert.deepEqual(none.slice(0, 3).map((x) => [x.value, x.sub]), [['$389K', 'Not split into assets and owed'], ['No data', 'Not split out in the file'], ['No data', 'Not split out in the file']]);
  const half = rev(); half.money.liabilities_usd = null; half.money.groups = half.money.groups.filter((g) => g.class === 'asset');
  const t = tiles(D.finPage(feed(), NOW, half));
  assert.deepEqual([t[2].value, t[2].sub], ['No data', 'Not in the file']);
  for (const x of none.concat(t)) assert.doesNotMatch(x.value, /^\$0$|^0$/);
});

test('L16 Total (review ReviewFive): never a net the split does not back; masked it stays masked in every case', () => {
  const total = (r) => tiles(D.finPage(feed(), NOW, r))[0];
  // 1. a missing side: the Total is No data with that side's reason, not the file's net
  const noOwed = rev(); noOwed.money.liabilities_usd = null;
  assert.deepEqual([total(noOwed).value, total(noOwed).sub], ['No data', 'Owed is not in the file']);
  const noAssets = rev(); noAssets.money.assets_usd = null;
  assert.deepEqual([total(noAssets).value, total(noAssets).sub], ['No data', 'Assets are not in the file']);
  // 2. all three present but assets less owed is more than $1 off the net
  const off = rev(); off.money.net_usd = 388902.5;
  assert.deepEqual([total(off).value, total(off).sub], ['No data', 'The file\u2019s figures do not add up']);
  const near = rev(); near.money.net_usd = 388900.9;
  assert.deepEqual([total(near).value, total(near).sub], ['$389K', ''], 'a cent of rounding is not a disagreement');
  // 3. no money block: the old total of the apps, said so
  assert.deepEqual([total(rev({ money: null })).value, total(rev({ money: null })).sub], ['$389K', 'Not split into assets and owed']);
  // masked: the same mask and no reason that would hint at the hidden figures
  for (const r of [null, Object.assign(rev(), { exp: 0, apps: null, totals: null, money: null })]) {
    const h = D.finPage(feed(), NOW, r), x = tiles(h)[0];
    assert.deepEqual([x.value, x.sub], ['$\u2022\u2022\u2022', '']);
    assert.deepEqual(leaks(h), []);
  }
});

test('L16 not counted: a source whose read failed is named on the Total, masked or shown, by its app name and without an amount', () => {
  const f = feed({ not_counted: ['kraken', 'gone-app'] });
  for (const r of [null, rev()]) {
    const t = tiles(D.finPage(f, NOW, r));
    assert.equal(t[0].sub, 'Not counted: Kraken, gone-app', r ? 'shown' : 'masked');
  }
  assert.deepEqual(leaks(D.finPage(f, NOW, null)), []);
});

test('L17: each account row says how old its data is, in words; the Data sheet keeps the read route and the full line', () => {
  const h = D.finPage(feed(), NOW, null);
  const age = (id) => (row(h, id).match(/<small class="fin-age">([^<]*)<\/small>/) || [])[1];
  assert.equal(age('kraken'), 'Live, read 2\u00A0min\u00A0ago');
  assert.equal(age('ibkr'), 'End-of-day figures from 2\u00A0d\u00A0ago');
  assert.equal(age('simplefin'), 'Balances from 16\u00A0h to 2\u00A0d\u00A0ago');
  assert.equal(age('simplefin-debts'), 'Balances from 2\u00A0d\u00A0ago');
  assert.equal(age('tax'), 'Read 17\u00A0d\u00A0ago');
  // a source that says how it is read but not when its data is from: says so, never "0 min"
  const f = feed(); f.apps[1].data_as_of = null; f.apps[1].data_newest = null;
  assert.equal((row(D.finPage(f, NOW, null), 'ibkr').match(/<small class="fin-age">([^<]*)<\/small>/) || [])[1], 'End-of-day figures, date not given');
  // the Data sheet: route and the same age, and the writer's note
  const d = D.finData(feed(), NOW);
  const s = d.sources.find((x) => x.name === 'IBKR');
  assert.equal(s.gives, 'Read-only API \u00B7 End-of-day figures from 2\u00A0d\u00A0ago');
  assert.ok(d.method.some(([k, v]) => k === 'Cards and loans (SimpleFIN)' && v === 'SimpleFIN says: one card needs a new login.'));
  assert.doesNotMatch(vis(h), /SimpleFIN says/, 'the writer\'s note stays in the Data sheet');
});

test('L16 sheet: a liability\'s Balance tile reads Owed', () => {
  const sp = D.finSheet(feed(), 'simplefin-debts', NOW, null);
  assert.match(sp.body, /<span class="h">Owed<\/span><b class="v">\$\u2022\u2022\u2022<\/b>/);
  assert.match(D.finSheet(feed(), 'simplefin', NOW, null).body, /<span class="h">Balance<\/span>/);
});

test('controller: the money block is held with the other amounts and dropped at Hide and at 30 s', async () => {
  let now = NOW; const timers = [], pending = [];
  const ctl = D.finCtl({ now: () => now, setT: (fn, d) => { timers.push({ fn, at: now + d }); return timers.length; }, clearT() {}, onChange() {}, get: () => new Promise((r) => pending.push(r)) });
  ctl.reveal(); pending.shift()({ apps: VALUES, totals: { net_usd: 1 }, money: MONEY });
  await new Promise((r) => setImmediate(r));
  assert.equal(ctl.view().money.assets_usd, 412300.5);
  ctl.hide();
  assert.equal(ctl.view().money, null);
  ctl.reveal(); pending.shift()({ apps: VALUES, money: 'x' });
  await new Promise((r) => setImmediate(r));
  assert.equal(ctl.view().money, null, 'a money block that is not an object is dropped');
});

test('css: on a phone the Total takes the strip\'s first row and Assets and Owed share the second', () => {
  assert.match(css, /@media \(max-width:599px\)\{#pg-money \.fin-tot \.strip\[data-nb="3"\]>\.tile:first-child\{grid-column:1\/-1\}\}/);
});
