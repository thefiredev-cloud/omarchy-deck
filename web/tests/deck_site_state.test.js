'use strict';
// pixel-deck#35: a product can never read Up while it shows an error page. Since PR b a site alone in its state is one row of House's
// grouped Products list: its name, its details and its state word beside its mark.
// node --test tests/deck_site_state.test.js  (no DOM, no network, fixed clock)
require('./setup-core.js'); // DeckCore on every global, as the page loads static/ui-core.js first
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../static/deck.js'), 'utf8');
const D = new Function(src.slice(src.indexOf('// ==== DECK V6 UI HELPERS BEGIN'), src.indexOf('// ==== DECK V6 UI HELPERS END ====')) + '\nreturn DeckUI;')();
const NOW = Date.parse('2026-10-27T07:00:00Z');
const T = (agoS) => NOW / 1000 - agoS;

const feed = (products) => ({ src: '~/.meshvault/status/deck/products.json', t: T(30), age: 30, stale: false, refresh: 300,
  sources: ['http probes'], errors: [], products, app_store: null, app_stores: [], needs: [] });
const grid = (products) => D.products(feed(products), NOW).grid;
// the row a site renders: from its own opening tag to the start of the next row
const tile = (html, name) => {
  const i = html.indexOf(name);
  assert.ok(i >= 0, 'row for ' + name);
  const starts = [...html.matchAll(/<(?:a|div)[^>]* class="frow/g)].map((m) => m.index);
  const start = starts.filter((s) => s < i).pop();
  assert.equal(typeof start, 'number', 'row opening tag before ' + name);
  const end = starts.find((s) => s > start) ?? html.length;
  return html.slice(start, end);
};
const word = (w, mark) => new RegExp('<span class="pill"><i class="sd ' + (mark || '[a-z]+') + '"></i>' + w.replace(/[.,]/g, '\\$&') + '</span>');
const site = (extra) => ({ id: 'console', name: 'Kodros Console', url: null, code: 200, ms: 10, state: 'up', monitor: null, ...extra });

test('issue 35: a 10 ms error page is Down, never Up beside "Showing an error page"', () => {
  // the reported row: Up, sign-in required / Showing an error page · 10 ms
  const legacy = tile(grid([site({ code: 500, ms: 10, state: 'up' })]), 'Kodros Console');
  assert.match(legacy, word('Down', 'bad'));
  assert.doesNotMatch(legacy, word('Up,'));
  assert.match(legacy, /Showing an error page/);
});

test('issue 35: the collector flag alone makes an answer Down, whatever the status says', () => {
  const flagged = tile(grid([site({ code: 200, ms: 10, state: 'up', error_page: true })]), 'Kodros Console');
  assert.match(flagged, word('Down', 'bad'));
  assert.match(flagged, /Showing an error page/);
});

test('issue 35: an auth challenge stays Up, sign-in required with a real answer, no error page', () => {
  // the live feed after the collector fix: 401 with its proxy note, which is not content
  const gated = tile(grid([site({ code: 401, ms: 10, state: 'gated' })]), 'Kodros Console');
  assert.match(gated, word('Up, sign-in required'));
  assert.match(gated, /Responding/);
  assert.doesNotMatch(gated, /Showing an error page/);
  assert.match(gated, /Private, needs sign-in/);
  assert.match(gated, /10 ms/);
});

test('a live site still reads Up and Responding with its latency', () => {
  const up = tile(grid([site({ id: 'meshvault-ai', name: 'meshvault.ai', url: 'https://meshvault.ai/', code: 200, ms: 175 })]), 'meshvault.ai');
  assert.match(up, word('Up', 'ok'));
  assert.match(up, /Responding/);
  assert.match(up, /175 ms/);
  assert.match(up, /<a class="frow" href="https:\/\/meshvault\.ai\/"/);
});

test('no answer is Down with No answer, never a zero latency', () => {
  const none = tile(grid([site({ code: null, ms: 0, state: 'down' })]), 'Kodros Console');
  assert.match(none, word('Down', 'bad'));
  assert.match(none, /No answer/);
  assert.doesNotMatch(none, /0 ms/);
});

test('a down site with a healthy monitor still shows its failing checks', () => {
  const html = D.products(feed([site({ code: 502, ms: 40, state: 'up',
    monitor: { checks: 4, ok: 3, failing: ['mv-api'] } })]), NOW).grid;
  assert.match(html, /Showing an error page/);
  assert.match(html, /3 of 4 checks passing \u00B7 failing: mv-api/);
});

// review #390: two "Up" sites with failing checks folded into "Up · 2 sites" under a red mark, with no failing detail; the word now
// says the worst truth, so they group as "Up, checks failing" apart from the calm "Up" sites, and a lone one keeps its failing detail
test('an answering site with failing checks reads "Up, checks failing" and never joins the calm Up group', () => {
  const fail = (name) => site({ name, url: 'https://' + name + '/', code: 200, ms: 40, state: 'up', monitor: { checks: 4, ok: 3, failing: ['api'] } });
  const ok = (name) => site({ name, url: 'https://' + name + '/', code: 200, ms: 40, state: 'up', monitor: { checks: 2, ok: 2, failing: [] } });
  const g = grid([fail('a.org'), fail('b.org'), ok('c.org'), ok('d.org')]);
  const vis = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.match(vis(g), /Up, checks failing · 2 sites a\.org b\.org/);
  assert.match(vis(g), /Up · 2 sites c\.org d\.org/);
  assert.match(g, /<span class="lead-mark sd bad"[^>]*><\/span><span class="fl"><b>Up, checks failing · 2 sites<\/b>/, 'the bad mark sits beside words that say so');
  assert.doesNotMatch(g, /<span class="lead-mark sd bad"[^>]*><\/span><span class="fl"><b>Up · /, 'the calm Up group never carries the bad mark');
  const one = tile(grid([fail('a.org'), ok('c.org')]), 'a.org');
  assert.match(one, word('Up, checks failing', 'bad'));
  assert.match(one, /3 of 4 checks passing · failing: api/);
});
