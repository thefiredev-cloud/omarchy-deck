// Fleet stall strip (static/ops.js pure block). Loads deck.js DeckUI the same way the deck does.
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const deck = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const DeckUI = new Function(deck.slice(deck.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), deck.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const src = fs.readFileSync(path.join(__dirname, '../static/ops.js'), 'utf8');
const a = src.indexOf('// ==== DECK OPS UI BEGIN'), b = src.indexOf('// ==== DECK OPS UI END ====');
assert.ok(a >= 0 && b > a);
const O = new Function('DeckUI', src.slice(a, b) + '\nreturn DeckOps;')(DeckUI);

const NOW = 1800000000 * 1000;
const T = NOW / 1000;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const feed = (items, extra) => Object.assign({ t: T - 60, stale: false, counts: { watched: items.length }, items, alerts: { desktop: true, phone: false, phone_setup: 'Set DECK_STALL_NTFY_URL' }, errors: [] }, extra || {});
const it = (o) => Object.assign({ id: 'omp:1', kind: 'omp', name: 'OMP deck-ios/repo', state: 'ok', since: null, reason: 'Working', hint: '', where: '' }, o);

test('a stalled run shows a badge with since-when and how long', () => {
  const h = O.stalls(feed([it({ state: 'stalled', since: T - 22 * 60, reason: 'No output for 22 min while waiting on a tool', hint: 'Open the session' })]), NOW);
  const t = text(h);
  assert.match(t, /Stalled since .+ \(22 min\)/);
  assert.match(t, /1 needs a look/);
  assert.match(t, /OMP session/);
  assert.match(h, /pill warn/);
  assert.match(h, /data-since="1799998680"/);
});

test('failures are red, rate limits and stalls are yellow, ok runs are not listed', () => {
  const h = O.stalls(feed([it({ id: 'a', state: 'failed', kind: 'unit', name: 'x.service', since: T - 3600 }), it({ id: 'b', state: 'rate_limited', since: T - 600 }), it({ id: 'c' })]), NOW);
  assert.equal((h.match(/class="frow/g) || []).length, 2);
  assert.match(h, /frow bad/);
  assert.match(h, /frow stale/);
  assert.match(text(h), /Rate limited since/);
  assert.match(text(h), /2 need a look/);
});

test('nothing stalled reads calm, with what is watched', () => {
  const t = text(O.stalls(feed([it({}), it({ id: 'l', kind: 'lane' }), it({ id: 'c', kind: 'cron' })]), NOW));
  assert.match(t, /No stalled runs/);
  assert.match(t, /1 OMP · 1 lanes · 1 cron/);
  assert.match(t, /Alerts: desktop on · phone off/);
});

test('a missing feed is not reporting, never zero stalls', () => {
  for (const f of [null, { error: 'file missing', src: '~/.meshvault/status/deck/stalls.json' }]) {
    const t = text(O.stalls(f, NOW));
    assert.match(t, /Agent runs is not reporting/);
    assert.doesNotMatch(t, /No stalled runs/);
  }
});

test('the strip shows 8 problems and a Show more button for the rest', () => {
  const items = Array.from({ length: 11 }, (_, i) => it({ id: 'x' + i, state: 'stalled', since: T - 1000 - i }));
  const h = O.stalls(feed(items), NOW);
  assert.equal((h.match(/class="frow/g) || []).length, 8);
  assert.match(h, /Show 3 more/);
  assert.equal((O.stalls(feed(items), NOW, 200).match(/class="frow/g) || []).length, 11);
});
