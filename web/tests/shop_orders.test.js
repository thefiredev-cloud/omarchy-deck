// node --test tests/*.test.js  (Shop > Orders, Deck v3, PgShop 2026-11-14)
// Purchases and return deadlines as before, on v3 rows: one freshness mark, the paused state as the page status, no file names,
// amounts hidden until Show amounts, and a launch row that opens only on the second tap.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const S = new Function('DeckUI', fs.readFileSync(path.join(__dirname, '../static/pages/shop.js'), 'utf8') + '\nreturn DeckShop;')(D);
// 2026-11-14 12:00 PT
const NOW = Date.UTC(2026, 10, 14, 20);
const vis = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const C = (o) => Object.assign({
  orders: [
    { id: 'm2', title: 'XVX keycaps', date: '2026-10-21', return_by: '2026-11-14', amount: null, currency: 'USD', manual: true },
    { id: 'm1', title: 'NuPhy Air75 V3 Low Profile Mechanical Keyboard', date: '2026-10-21', return_by: '2026-11-20', amount: null, currency: 'USD', manual: true },
    { id: 'g1', title: 'USB-C cable', date: '2026-10-02', return_by: null, amount: 19.99, currency: 'USD', manual: false }],
  total: 5, pulls: [{ account: 'tanner', ok: true, error: '' }], checked: NOW / 1000 - 3 * 3600, src: '~/.hermes/watcher-state/purchases-ledger.json',
  refresh: 86400, t: NOW / 1000 - 3600, age: 3600, stale: false, monitor: { state: 'enabled', name: 'Money - Purchase monitor', last_run_at: '2026-11-14T13:40:00Z' }
}, o);
const body = (c, o) => S.ordersBody(Object.assign({ c, now: NOW, host: 'pc-desktop', rev: false, armed: '' }, o));

test('return deadlines: soonest first, days left in Pacific time, last day marked', () => {
  const h = vis(body(C()));
  assert.match(h, /Return deadlines XVX keycaps .* Last day today .*NuPhy Air75 V3 Low Profile Mechanical Keyboard .* 6 days left/);
  assert.equal(S.daysLeft('2026-11-20', NOW), 6);
  assert.deepEqual(S.returnWord(-1), { w: 'Window closed', k: 'bad' });
});

test('amounts stay hidden until Show amounts, then show; nothing else is a money value', () => {
  const hid = body(C());
  assert.match(hid, /\$\u2022\u2022\u2022/);
  assert.doesNotMatch(hid, /\$19\.99/);
  assert.match(vis(hid), /Show amounts/);
  const shown = body(C(), { rev: true });
  assert.match(shown, /\$19\.99/);
  assert.match(vis(shown), /Hide/);
  // no amount anywhere: no reveal control at all
  const none = C(); none.orders = none.orders.filter((o) => o.amount == null);
  assert.doesNotMatch(vis(body(none)), /Show amounts/);
});

test('one status: the paused monitor is the first row of Return deadlines; the freshness mark stays a plain age, no second warning', () => {
  assert.deepEqual(S.ordersFresh({ c: C(), now: NOW }), { age: 3 * 3600, refresh: 86400, missing: 0 });
  assert.doesNotMatch(body(C()), /Paused by you/);
  const pc = C({ monitor: { state: 'paused', last_run_at: '2026-11-10T20:00:00Z' }, checked: NOW / 1000 - 10 * 86400 });
  const p = body(pc);
  assert.match(vis(p), /^Return deadlines Paused by you · last ran 4 days ago /);
  assert.doesNotMatch(p, /stale-bar/, 'no amber bar above the content');
  // the mark would read Out of date at 10 days; while paused it shows the plain age, since the Paused row is the status
  const a = S.ordersFresh({ c: pc, now: NOW });
  assert.ok(a.age <= 2 * a.refresh, 'paused: the mark does not warn a second time');
  assert.doesNotMatch(D.fresh(a), /warn/);
  const never = body(C({ monitor: { state: 'paused', last_run_at: null } }));
  assert.match(vis(never), /Paused by you · never ran/);
});

test('TV: deadlines and purchases are the board; the launch rows sit below it', () => {
  const h = body(C());
  const board = h.slice(h.indexOf('<div class="board">'), h.indexOf('s-launch'));
  assert.match(board, /Return deadlines[^]*Purchases/);
  assert.doesNotMatch(board, /data-cm=/);
  assert.match(h.slice(h.indexOf('s-launch')), /data-cm="amazon-orders"/);
});

test('no file names or paths on the page or in its status', () => {
  const c = C({ monitor: { state: 'paused', last_run_at: '2026-11-10T20:00:00Z' } });
  assert.doesNotMatch(body(c), /\.json|watcher-state|hermes\/|purchases-ledger|~\//);
});

test('launch rows open only on the second tap: the first tap arms the row and says where it opens', () => {
  const idle = body(C());
  assert.match(idle, /data-cm="amazon-orders"/);
  assert.doesNotMatch(idle, /armed/);
  const armed = body(C(), { armed: 'amazon-orders', host: 'Dell' });
  assert.match(armed, /class="frow lrow armed" data-cm="amazon-orders"/);
  assert.match(vis(armed), /Tap again Opens on Dell/);
  // phone links open the pages in a new tab and need no arming
  assert.match(idle, /href="https:\/\/www\.amazon\.com\/your-orders\/orders" target="_blank"/);
});

test('a failed mail check is one line naming the mailbox; a missing feed is one Not reporting state', () => {
  const f = body(C({ pulls: [{ account: 'tanner', ok: false, error: 'list failed' }] }));
  assert.match(vis(f), /Return deadlines Mail check failed for tanner New orders show once it works\./);
  assert.doesNotMatch(f, /stale-bar/);
  assert.doesNotMatch(vis(f), /list failed/);
  const down = body({ error: 'file missing' });
  assert.match(vis(down), /Orders are not reporting\./);
  assert.doesNotMatch(vis(down), /Purchases/);
  assert.deepEqual(S.ordersFresh({ c: { error: 'file missing' }, now: NOW }), { age: null, refresh: 86400, missing: 1 });
});

test('older orders beyond the list are counted, not drawn', () => {
  assert.match(vis(body(C())), /2 older orders not shown/);
});

test('Data sheet for Orders: the monitor as a source, the pause as setup', () => {
  const d = S.ordersData(C({ monitor: { state: 'paused', last_run_at: null } }));
  assert.equal(d.sources[0].name, 'Purchase monitor');
  assert.equal(d.setup.length, 1);
});

test('every launch row is allowed by the server and handled by helper.py; nothing buys or reaches a seller account', () => {
  const helper = fs.readFileSync(path.join(__dirname, '../helper.py'), 'utf8');
  const hosts = fs.readFileSync(path.join(__dirname, '../rust/src/hosts.rs'), 'utf8');
  const ids = [...body(C()).matchAll(/data-cm="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['amazon-orders', 'amazon-returns', 'commerce-ink-dashboard', 'commerce-ink']);
  for (const k of ids) {
    assert.ok(hosts.includes('"' + k + '"'), k + ' allowed by the server');
    assert.ok(helper.includes('"' + k + '"'), k + ' handled by helper.py');
  }
  assert.doesNotMatch(body(C()), /sellercentral|Seller Central|buy now|checkout|add to cart/i);
  // a hostile order title is text, never markup
  assert.doesNotMatch(body(C({ orders: [{ id: 'h', title: '<img src=x onerror=alert(1)>', date: '2026-10-21', return_by: '2026-11-20' }] })), /<img/);
});
